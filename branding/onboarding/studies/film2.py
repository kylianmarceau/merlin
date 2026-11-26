"""Eyrie opening film, second cut: a living scene and a flying falcon.

    python eyrie_layers.py 1800 night && python eyrie_layers.py 1800 day
    python film2.py out/eyrie2.mp4 [--frames 0,48,96]

The painting is split into depth layers. A slow camera push-in moves them at
different rates; the cloud banks drift past the peaks, the moon path plays on
the cloud crowns, mist streams through, snow blows off the summits and a
meteor crosses the sky. The merlin looks round, crouches and drops off the
ledge as a jointed 3D bird, beats out over the cloud sea, crosses the moon,
banks round and climbs into the open sky, where its last wingbeat becomes
Merlin's mark and the name rises letter by letter. Daylight then spreads out
from the moon, which has become the sun.
"""
import math
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import falcon3d as F3
from impasto import falcon_mask, fbm
from score3 import write_score

HERE = Path(__file__).resolve().parent
W, H, FPS, DURATION = 1600, 1000, 30, 7.6
INK = np.float32([253, 241, 214]) / 255

PERCH_GLANCE = (0.35, 1.05)
CROUCH = 1.30
LAUNCH = 1.58
SETTLE = 4.32          # the bird is the mark
TITLE = 4.20
FADE = 5.80            # title and mark leave as the light changes
DAWN = 5.65

FOCUS = np.float32([700, 430])


def remap(src, mx, my, *a, **kw):
    return cv2.remap(np.float32(src), np.float32(mx), np.float32(my), *a, **kw)


def add_blob(buf, x, y, r, a):
    """Add a soft round puff, so overlapping puffs build up density."""
    n = int(r * 2.2) + 2
    x0, y0 = int(x) - n, int(y) - n
    h, w = buf.shape
    if x0 >= w or y0 >= h or x0 + 2 * n < 0 or y0 + 2 * n < 0:
        return
    yy, xx = np.mgrid[y0:y0 + 2 * n + 1, x0:x0 + 2 * n + 1].astype(np.float32)
    g = a * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * (0.55 * r) ** 2))
    ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(w, x0 + 2 * n + 1), min(h, y0 + 2 * n + 1)
    buf[ay0:ay1, ax0:ax1] += g[ay0 - y0: ay1 - y0, ax0 - x0: ax1 - x0]


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = np.clip(x, 0, 1)
    return 1 - (1 - x) ** 3


def load(tone):
    z = np.load(HERE / f'out/layers_{tone}.npz')
    L = {k: np.float32(z[k]) for k in z.files}
    for i in range(4):
        L[f'crown{i}'] = cv2.GaussianBlur(L[f'crown{i}'], (0, 0), sigmaX=16, sigmaY=3) * L[f'rowa{i}']
    return L


# ---------------------------------------------------------------- camera

DEPTH = {'back': 0.022, 'row0': 0.03, 'row1': 0.042, 'row2': 0.058, 'row3': 0.08, 'front': 0.115}
PAN = {'back': 4, 'row0': 6, 'row1': 9, 'row2': 13, 'row3': 18, 'front': 30}
DRIFT = [7, 12, 19, 30]            # painting px per second, far to near


def push(t):
    return ease_out(t / DURATION) * 0.85 + 0.15 * t / DURATION


def cam(layer, t, b):
    """Affine painting -> screen for a layer at time t."""
    z = 1 + DEPTH[layer] * push(t)
    sx = -PAN[layer] * push(t)
    sy = -PAN[layer] * 0.35 * push(t)
    fx, fy = FOCUS
    return np.float32([[z * b, 0, fx - z * fx + sx], [0, z * b, fy - z * fy + sy]])


def apply(M, x, y):
    return M[0, 0] * x + M[0, 2], M[1, 1] * y + M[1, 2]


# ---------------------------------------------------------------- flight

FL = 1000.0


def world(sx, sy, sc):
    return np.float64([(sx - 800) / sc, (500 - sy) / sc, FL / sc])


def screen(p):
    sc = FL / p[2]
    return 800 + p[0] * sc, 500 - p[1] * sc, sc


def catmull(points, times, t):
    times = np.asarray(times)
    i = int(np.clip(np.searchsorted(times, t) - 1, 0, len(times) - 2))
    u = np.clip((t - times[i]) / (times[i + 1] - times[i]), 0, 1)
    p0 = points[max(i - 1, 0)]
    p1, p2 = points[i], points[i + 1]
    p3 = points[min(i + 2, len(points) - 1)]
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)


class Flight:
    def __init__(self, perch_xy, perch_scale, end_xy, end_scale):
        px, py = perch_xy
        keys = [
            (LAUNCH - 0.10, px + 6, py + 6, perch_scale),
            (LAUNCH, px, py, perch_scale),
            (1.84, px - 120, py + 70, perch_scale * 0.9),
            (2.12, 990, 560, 160),
            (2.48, 820, 440, 104),
            (2.86, 668, 342, 72),        # across the moon
            (3.18, 548, 270, 64),
            (3.48, 500, 222, 70),
            (3.78, 580, 172, 80),
            (4.06, 712, 128, end_scale * 1.02),
            (SETTLE, end_xy[0], end_xy[1], end_scale),
            (SETTLE + 0.6, end_xy[0] + 8, end_xy[1] - 1, end_scale),
        ]
        self.times = [k[0] for k in keys]
        self.pts = np.array([world(*k[1:]) for k in keys])

    def pos(self, t):
        return catmull(self.pts, self.times, np.clip(t, self.times[0], self.times[-1]))

    def frame(self, t):
        dt = 1 / 240
        p = self.pos(t)
        v = (self.pos(t + dt) - self.pos(t - dt)) / (2 * dt)
        a = (self.pos(t + dt) - 2 * p + self.pos(t - dt)) / (dt * dt)
        fwd = np.float32([v[0], v[1] * 0.7, -v[2]])
        if np.linalg.norm(fwd) < 1e-3:
            fwd = np.float32([-1, 0, 0])
        f = fwd / np.linalg.norm(fwd)
        up = np.float32([0, 1, 0])
        r = np.cross(f, up)
        r /= np.linalg.norm(r) + 1e-9
        acc = np.float32([a[0], a[1], -a[2]])
        bank = math.atan2(float(acc @ r), 14.0)
        bank = max(-1.15, min(1.15, bank))
        return p, f, bank


# ---------------------------------------------------------------- the title

def title_layers():
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', 118)
    word = 'Merlin'
    full = font.getlength(word)
    left = W / 2 - full / 2
    letters = []
    for i, ch in enumerate(word):
        x0 = left + font.getlength(word[:i])
        mask = Image.new('L', (W, 200))
        ImageDraw.Draw(mask).text((x0, 100), ch, font=font, fill=255, anchor='ls')
        letters.append(np.asarray(mask, np.float32) / 255)
    return letters


TITLE_TOP = 140
MARK = (800, 112, 103)


# ---------------------------------------------------------------- the scene

class Scene:
    def __init__(self):
        self.L = {'night': load('night'), 'day': load('day')}
        n = self.L['night']
        self.PH, self.PW = n['back'].shape[:2]
        self.b = W / self.PW
        self.k = float(n['k'][0])
        mx, my, mr = n['moon']
        self.moon_p = (mx, my, mr)
        self.y, self.x = np.mgrid[:H, :W].astype(np.float32)
        rng = np.random.default_rng(31)
        # Stars in painting space so they ride with the sky.
        self.stars = []
        sky = n['sky']
        for _ in range(260):
            sx, sy = rng.uniform(0, self.PW), rng.uniform(0, self.PH * 0.52)
            if sky[int(sy), int(sx)] > 0.98 and math.hypot(sx - mx, sy - my) > 3.3 * mr:
                self.stars.append((sx, sy, rng.uniform(0.6, 1.5), rng.uniform(0, 6.3), rng.uniform(1.2, 3.4)))
        # Summits for spindrift: the highest points of the far range.
        far = n['far']
        line = np.argmax(far > 0.5, axis=0).astype(np.float32)
        peaks = []
        for xx in range(40, self.PW - 40):
            if line[xx] == line[xx - 30: xx + 31].min() and line[xx] < 0.62 * self.PH and xx < 0.62 * self.PW:
                if all(abs(xx - p[0]) > 70 for p in peaks):
                    peaks.append((xx, line[xx]))
        peaks.sort(key=lambda p: p[1])
        self.peaks = peaks[:3]
        self.plume = []
        for pi, (px, py) in enumerate(self.peaks):
            for _ in range(140):
                self.plume.append((pi, rng.uniform(0, 2.4), rng.normal(0, 1), rng.normal(0, 1), rng.uniform(0.5, 1.4)))
        # Glints on snow: bright points on the summits and ledges.
        lum = n['back'] @ np.float32([0.3, 0.55, 0.15])
        cand = np.argwhere((lum > np.percentile(lum[far > 0.5], 97)) & (far > 0.5))
        pick = cand[rng.choice(len(cand), 26, replace=False)]
        self.glints = [('back', float(p[1]), float(p[0]), rng.uniform(0, DURATION), rng.uniform(0.7, 1.3)) for p in pick]
        flum = n['front'] @ np.float32([0.3, 0.55, 0.15])
        fc = np.argwhere((flum > np.percentile(flum[n['fronta'] > 0.9], 98.5)) & (n['fronta'] > 0.9) & (n['birda'] < 0.01))
        for p in fc[rng.choice(len(fc), 14, replace=False)]:
            self.glints.append(('front', float(p[1]), float(p[0]), rng.uniform(0, DURATION), rng.uniform(0.8, 1.4)))
        # Mist and high cloud fields, wider than the frame so they can slide.
        self.mist = fbm((H, W + 900), 401, scale=230, octaves=4, aspect=4.5)
        self.mist2 = fbm((H, W + 900), 402, scale=100, octaves=3, aspect=6)
        self.wisp = fbm((220, W + 900), 403, scale=120, octaves=4, aspect=7)
        self.grain = cv2.GaussianBlur(np.random.default_rng(5).normal(0, 1, (H, W)).astype(np.float32), (0, 0), 1.2)
        self.letters = title_layers()
        feathers = fbm((256, 256), 77, scale=40, octaves=3, aspect=3.0)
        self.feathers = (feathers - 0.5).astype(np.float32)
        self.burst = [(rng.normal(-0.6, 0.8), rng.normal(-0.9, 0.6), rng.uniform(0.4, 1.4), rng.uniform(0, 0.1))
                      for _ in range(110)]
        # The perched bird, for its glance and crouch.
        bird = n['birda']
        ys, xs = np.nonzero(bird > 0.01)
        self.bbox = (ys.min() - 30, ys.max() + 30, xs.min() - 30, xs.max() + 30)
        FX, FY, FS, LEAN = n['perch']
        self.perch = (FX, FY, FS, LEAN)

        def P(px, py):
            c, s = math.cos(LEAN), math.sin(LEAN)
            return FX + (px * c + py * s) * FS, FY + (-px * s + py * c) * FS
        self.P = P
        # Where the flight starts (painting px) and how big the bird is there.
        self.perch_centre = P(4, -46)
        self.perch_scale = 190 * FS / 2.025
        self.fit = np.load(HERE / 'out/mark_pose.npy')
        self.end_scale, self.end_off = self.mark_geometry()
        self.flight = None

    # The fitted mark pose, measured so its box lands exactly on the mark.
    def mark_pose(self):
        yaw, pitch, roll, flap, sweep, hflap, fold, tilt = [float(v) for v in self.fit]
        f = np.float32([math.cos(yaw) * math.cos(pitch), math.sin(pitch), math.sin(yaw) * math.cos(pitch)])
        return f, roll, dict(flap=flap, sweep=sweep, hand_flap=hflap, fold=fold), tilt

    def mark_geometry(self):
        f, roll, wings, tilt = self.mark_pose()
        R = F3.orientation(f, bank=roll)
        pl, _ = F3.polys(R, (300, 300), 200, tail_spread=0.2, tail_pitch=tilt, **wings)
        cov = F3.coverage((600, 600), pl, ss=2)
        ys, xs = np.nonzero(cov > 0.5)
        wb = xs.max() - xs.min()
        s = 200 * MARK[2] / wb
        off = (((xs.max() + xs.min()) / 2 - 300) * s / 200, ((ys.max() + ys.min()) / 2 - 300) * s / 200)
        return s, off

    # ---------------------------------------------------------------- layers
    def warp(self, img, M, band=None, flags=cv2.INTER_LINEAR):
        if band is not None:
            M = M.copy()
            M[1, 2] += M[1, 1] * band
        return cv2.warpAffine(img, M, (W, H), flags=flags, borderMode=cv2.BORDER_CONSTANT)

    def compose(self, tone, t, bird_state):
        L = self.L[tone]
        night = tone == 'night'
        b = self.b
        Mb = cam('back', t, b)
        img = self.warp(L['back'], Mb)
        skym = self.warp(L['sky'], Mb)
        mx, my, mr = self.moon_p
        msx, msy = apply(Mb, mx, my)
        mrs = mr * Mb[0, 0]
        rr = np.hypot(self.x - msx, self.y - msy) / mrs
        if night:
            breathe = 0.025 * math.sin(1.3 * t) + 0.015 * math.sin(3.1 * t + 1)
            halo = np.exp(-np.clip(rr - 1, 0, None) / 1.6) * (rr > 1)
            img *= (1 + halo * breathe * 2.2)[..., None]
            self.draw_stars(img, Mb, t)
            self.draw_meteor(img, t, skym)
        # High wisps slide across the moon.
        off = int(10 + 14 * t)
        wv = self.wisp[:, off: off + W]
        wy0 = int(msy - 150)
        band = np.clip((wv - 0.56) * 3.2, 0, 1) * np.hanning(220)[:, None] ** 1.5
        ys0, ys1 = max(0, wy0), min(H, wy0 + 220)
        if ys1 > ys0:
            a = band[ys0 - wy0: ys1 - wy0] * skym[ys0:ys1]
            lit = np.exp(-np.clip(rr[ys0:ys1] - 0.7, 0, None) / 1.4)
            c0 = np.float32([0.33, 0.31, 0.66]) if night else np.float32([0.86, 0.91, 0.98])
            c1 = np.float32([0.95, 0.90, 0.97]) if night else np.float32([1.0, 0.99, 0.95])
            col = c0 + (c1 - c0) * lit[..., None]
            reg = img[ys0:ys1]
            reg += (col - reg) * (a * (0.42 if night else 0.5))[..., None]
        self.draw_spindrift(img, Mb, t, night)
        self.draw_glints(img, 'back', Mb, t, night)

        # Cloud banks, far to near.
        cloud_a = np.zeros((H, W), np.float32)
        path_c = np.float32([0.965, 0.91, 0.81]) if night else np.float32([1.0, 0.98, 0.94])
        for i in range(4):
            name = f'row{i}'
            Mr = cam(name, t, b).copy()
            d = DRIFT[i] * t
            Mr[0, 2] -= Mr[0, 0] * d
            Mr[1, 2] += 1.6 * math.sin(0.7 * t + i * 1.9)
            y0 = int(L[f'band{i}'][0])
            rgba = np.dstack([L[name], L[f'rowa{i}']])
            # Billows breathe: a slow displacement inside the bank.
            sy0, sy1 = apply(Mr, 0, y0)[1], apply(Mr, 0, y0 + rgba.shape[0])[1]
            r0, r1 = max(0, int(sy0) - 2), min(H, int(sy1) + 2)
            if r1 <= r0:
                continue
            xs, ys = self.x[r0:r1], self.y[r0:r1]
            inv_x = (xs - Mr[0, 2]) / Mr[0, 0]
            inv_y = (ys - Mr[1, 2]) / Mr[1, 1] - y0
            depth = 0.4 + 0.6 * i / 3
            ph = 0.009 * inv_x + 0.03 * inv_y
            dx = (1.2 + 3.5 * depth) * np.sin(ph - 0.8 * t) + (0.6 + 1.5 * depth) * np.sin(0.021 * inv_x + 1.2 * t)
            dy = (0.5 + 1.6 * depth) * np.cos(ph * 0.7 - 0.6 * t)
            mapx, mapy = inv_x + dx, inv_y + dy
            row = remap(rgba, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            aux = remap(np.dstack([L[f'crown{i}'], L[f'relief{i}']]), inv_x, inv_y, cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 1))
            a = row[..., 3]
            col = row[..., :3]
            # The moon path: fixed in the frame, lighting whichever crowns pass through it.
            yy = ys
            width = 70 * self.k * Mr[0, 0] + 0.55 * np.clip(yy - 590, 0, None)
            path = np.exp(-((xs - msx) / width) ** 2)
            shimmer = 0.82 + 0.18 * np.sin(0.07 * yy - 2.4 * t + 1.9 * np.sin(0.005 * xs + 0.6 * t))
            w = path * aux[..., 0] * 0.93 * shimmer
            col = col + (path_c - col) * w[..., None]
            col = col * (1 + (aux[..., 1] - 1) * w * 0.9)[..., None]
            col = col + (path_c * 0.92 - col) * (path * 0.18)[..., None]
            reg = img[r0:r1]
            reg += (col - reg) * a[..., None]
            cloud_a[r0:r1] = np.maximum(cloud_a[r0:r1], a)

        # Mist streams over the cloud sea.
        o1, o2 = int(22 * t), int(46 * t)
        m1 = self.mist[:, o1: o1 + W]
        m2 = self.mist2[:, o2: o2 + W]
        depth = np.clip((self.y - 580) / 420, 0, 1)
        veil = np.clip((m1 - 0.5) * 2.4, 0, 1) * 0.65 + np.clip((m2 - 0.58) * 2.6, 0, 1) * 0.45
        veil *= np.clip(cloud_a * 1.3, 0, 1) * (0.3 + 0.7 * depth)
        tint = np.float32([0.80, 0.78, 0.96]) if night else np.float32([1.0, 1.0, 1.0])
        img += (tint - img) * (veil * (0.3 if night else 0.34))[..., None]

        # The crag, with the perched bird alive until it goes.
        Mf = cam('front', t, b)
        src, alpha = self.front_source(L, t, bird_state)
        fr = self.warp(np.dstack([src, alpha]), Mf)
        img += (fr[..., :3] - img) * fr[..., 3:]
        self.draw_glints(img, 'front', Mf, t, night)
        self.draw_burst(img, Mf, t, night)
        return img

    def front_source(self, L, t, state):
        alpha = np.maximum(L['fronta'], L['birda'])
        if state == 'gone':
            return L['front_bare'], L['fronta']
        src = L['front']
        y0, y1, x0, x1 = self.bbox
        patch = src[y0:y1, x0:x1]
        bare = L['front_bare'][y0:y1, x0:x1]
        bird = L['birda'][y0:y1, x0:x1]
        FX, FY, FS, LEAN = self.perch
        # Glance: the head turns towards the viewer and back, pivoting at the neck.
        g = ease((t - PERCH_GLANCE[0]) / 0.18) - ease((t - PERCH_GLANCE[1]) / 0.22)
        nod = 0.012 * math.sin(2 * math.pi * 1.1 * t)
        ang = math.radians(-7) * g + math.radians(3) * ease((t - 1.15) / 0.15) * (1 - ease((t - CROUCH) / 0.1))
        crouch = ease((t - CROUCH) / 0.24)
        nx, ny = self.P(-6, -78)
        nx, ny = nx - x0, ny - y0
        yy, xx = np.mgrid[:y1 - y0, :x1 - x0].astype(np.float32)
        head = ease((ny + 10 - yy) / 26)
        c, s = np.cos(ang * head), np.sin(ang * head)
        dx, dy = xx - nx, yy - ny
        mapx = nx + c * dx + s * dy
        mapy = ny - s * dx + c * dy
        # Breathing and the crouch: squash towards the feet and lean forward.
        fy = FY - y0
        k = 1 - (0.006 * math.sin(2 * math.pi * 0.9 * t) + 0.07 * crouch) * ease((fy - yy) / 40)
        lean = 0.10 * crouch
        mapy = fy + (mapy - fy) / k
        mapx = mapx + lean * (fy - yy) * (1 + nod)
        p2 = remap(patch, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        b2 = remap(bird, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        if state == 'leaving':
            b2 = b2 * (1 - ease((t - LAUNCH) / 0.07))
        out = src.copy()
        out[y0:y1, x0:x1] = bare + (p2 - bare) * b2[..., None]
        al = L['fronta'].copy()
        al[y0:y1, x0:x1] = np.maximum(al[y0:y1, x0:x1], b2)
        return out, al

    # ---------------------------------------------------------------- sky life
    def draw_stars(self, img, M, t):
        for sx, sy, r, ph, f in self.stars:
            x, y = apply(M, sx, sy)
            v = 0.3 + 0.7 * (0.5 + 0.5 * math.sin(f * t + ph)) ** 2
            ix, iy = int(x), int(y)
            if not (0 <= ix < W and 0 <= iy < H):
                continue
            c = img[iy, ix] * (1 - v * 0.85) + np.float32([0.93, 0.94, 1.0]) * v * 0.85
            cv2.circle(img, (int(x * 4), int(y * 4)), int(r * 4), tuple(float(q) for q in c), -1, cv2.LINE_AA, shift=2)

    def draw_meteor(self, img, t, skym):
        t0, t1 = 0.55, 1.15
        if not (t0 <= t <= t1):
            return
        u = (t - t0) / (t1 - t0)
        a = np.float32([1180, 70])
        bpt = np.float32([930, 215])
        head = a + (bpt - a) * ease_out(u)
        tail = a + (bpt - a) * max(0.0, ease_out(u) - 0.28)
        fade = math.sin(math.pi * u) ** 0.8
        buf = np.zeros((H // 2, W // 2), np.float32)
        n = 24
        for j in range(n):
            q = j / (n - 1)
            p0 = tail + (head - tail) * q
            cv2.circle(buf, (int(p0[0] * 2), int(p0[1] * 2)), max(1, int(3 * q)), q ** 2, -1, cv2.LINE_AA, shift=2)
        buf = cv2.GaussianBlur(buf, (0, 0), 0.8)
        buf = cv2.resize(buf, (W, H)) * fade
        img += (np.float32([0.97, 0.95, 1.0]) - img) * (np.clip(buf * 1.6, 0, 1) * skym)[..., None]

    def draw_spindrift(self, img, M, t, night):
        buf = np.zeros((H, W), np.float32)
        wind = np.float32([58, -3])
        for pi, phase, jx, jy, sz in self.plume:
            px, py = self.peaks[pi]
            age = (t * 0.55 + phase) % 2.4
            life = age / 2.4
            x = px + 3 + wind[0] * age + 8 * jx * life + 5 * math.sin(3 * age + jy) * life
            y = py + 2 + wind[1] * age + 12 * jy * life + 4 * age * age
            sx, sy = apply(M, x, y)
            a = (1 - life) ** 1.8 * min(1, age * 14) * 0.15
            r = 1.5 + 11 * life ** 0.7 * sz
            add_blob(buf, sx, sy, r, a)
        buf = cv2.GaussianBlur(buf, (0, 0), 1.5)
        col = np.float32([0.88, 0.87, 0.99]) if night else np.float32([1, 1, 1])
        img += (col - img) * np.clip(buf, 0, 0.7)[..., None]

    def draw_glints(self, img, which, M, t, night):
        for w, gx, gy, t0, s in self.glints:
            if w != which:
                continue
            e = math.exp(-((t - t0) / 0.16) ** 2)
            if e < 0.02:
                continue
            x, y = apply(M, gx, gy)
            L = 7 * s * e
            col = (0.99, 0.97, 1.0)
            buf = np.zeros((40, 40), np.float32)
            c = (20 * 4, 20 * 4)
            cv2.line(buf, (c[0] - int(L * 4), c[1]), (c[0] + int(L * 4), c[1]), 1.0, 1, cv2.LINE_AA, shift=2)
            cv2.line(buf, (c[0], c[1] - int(L * 4)), (c[0], c[1] + int(L * 4)), 1.0, 1, cv2.LINE_AA, shift=2)
            cv2.circle(buf, c, int(2.2 * 4), 1.0, -1, cv2.LINE_AA, shift=2)
            buf = cv2.GaussianBlur(buf, (0, 0), 0.7) * e
            ix, iy = int(x) - 20, int(y) - 20
            if ix < 0 or iy < 0 or ix + 40 > W or iy + 40 > H:
                continue
            reg = img[iy: iy + 40, ix: ix + 40]
            reg += (np.float32(col) - reg) * np.clip(buf * 0.9, 0, 1)[..., None]

    def draw_burst(self, img, M, t, night):
        u = t - LAUNCH
        if not (0 <= u <= 1.3):
            return
        FX, FY, FS, LEAN = self.perch
        buf = np.zeros((H, W), np.float32)
        for vx, vy, sz, delay in self.burst:
            a = u - delay
            if a <= 0:
                continue
            x = FX + 4 * FS + vx * 150 * a
            y = FY - 2 + vy * 130 * a + 520 * a * a
            sx, sy = apply(M, x, y)
            al = max(0.0, 1 - a / 0.9) ** 1.5
            cv2.circle(buf, (int(sx * 4), int(sy * 4)), int((0.8 + 0.7 * sz) * 4), float(al), -1, cv2.LINE_AA, shift=2)
        buf = cv2.GaussianBlur(buf, (0, 0), 0.9)
        col = np.float32([0.88, 0.87, 0.99]) if night else np.float32([1, 1, 1])
        img += (col - img) * np.clip(buf, 0, 0.85)[..., None]

    # ---------------------------------------------------------------- the falcon
    def ensure_flight(self):
        if self.flight is not None:
            return
        Mf = cam('front', LAUNCH, self.b)
        cx, cy = apply(Mf, *self.perch_centre)
        sc = self.perch_scale * Mf[0, 0] / self.b
        ex = MARK[0] - self.end_off[0]
        ey = MARK[1] - self.end_off[1]
        self.flight = Flight((cx, cy), sc, (ex, ey), self.end_scale)

    def wings(self, t):
        """Wing pose, tail and head through the flight."""
        # Beat phase: a strong burst off the ledge, a glide across the moon,
        # beats through the turn, then the last stroke into the mark.
        def freq(tt):
            if tt < 2.62:
                return 3.9
            if tt < 3.02:
                return 0.0
            return 3.7
        # integrate phase numerically from launch
        n = max(1, int((t - LAUNCH) * 240))
        ts = np.linspace(LAUNCH, t, n + 1)
        phase = 0.78 + float(np.sum([freq(v) for v in ts[:-1]]) * (t - LAUNCH) / n)
        power = 1.0 if t < 2.2 else 0.85
        pose = F3.wingbeat(phase % 1.0, power)
        glide = ease((t - 2.58) / 0.12) * (1 - ease((t - 3.0) / 0.12))
        pose = F3.mix(pose, F3.GLIDE, glide)
        # Out of the perch: wings unfold from the body during the first beat.
        fold_in = 1 - ease((t - LAUNCH) / 0.16)
        tucked = dict(flap=math.radians(30), sweep=math.radians(70), hand_flap=math.radians(10), fold=math.radians(140))
        pose = F3.mix(pose, tucked, fold_in)
        f, roll, mark_w, tilt = self.mark_pose()
        m = ease((t - 3.98) / 0.34)
        pose = F3.mix(pose, mark_w, m)
        bob = -0.025 * math.sin(2 * math.pi * phase) * (1 - glide) * (1 - m)
        return pose, m, bob, tilt

    def draw_falcon(self, img, t, night):
        if t < LAUNCH:
            return
        self.ensure_flight()
        out = 1 - ease((t - FADE) / 0.55)
        if out <= 0:
            return
        settle = ease((t - (SETTLE - 0.12)) / 0.3)
        # Motion blur: several instants across a half-frame shutter.
        shutter = 0.42 / FPS
        samples = 9 if t < SETTLE else 1
        acc_c = None
        for j in range(samples):
            tt = t - shutter * (j / max(1, samples - 1))
            if tt < LAUNCH:
                tt = LAUNCH
            c, cov, box = self.render_bird(tt, night)
            if acc_c is None:
                acc_c, acc_a = c / samples, cov / samples
                acc_box = box
            else:
                c2, a2 = self.fit_box(c, cov, box, acc_box)
                acc_c += c2 / samples
                acc_a += a2 / samples
        x0, y0, x1, y1 = acc_box
        arrive = ease((t - LAUNCH) / 0.06)
        mark = self.mark_cov[y0:y1, x0:x1] if settle > 0 else 0
        col_bird = acc_c / np.maximum(acc_a, 1e-4)[..., None]
        a_bird = acc_a * arrive
        if settle > 0:
            col = col_bird * (1 - settle) + INK * settle
            a = a_bird * (1 - settle) + mark * settle
        else:
            col, a = col_bird, a_bird
        region = img[y0:y1, x0:x1]
        region += (col - region) * (np.clip(a, 0, 1) * out)[..., None]

    def fit_box(self, c, a, box, target):
        X0, Y0, X1, Y1 = target
        oc = np.zeros((Y1 - Y0, X1 - X0, 3), np.float32)
        oa = np.zeros((Y1 - Y0, X1 - X0), np.float32)
        x0, y0, x1, y1 = box
        ix0, iy0, ix1, iy1 = max(x0, X0), max(y0, Y0), min(x1, X1), min(y1, Y1)
        if ix1 > ix0 and iy1 > iy0:
            oc[iy0 - Y0: iy1 - Y0, ix0 - X0: ix1 - X0] = c[iy0 - y0: iy1 - y0, ix0 - x0: ix1 - x0]
            oa[iy0 - Y0: iy1 - Y0, ix0 - X0: ix1 - X0] = a[iy0 - y0: iy1 - y0, ix0 - x0: ix1 - x0]
        return oc, oa

    def render_bird(self, t, night):
        fl = self.flight
        p, f, bank = fl.frame(t)
        pose, m, bob, tilt = self.wings(t)
        sx, sy, sc = screen(p)
        sy += bob * sc * -1
        fm, roll, _, _ = self.mark_pose()
        # Ease the attitude into the mark's.
        fdir = f * (1 - m) + fm * m
        fdir /= np.linalg.norm(fdir)
        bank = bank * (1 - m) + roll * m
        # Leaving the ledge the bird pitches down hard, then levels out.
        dive = ease((t - LAUNCH) / 0.08) * (1 - ease((t - LAUNCH - 0.25) / 0.3))
        fdir = fdir + np.float32([0, -0.5 * dive, 0])
        R = F3.orientation(fdir, bank=bank)
        tail_spread = 0.6 * (1 - ease((t - 2.0) / 0.3)) + 0.5 * ease((t - 3.1) / 0.2) * (1 - m) + 0.2 * m
        pl, light = F3.polys(R, (0, 0), sc, tail_spread=tail_spread, tail_pitch=tilt * m, **pose)
        allp = np.concatenate([q[2] for q in pl])
        bx0, by0 = np.floor(allp.min(0)) - 6
        bx1, by1 = np.ceil(allp.max(0)) + 6
        X0, Y0 = int(max(0, sx + bx0)), int(max(0, sy + by0))
        X1, Y1 = int(min(W, sx + bx1)), int(min(H, sy + by1))
        if X1 <= X0 or Y1 <= Y0:
            return np.zeros((1, 1, 3), np.float32), np.zeros((1, 1), np.float32), (0, 0, 1, 1)
        hh, ww = Y1 - Y0, X1 - X0
        ss = 2
        cbuf = np.zeros((hh * ss, ww * ss, 3), np.float32)
        abuf = np.zeros((hh * ss, ww * ss), np.float32)
        # Moonlight comes from behind the bird.
        mx, my = self.moon_screen
        L = np.float32([(mx - sx) / 900, -(my - sy) / 900, -0.75])
        L /= np.linalg.norm(L)
        dark = np.float32([0.15, 0.14, 0.29])
        dorsal = np.float32([0.26, 0.29, 0.52])
        ventral = np.float32([0.25, 0.22, 0.40])
        chest = np.float32([0.30, 0.25, 0.40])
        for z, name, p2, n, side in pl:
            q = (p2 + [sx - X0, sy - Y0]) * ss
            pts = np.round(q * 16).astype(np.int32)
            if name in ('arm', 'hand'):
                facing = n[2]
                base = dorsal if facing > 0 else ventral
                lit = max(0.0, float(n @ L)) if facing > 0 else max(0.0, -float(n @ L)) * 0.5
                col = base * (0.8 + 0.9 * lit)
                if name == 'hand':
                    col = col * 0.62          # dark primaries
            elif name.startswith('tail'):
                col = dorsal * 0.8
            elif name == 'beak':
                col = np.float32([0.35, 0.36, 0.48])
            else:
                col = dark * (0.75 if side <= 3 else 1.0 + 0.03 * side)
            cv2.fillPoly(cbuf, [pts], tuple(float(v) for v in col), cv2.LINE_AA, shift=4)
            cv2.fillPoly(abuf, [pts], 1.0, cv2.LINE_AA, shift=4)
        # A paler chest when the belly turns to us.
        belly = float((R @ np.float32([0, -1, 0]))[2])
        if belly > 0.05:
            rings = F3.body_rings()
            pts3 = np.concatenate([r[r[:, 1] < r[:, 1].mean()] for r in rings[3:9]])
            p2, _ = F3.project(pts3, R, (0, 0), sc)
            hull = cv2.convexHull(((p2 + [sx - X0, sy - Y0]) * ss).astype(np.float32)).reshape(-1, 2)
            tmp = cbuf.copy()
            cv2.fillPoly(tmp, [np.round(hull * 16).astype(np.int32)], tuple(float(v) for v in chest), cv2.LINE_AA, shift=4)
            cbuf += (tmp - cbuf) * min(1.0, belly * 1.5) * 0.8
        cbuf = cv2.resize(cbuf, (ww, hh), interpolation=cv2.INTER_AREA)
        abuf = cv2.resize(abuf, (ww, hh), interpolation=cv2.INTER_AREA)
        col = cbuf / np.maximum(abuf, 1e-4)[..., None]
        # Paint, not a decal: streaks that travel with the bird.
        tex = cv2.resize(self.feathers, (max(ww, 8), max(hh, 8)))[:hh, :ww]
        col = col * (1 + 0.28 * tex[..., None])
        # Moonlight catches the edge facing the moon.
        ang = math.atan2(my - sy, mx - sx)
        kk = max(1.2, sc / 120)
        Mr = np.float32([[1, 0, -math.cos(ang) * kk], [0, 1, -math.sin(ang) * kk]])
        behind = cv2.warpAffine(abuf, Mr, (ww, hh))
        rim = np.clip(abuf - behind, 0, 1)
        rim_c = np.float32([0.97, 0.90, 0.80]) if night else np.float32([1, 0.97, 0.9])
        col = col + (rim_c - col) * (np.clip(rim, 0, 1) * 0.8)[..., None]
        return col * abuf[..., None], abuf, (X0, Y0, X1, Y1)

    # ---------------------------------------------------------------- title
    def title(self, img, t):
        if t < TITLE:
            return
        out = 1 - ease((t - FADE) / 0.55)
        band = img[TITLE_TOP: TITLE_TOP + 200]
        for i, letter in enumerate(self.letters):
            u = ease((t - TITLE - 0.055 * i) / 0.5)
            if u <= 0:
                continue
            rise = int(round(14 * (1 - u)))
            shifted = np.roll(letter, rise, axis=0)
            band += (INK - band) * (shifted * u * out)[..., None]

    def frame(self, t):
        Mb = cam('back', t, self.b)
        mx, my, _ = self.moon_p
        self.moon_screen = apply(Mb, mx, my)
        if not hasattr(self, 'mark_cov'):
            self.mark_cov = falcon_mask((H, W), MARK[0], MARK[1], MARK[2])
        state = 'perched' if t < LAUNCH else ('leaving' if t < LAUNCH + 0.08 else 'gone')
        img = self.compose('night', t, state)
        if t > DAWN:
            msx, msy = self.moon_screen
            mrs = self.moon_p[2] * Mb[0, 0]
            rr = np.hypot(self.x - msx, self.y - msy) / mrs
            front = np.clip((rr - 1) / 14, 0, 1) ** 0.8 + 0.04 * self.grain
            dawn = ease((t - DAWN - 0.9 * front) / 0.75)
            if dawn.max() > 0:
                day = self.compose('day', t, state)
                img = img + (day - img) * dawn[..., None]
        self.draw_falcon(img, t, True)
        self.title(img, t)
        return np.clip(img, 0, 1)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else HERE / 'out/eyrie2.mp4'
    scene = Scene()
    if '--frames' in sys.argv:
        idx = [int(v) for v in sys.argv[sys.argv.index('--frames') + 1].split(',')]
        for n in idx:
            img = scene.frame(n / FPS)
            Image.fromarray(np.uint8(img * 255 + 0.5)).save(HERE / f'out/f2_{n:03d}.jpg', quality=90)
        return
    import imageio_ffmpeg
    with TemporaryDirectory() as directory:
        folder = Path(directory)
        write_score(folder / 'eyrie.wav', DURATION)
        writer = imageio_ffmpeg.write_frames(
            str(folder / 'eyrie.mp4'), (W, H), fps=FPS, codec='libx264', audio_path=str(folder / 'eyrie.wav'),
            audio_codec='aac', macro_block_size=1, quality=None, ffmpeg_log_level='error',
            output_params=['-b:a', '192k', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart',
                           '-pix_fmt', 'yuv420p'])
        writer.send(None)
        try:
            for n in range(round(DURATION * FPS)):
                img = scene.frame(n / FPS)
                frame = np.uint8(img * 255 + 0.5)
                if n == 0:
                    Image.fromarray(frame).resize((1200, 750), Image.Resampling.LANCZOS).save(
                        HERE / 'out/eyrie2-poster.jpg', quality=89)
                writer.send(frame.tobytes())
                if n % 30 == 0:
                    print('frame', n, flush=True)
        finally:
            writer.close()
        out.parent.mkdir(parents=True, exist_ok=True)
        (folder / 'eyrie.mp4').replace(out)
    print('wrote', out)


if __name__ == '__main__':
    main()
