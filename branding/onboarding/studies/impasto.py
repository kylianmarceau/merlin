"""A small palette-knife painter.

A scene supplies an underpainting (the colour it wants), a set of layer masks
painted back to front, and a stroke direction for each layer. The painter lays
slabs of paint coarse to fine, keeps a height map of the paint, and lights the
relief at the end so ridges and bristle grooves catch the light.
"""

import math
import re
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path("/Users/kyliandabancourt/Documents/merlin")


# ---------------------------------------------------------------- noise utils

def fbm(shape, seed, scale=200.0, octaves=5, gain=0.5, aspect=1.0):
    """Smooth fractal noise in [0, 1]. scale is the largest feature in px."""
    h, w = shape
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    amp, total = 1.0, 0.0
    s = scale
    for _ in range(octaves):
        gh = max(2, int(h / s) + 3)
        gw = max(2, int(w / (s * aspect)) + 3)
        grid = rng.random((gh, gw)).astype(np.float32)
        layer = cv2.resize(grid, (w + int(2 * s * aspect), h + int(2 * s)), interpolation=cv2.INTER_CUBIC)
        oy, ox = int(rng.integers(0, max(1, int(s)))), int(rng.integers(0, max(1, int(s * aspect))))
        out += amp * layer[oy:oy + h, ox:ox + w]
        total += amp
        amp *= gain
        s /= 2
        if s < 1.5:
            break
    out /= total
    lo, hi = np.percentile(out, 1), np.percentile(out, 99)
    return np.clip((out - lo) / (hi - lo + 1e-6), 0, 1)


def noise1d(n, seed, step=6.0):
    rng = np.random.default_rng(seed)
    pts = rng.random(int(n / step) + 4).astype(np.float32)
    return np.interp(np.arange(n) / step, np.arange(len(pts)), pts).astype(np.float32)


def ridge_line(width, seed, base, amp, scale=300.0, octaves=6, sharp=True):
    """A mountain skyline y(x)."""
    x = np.arange(width, dtype=np.float32)
    rng = np.random.default_rng(seed)
    y = np.zeros(width, np.float32)
    a, s = amp, scale
    for _ in range(octaves):
        pts = rng.random(int(width / s) + 3) * 2 - 1
        seg = np.interp(x / s, np.arange(len(pts)), pts)
        if sharp:
            seg = -np.abs(seg) * 2 + 1  # peaks
        y += a * seg
        a *= 0.5
        s /= 2
    return base - y


def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def lerp(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[..., None]
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def gradient_v(shape, stops):
    """Vertical gradient. stops: [(y_fraction, '#hex'), ...]"""
    h, w = shape
    ys = np.linspace(0, 1, h, dtype=np.float32)
    pos = [p for p, _ in stops]
    cols = np.array([hex2rgb(c) for _, c in stops])
    col = np.stack([np.interp(ys, pos, cols[:, i]) for i in range(3)], -1)
    return np.repeat(col[:, None, :], w, 1).astype(np.float32)


def radial(shape, cx, cy, r, sy=1.0):
    h, w = shape
    y, x = np.mgrid[:h, :w].astype(np.float32)
    return np.sqrt(((x - cx) / r) ** 2 + ((y - cy) / (r * sy)) ** 2)


def poly_mask(shape, pts, blur=0.0):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(np.array(pts) * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    m = m.astype(np.float32) / 255
    if blur:
        m = cv2.GaussianBlur(m, (0, 0), blur)
    return m


def below(shape, line):
    """Mask of pixels below a skyline y(x)."""
    h, w = shape
    y = np.arange(h, dtype=np.float32)[:, None]
    return np.clip(y - line[None, :] + 0.5, 0, 1).astype(np.float32)


def falcon_contours():
    sys.path.insert(0, str(ROOT / "scripts"))
    from merlin_mark import FALCON_PATH, parse_polygon
    paths, path = [], []
    for command, coords in parse_polygon(FALCON_PATH):
        if command == "M":
            path = []
        if coords:
            path.append(coords)
        if command == "Z":
            paths.append(np.array(path, np.float32))
    pts = np.concatenate(paths)
    centre = (pts.max(0) + pts.min(0)) / 2
    span = np.ptp(pts[:, 0])
    return [(p - centre) / span for p in paths]


def falcon_mask(shape, cx, cy, width, angle=0.0, flip=False):
    m = np.zeros(shape, np.uint8)
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    polys = []
    for p in falcon_contours():
        q = p.copy()
        if flip:
            q[:, 0] *= -1
        q = q @ np.array([[c, s], [-s, c]], np.float32)
        q = q * width + [cx, cy]
        polys.append(np.round(q * 16).astype(np.int32))
    # Even-odd fill, like the source.
    for poly in polys:
        layer = np.zeros(shape, np.uint8)
        cv2.fillPoly(layer, [poly], 255, cv2.LINE_AA, shift=4)
        m = np.bitwise_xor(m, layer)
    return m.astype(np.float32) / 255


# ---------------------------------------------------------------- the painter

class Canvas:
    def __init__(self, target, seed=1):
        self.target = np.ascontiguousarray(target, dtype=np.float32)
        self.h, self.w = target.shape[:2]
        self.k = self.w / 1600
        self.color = cv2.GaussianBlur(self.target, (0, 0), 6 * self.k)
        self.height = np.zeros((self.h, self.w), np.float32)
        self.rng = np.random.default_rng(seed)
        self.seed = seed

    # One slab of paint ---------------------------------------------------
    def stroke(self, cx, cy, angle, length, width, color, clip=None, thick=1.0,
               ragged=0.35, curve=0.0, streak=0.04, opacity=1.0, pickup=0.18, taper=0.0):
        L, Wd = length, width
        r = int(math.ceil(0.5 * math.hypot(L, Wd) + 4))
        x0, y0 = int(cx) - r, int(cy) - r
        x1, y1 = x0 + 2 * r + 1, y0 + 2 * r + 1
        if x1 <= 0 or y1 <= 0 or x0 >= self.w or y0 >= self.h:
            return
        ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(self.w, x1), min(self.h, y1)
        yy, xx = np.mgrid[ay0:ay1, ax0:ax1].astype(np.float32)
        dx, dy = xx - cx, yy - cy
        ca, sa = math.cos(angle), math.sin(angle)
        u = dx * ca + dy * sa            # along the stroke
        v = -dx * sa + dy * ca           # across
        un = u / (L / 2)
        v = v - curve * Wd * (un ** 2 - 0.3)
        rng = self.rng
        # Ragged edges: the knife leaves a torn margin along the sides and ends.
        side_seed = int(rng.integers(1 << 30))
        idx_u = np.clip((u + L / 2 + 4) * 0.8, 0, None)
        edge_n = noise1d(int(L * 0.8 + 20), side_seed, step=3.0)
        edge = np.interp(idx_u, np.arange(len(edge_n)), edge_n)
        half = Wd / 2 * (1 - taper * np.clip(un, 0, 1) ** 2) * (1 + ragged * 0.35 * (edge - 0.5))
        idx_v = np.clip((v + Wd) * 1.0, 0, None)
        end_n = noise1d(int(2 * Wd + 20), side_seed + 7, step=2.0)
        endr = np.interp(idx_v, np.arange(len(end_n)), end_n)
        endlen = L / 2 * (1 - ragged * 0.25 * endr) - 0.15 * Wd * (np.abs(v) / (Wd / 2 + 1e-3)) ** 2
        d_side = half - np.abs(v)
        d_end = endlen - np.abs(u)
        d = np.minimum(d_side, d_end)
        a = np.clip(d / max(0.7, 0.6 * self.k) + 0.5, 0, 1) * opacity
        if clip is not None:
            a = a * clip[ay0:ay1, ax0:ax1]
        if a.max() <= 0.01:
            return
        # Bristle grooves run along the stroke.
        g_n = noise1d(int(2 * Wd + 40), side_seed + 13, step=max(1.2, 1.6 * self.k))
        grooves = np.interp(np.clip(v + Wd + 10, 0, None), np.arange(len(g_n)), g_n) - 0.5
        # Paint thins and drags out towards the head of the stroke.
        along = np.clip((un + 1) / 2, 0, 1)
        col = np.asarray(color, np.float32)
        base = self.color[ay0:ay1, ax0:ax1]
        mix = pickup * (1 - along) ** 2
        paint = col + (base - col) * mix[..., None]
        paint = paint * (1 + streak * grooves)[..., None]
        # Height: body, a ridge where the paint piles at the margins, grooves.
        ridge = np.exp(-(np.clip(d_side, 0, None) / (1.2 * self.k + 0.6)) ** 2) * 0.9
        ridge += np.exp(-(np.clip(d_end, 0, None) / (1.6 * self.k + 0.8)) ** 2) * (0.6 + 0.8 * (un < 0))
        hgt = thick * (0.6 + 0.55 * ridge + 0.12 * grooves) * (0.85 + 0.15 * (1 - along))
        aa = a[..., None]
        self.color[ay0:ay1, ax0:ax1] = base + (paint - base) * aa
        hh = self.height[ay0:ay1, ax0:ax1]
        self.height[ay0:ay1, ax0:ax1] = hh * (1 - 0.75 * a) + hgt * a

    # A pass of strokes over a region -------------------------------------
    def layer(self, mask, angle, length, width, density=1.0, jitter=None, accents=None,
              accent_p=0.0, clip=True, thick=1.0, angle_jitter=0.12, ragged=0.35,
              curve=0.25, streak=0.04, opacity=1.0, where=None, pickup=0.18, sample_blur=4.0,
              size_jitter=0.35, taper=0.0, seed=None, accent_mix=0.4):
        """Lay strokes inside mask. angle is a float (radians) or an array field."""
        k = self.k
        L, Wd = length * k, width * k
        rng = np.random.default_rng(seed if seed is not None else int(self.rng.integers(1 << 30)))
        self.rng = rng
        region = mask if where is None else mask * where
        step_x, step_y = max(2.0, L * 0.42), max(2.0, Wd * 0.62)
        n = int(region.sum() / (step_x * step_y) * density)
        if n <= 0:
            return
        # Sample candidate centres proportionally to region weight.
        flat = region.ravel()
        p = flat / flat.sum()
        idx = rng.choice(flat.size, size=n, p=p)
        ys, xs = np.divmod(idx, self.w)
        xs = xs + rng.random(n)
        ys = ys + rng.random(n)
        samp = cv2.GaussianBlur(self.target, (0, 0), sample_blur * k) if sample_blur else self.target
        jit = jitter or (0.035, 0.015, 0)
        if clip is True:
            clipmask = mask
        elif clip is False:
            clipmask = None
        else:
            clipmask = clip
        for i in range(n):
            x, y = xs[i], ys[i]
            iy, ix = int(y), int(x)
            col = samp[iy, ix].copy()
            if accents is not None and rng.random() < accent_p:
                acc = accents[int(rng.integers(len(accents)))]
                col = col * (1 - accent_mix) + acc * accent_mix
            col = col * (1 + rng.normal(0, jit[0])) + rng.normal(0, jit[1], 3)
            col = np.clip(col, 0, 1.2)
            ang = angle if np.isscalar(angle) else float(angle[iy, ix])
            ang += rng.normal(0, angle_jitter)
            s = 1 + rng.uniform(-size_jitter, size_jitter)
            self.stroke(x, y, ang, L * s, Wd * (0.8 + 0.4 * rng.random()) * (s ** 0.5), col,
                        clip=clipmask, thick=thick * (0.8 + 0.4 * rng.random()), ragged=ragged,
                        curve=curve * rng.normal(), streak=streak, opacity=opacity, pickup=pickup,
                        taper=taper)

    def inlay(self, mask, thick=1.0):
        """Set a small, crisp shape straight from the underpainting."""
        mask = np.float32(mask)
        a = mask[..., None]
        self.color = np.float32(self.color + (np.float32(self.target) - self.color) * a)
        self.height = np.float32(self.height * (1 - mask) + thick * mask)

    # Light the relief ----------------------------------------------------
    def finish(self, light=(-0.55, -0.65), relief=0.6, spec=0.16, grain=0.02, lift=1.0):
        k = self.k
        h = cv2.GaussianBlur(np.float32(self.height), (0, 0), 0.6 * k + 0.2)
        gx = cv2.Sobel(h, cv2.CV_32F, 1, 0, ksize=3) / 8
        gy = cv2.Sobel(h, cv2.CV_32F, 0, 1, ksize=3) / 8
        s = 1.6 * relief / k
        nx, ny, nz = -gx * s, -gy * s, np.ones_like(h)
        norm = np.sqrt(nx * nx + ny * ny + nz * nz)
        nx, ny, nz = nx / norm, ny / norm, nz / norm
        lx, ly = light
        lz = math.sqrt(max(0.05, 1 - lx * lx - ly * ly))
        diff = nx * lx + ny * ly + nz * lz
        dd = diff - lz
        shade = 1 + 0.85 * np.where(dd > 0, dd, 0.55 * dd)
        hx, hy, hz = lx, ly, lz + 1
        hn = math.sqrt(hx * hx + hy * hy + hz * hz)
        spec_t = np.clip((nx * hx + ny * hy + nz * hz) / hn, 0, 1) ** 28 * spec
        img = self.color * shade[..., None] * lift + spec_t[..., None] * (0.55 + 0.45 * self.color)
        # Canvas tooth.
        rng = np.random.default_rng(self.seed + 99)
        tooth = cv2.GaussianBlur(rng.normal(0, 1, h.shape).astype(np.float32), (0, 0), 0.7)
        img = img * (1 + grain * tooth)[..., None]
        return np.clip(img, 0, 1)


def save(img, path, scale=None):
    out = np.uint8(np.clip(img, 0, 1) * 255 + 0.5)
    out = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    if scale:
        out = cv2.resize(out, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), out, [cv2.IMWRITE_JPEG_QUALITY, 92])


def slope_angle(field, blur=6.0):
    """Stroke angle following the downhill direction of a height field."""
    f = cv2.GaussianBlur(np.float32(field), (0, 0), blur)
    gx = cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=5)
    gy = cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=5)
    return np.arctan2(gy, gx).astype(np.float32)


def shade_terrain(z, light, blur=1.5):
    """Lambert shading of a height field given in px units."""
    z = cv2.GaussianBlur(np.float32(z), (0, 0), blur)
    gx = cv2.Sobel(z, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(z, cv2.CV_32F, 0, 1, ksize=3) / 8
    n = np.dstack([-gx, -gy, np.ones_like(z)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    l = np.array(light, np.float32)
    l /= np.linalg.norm(l)
    return np.clip(n @ l, 0, 1), n


# ---------------------------------------------------------------- scene kit

def pine_pts(cx, base, height, width, seed):
    """Jagged tiers of a spruce silhouette, in scene units."""
    rng = np.random.default_rng(seed)
    pts_l, pts_r = [], []
    tiers = int(height / 22) + 4
    for i in range(tiers + 1):
        t = i / tiers
        yy = base - height * t
        wv = width * (1 - t) ** 1.1 * (0.7 + 0.3 * rng.random())
        pts_l += [(cx - wv, yy), (cx - wv * 0.45, yy - height / tiers * 0.45)]
        pts_r += [(cx + wv * (0.9 + 0.2 * rng.random()), yy), (cx + wv * 0.45, yy - height / tiers * 0.45)]
    return [(cx - 3, base + 8)] + pts_l + [(cx, base - height - 6)] + pts_r[::-1] + [(cx + 3, base + 8)]


def scaled(pts, k):
    return [(px * k, py * k) for px, py in pts]


def hills(width, k, base, amp, scale, seed, octaves=3):
    """Soft rolling skyline (no sharp peaks)."""
    return ridge_line(width, seed, base * k, amp * k, scale=scale * k, octaves=octaves, sharp=False)


def sprinkle_stars(img, mask, k, n, seed, top=1.0, colour=(0.92, 0.94, 1.0)):
    h, w = mask.shape
    rng = np.random.default_rng(seed)
    for _ in range(n):
        sx, sy = int(rng.random() * w), int(rng.random() * h * top)
        if mask[sy, sx] > 0.9:
            r = max(1, int(rng.uniform(0.6, 1.9) * k + 0.5))
            b = rng.uniform(0.35, 1.0)
            c = img[sy, sx] * (1 - b) + np.array(colour) * b
            cv2.circle(img, (sx, sy), r, tuple(float(v) for v in c), -1, cv2.LINE_AA)


def paper(img, k, seed=0, amount=0.05):
    """Warm paper grain under thin paint, as in a gouache sketch."""
    h, w = img.shape[:2]
    g = fbm((h, w), seed + 500, scale=3 * k + 1, octaves=2)
    fibres = fbm((h, w), seed + 501, scale=40 * k, octaves=2, aspect=6)
    t = (g - 0.5) * amount + (fibres - 0.5) * amount * 0.5
    return np.clip(img * (1 + t[..., None]), 0, 1)
