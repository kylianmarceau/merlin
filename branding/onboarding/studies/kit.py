"""Shared machinery for the onboarding films.

Camera push-in over depth layers, the jointed falcon's flight and its handoff
into Merlin's mark, the title that rises letter by letter, a light change that
spreads from a point, and encoding with a score.
"""
import math
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import falcon3d as F3
from impasto import falcon_mask, fbm

HERE = Path(__file__).resolve().parent
W, H, FPS = 1600, 1000, 30
INK = np.float32([253, 241, 214]) / 255
YY, XX = np.mgrid[:H, :W].astype(np.float32)


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = np.clip(x, 0, 1)
    return 1 - (1 - x) ** 3


def remap(src, mx, my, interp=cv2.INTER_LINEAR, border=cv2.BORDER_REFLECT_101, value=0):
    return cv2.remap(np.float32(src), np.float32(mx), np.float32(my), interp, borderMode=border, borderValue=value)


def add_blob(buf, x, y, r, a):
    """Add a soft round puff so overlapping puffs build up density."""
    n = int(r * 2.2) + 2
    x0, y0 = int(x) - n, int(y) - n
    h, w = buf.shape[:2]
    if x0 >= w or y0 >= h or x0 + 2 * n < 0 or y0 + 2 * n < 0:
        return
    yy, xx = np.mgrid[y0:y0 + 2 * n + 1, x0:x0 + 2 * n + 1].astype(np.float32)
    g = a * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * (0.55 * r) ** 2))
    ax0, ay0, ax1, ay1 = max(0, x0), max(0, y0), min(w, x0 + 2 * n + 1), min(h, y0 + 2 * n + 1)
    buf[ay0:ay1, ax0:ax1] += g[ay0 - y0: ay1 - y0, ax0 - x0: ax1 - x0]


def over(img, rgb, a):
    img += (rgb - img) * a[..., None]


def load(name):
    z = np.load(HERE / f'out/{name}.npz')
    return {k: np.float32(z[k]) for k in z.files}


# ---------------------------------------------------------------- camera

class Camera:
    """Each depth scales about a focus as the camera pushes in."""

    def __init__(self, duration, paint_w, focus=(800, 450), amount=1.0):
        self.dur = duration
        self.b = W / paint_w
        self.focus = np.float32(focus)
        self.amount = amount

    def push(self, t):
        u = t / self.dur
        return (ease_out(u) * 0.85 + 0.15 * u) * self.amount

    def M(self, depth, t, pan=0.0, dx=0.0, dy=0.0):
        z = 1 + depth * self.push(t)
        fx, fy = self.focus
        sx = -pan * self.push(t)
        b = self.b
        return np.float32([[z * b, 0, fx - z * fx + sx + dx * z * b], [0, z * b, fy - z * fy - 0.35 * pan * self.push(t) + dy * z * b]])


def apply(M, x, y):
    return M[0, 0] * x + M[0, 2], M[1, 1] * y + M[1, 2]


def warp(img, M, border=cv2.BORDER_REPLICATE):
    return cv2.warpAffine(np.float32(img), M, (W, H), flags=cv2.INTER_LINEAR, borderMode=border)


def warp_band(img, M, y0):
    M = M.copy()
    M[1, 2] += M[1, 1] * y0
    return cv2.warpAffine(np.float32(img), M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def inverse_grid(M, y0=0):
    """Painting coordinates for every screen pixel."""
    return (XX - M[0, 2]) / M[0, 0], (YY - M[1, 2]) / M[1, 1] - y0


# ---------------------------------------------------------------- twinkling stars

class Stars:
    def __init__(self, sky_mask, n, seed, top=0.6, avoid=None):
        rng = np.random.default_rng(seed)
        h, w = sky_mask.shape
        self.s = []
        tries = 0
        while len(self.s) < n and tries < n * 30:
            tries += 1
            x, y = rng.uniform(0, w), rng.uniform(0, h * top) ** 1.0
            if sky_mask[int(y), int(x)] < 0.97:
                continue
            if avoid is not None and avoid[int(y), int(x)] > 0.1:
                continue
            self.s.append((x, y, rng.uniform(0.5, 1.5), rng.uniform(0, 6.3), rng.uniform(1.0, 3.4),
                           rng.uniform(0.5, 1.0)))

    def draw(self, img, M, t, gain=1.0, mask=None):
        for x, y, r, ph, f, b in self.s:
            sx, sy = apply(M, x, y)
            ix, iy = int(sx), int(sy)
            if not (0 <= ix < W and 0 <= iy < H):
                continue
            v = (0.3 + 0.7 * (0.5 + 0.5 * math.sin(f * t + ph)) ** 2) * b * gain
            if mask is not None:
                v *= mask[iy, ix]
            if v < 0.02:
                continue
            c = img[iy, ix] * (1 - v * 0.85) + np.float32([0.93, 0.95, 1.0]) * v * 0.85
            cv2.circle(img, (int(sx * 4), int(sy * 4)), int(r * 4), tuple(float(q) for q in c), -1, cv2.LINE_AA, shift=2)


def meteor(img, t, t0, a, b, sky=None, dur=0.6, gain=1.0):
    if not (t0 <= t <= t0 + dur):
        return
    u = (t - t0) / dur
    a, b = np.float32(a), np.float32(b)
    head = a + (b - a) * ease_out(u)
    tail = a + (b - a) * max(0.0, ease_out(u) - 0.28)
    fade = math.sin(math.pi * u) ** 0.8
    buf = np.zeros((H // 2, W // 2), np.float32)
    for j in range(24):
        q = j / 23
        p0 = tail + (head - tail) * q
        cv2.circle(buf, (int(p0[0] * 2 * 4), int(p0[1] * 2 * 4)), max(4, int(3 * q * 4)), q ** 2, -1, cv2.LINE_AA, shift=2)
    buf = cv2.resize(cv2.GaussianBlur(buf, (0, 0), 0.8), (W, H)) * fade * gain
    a_ = np.clip(buf * 1.6, 0, 1)
    if sky is not None:
        a_ = a_ * sky
    over(img, np.float32([0.97, 0.95, 1.0]), a_)


def glint(img, x, y, size, e, col=(0.99, 0.97, 1.0)):
    """A four-point sparkle."""
    if e < 0.02:
        return
    L = size * e
    buf = np.zeros((48, 48), np.float32)
    c = (24 * 4, 24 * 4)
    cv2.line(buf, (c[0] - int(L * 4), c[1]), (c[0] + int(L * 4), c[1]), 1.0, 1, cv2.LINE_AA, shift=2)
    cv2.line(buf, (c[0], c[1] - int(L * 4)), (c[0], c[1] + int(L * 4)), 1.0, 1, cv2.LINE_AA, shift=2)
    cv2.circle(buf, c, int(2.0 * 4), 1.0, -1, cv2.LINE_AA, shift=2)
    buf = cv2.GaussianBlur(buf, (0, 0), 0.7) * e
    ix, iy = int(x) - 24, int(y) - 24
    if ix < 0 or iy < 0 or ix + 48 > W or iy + 48 > H:
        return
    over(img[iy: iy + 48, ix: ix + 48], np.float32(col), np.clip(buf * 0.9, 0, 1))


# ---------------------------------------------------------------- the falcon

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


class Beats:
    """Wingbeat schedule: segments of (start, end, frequency); frequency 0 is a glide."""

    def __init__(self, segments, p0=0.78):
        self.seg = segments
        self.p0 = p0

    def freq(self, t):
        for a, b, f in self.seg:
            if a <= t < b:
                return f
        return 0.0

    def phase(self, t):
        p = self.p0
        for a, b, f in self.seg:
            if t <= a:
                break
            p += f * (min(t, b) - a)
        return p

    def glide(self, t):
        g = 0.0
        for a, b, f in self.seg:
            if f == 0:
                g = max(g, ease((t - a) / 0.12) * (1 - ease((t - b + 0.12) / 0.12)))
        return g

    def strokes(self, t0, t1):
        out, last = [], math.floor(self.phase(t0))
        t = t0
        while t < t1:
            t += 1 / 1000
            p = math.floor(self.phase(t))
            if p != last:
                last = p
                out.append(t)
        return out


MARK_FIT = np.load(HERE / 'out/mark_pose.npy')


def mark_pose():
    yaw, pitch, roll, flap, sweep, hflap, fold, tilt = [float(v) for v in MARK_FIT]
    f = np.float32([math.cos(yaw) * math.cos(pitch), math.sin(pitch), math.sin(yaw) * math.cos(pitch)])
    return f, roll, dict(flap=flap, sweep=sweep, hand_flap=hflap, fold=fold), tilt


def mark_geometry(width):
    f, roll, wings, tilt = mark_pose()
    R = F3.orientation(f, bank=roll)
    pl, _ = F3.polys(R, (300, 300), 200, tail_spread=0.2, tail_pitch=tilt, **wings)
    cov = F3.coverage((600, 600), pl, ss=2)
    ys, xs = np.nonzero(cov > 0.5)
    s = 200 * width / (xs.max() - xs.min())
    off = (((xs.max() + xs.min()) / 2 - 300) * s / 200, ((ys.max() + ys.min()) / 2 - 300) * s / 200)
    return s, off


class Falcon:
    """keys: (t, x, y, scale) in screen space; the last two keys are added to land on the mark."""

    def __init__(self, keys, beats, mark=(800, 112, 103), settle=4.32, blend_at=3.98, appear=None,
                 fade=(5.8, 0.55), light=(800, -200), rim=(0.97, 0.90, 0.80),
                 palette=None, power=None, tail=None, lit=0.9, rim_amt=0.8):
        self.mark = mark
        self.settle = settle
        self.blend_at = blend_at
        self.beats = beats
        self.appear = appear
        self.fade = fade
        self.light = light
        self.rim = np.float32(rim)
        self.lit, self.rim_amt = lit, rim_amt
        s, off = mark_geometry(mark[2])
        ex, ey = mark[0] - off[0], mark[1] - off[1]
        keys = list(keys) + [(settle, ex, ey, s), (settle + 0.6, ex + 8, ey - 1, s)]
        self.times = [k[0] for k in keys]
        self.pts = np.array([world(*k[1:]) for k in keys])
        self.cov_mark = falcon_mask((H, W), mark[0], mark[1], mark[2])
        pal = dict(dark=(0.15, 0.14, 0.29), dorsal=(0.26, 0.29, 0.52), ventral=(0.25, 0.22, 0.40), chest=(0.30, 0.25, 0.40))
        pal.update(palette or {})
        self.pal = {k: np.float32(v) for k, v in pal.items()}
        self.power = power or (lambda t: 0.9)
        self.tail = tail or (lambda t: 0.3)
        feathers = fbm((256, 256), 77, scale=40, octaves=3, aspect=3.0)
        self.feathers = (feathers - 0.5).astype(np.float32)

    def pos(self, t):
        return catmull(self.pts, self.times, np.clip(t, self.times[0], self.times[-1]))

    def screen_at(self, t):
        return screen(self.pos(t))

    def strokes(self):
        """Downstrokes with pan and closeness, for the sound."""
        out = []
        start = self.appear if self.appear is not None else self.times[0]
        for t in self.beats.strokes(start, self.blend_at + 0.2):
            x, y, sc = self.screen_at(t)
            out.append((t, float(np.clip((x - 800) / 800, -1, 1)), float(sc)))
        return out

    def attitude(self, t):
        dt = 1 / 240
        p = self.pos(t)
        v = (self.pos(t + dt) - self.pos(t - dt)) / (2 * dt)
        a = (self.pos(t + dt) - 2 * p + self.pos(t - dt)) / (dt * dt)
        fwd = np.float32([v[0], v[1] * 0.7, -v[2]])
        if np.linalg.norm(fwd) < 1e-3:
            fwd = np.float32([1, 0, 0])
        f = fwd / np.linalg.norm(fwd)
        r = np.cross(f, np.float32([0, 1, 0]))
        r /= np.linalg.norm(r) + 1e-9
        acc = np.float32([a[0], a[1], -a[2]])
        bank = max(-1.15, min(1.15, math.atan2(float(acc @ r), 14.0)))
        return p, f, bank

    def wings(self, t):
        ph = self.beats.phase(t)
        pose = F3.wingbeat(ph % 1.0, self.power(t))
        g = self.beats.glide(t)
        pose = F3.mix(pose, F3.GLIDE, g)
        f, roll, mark_w, tilt = mark_pose()
        m = ease((t - self.blend_at) / (self.settle - self.blend_at + 0.02))
        pose = F3.mix(pose, mark_w, m)
        bob = -0.025 * math.sin(2 * math.pi * ph) * (1 - g) * (1 - m)
        return pose, m, bob, tilt

    def render(self, t, ss=2):
        p, f, bank = self.attitude(t)
        pose, m, bob, tilt = self.wings(t)
        sx, sy, sc = screen(p)
        sy -= bob * sc
        fm, roll, _, _ = mark_pose()
        fdir = f * (1 - m) + fm * m
        fdir /= np.linalg.norm(fdir)
        bank = bank * (1 - m) + roll * m
        R = F3.orientation(fdir, bank=bank)
        pl, _ = F3.polys(R, (0, 0), sc, tail_spread=self.tail(t) * (1 - m) + 0.2 * m, tail_pitch=tilt * m, **pose)
        allp = np.concatenate([q[2] for q in pl])
        X0, Y0 = int(max(0, sx + allp[:, 0].min() - 6)), int(max(0, sy + allp[:, 1].min() - 6))
        X1, Y1 = int(min(W, sx + allp[:, 0].max() + 6)), int(min(H, sy + allp[:, 1].max() + 6))
        if X1 <= X0 or Y1 <= Y0:
            return None
        hh, ww = Y1 - Y0, X1 - X0
        cbuf = np.zeros((hh * ss, ww * ss, 3), np.float32)
        abuf = np.zeros((hh * ss, ww * ss), np.float32)
        lx, ly = self.light
        L = np.float32([(lx - sx) / 900, -(ly - sy) / 900, -0.75])
        L /= np.linalg.norm(L)
        P = self.pal
        for z, name, p2, n, side in pl:
            q = (p2 + [sx - X0, sy - Y0]) * ss
            pts = np.round(q * 16).astype(np.int32)
            if name in ('arm', 'hand'):
                facing = n[2]
                base = P['dorsal'] if facing > 0 else P['ventral']
                lit = max(0.0, float(n @ L)) if facing > 0 else max(0.0, -float(n @ L)) * 0.5
                col = base * (0.8 + self.lit * lit)
                if name == 'hand':
                    col = col * 0.62
            elif name.startswith('tail'):
                col = P['dorsal'] * 0.8
            elif name == 'beak':
                col = np.float32([0.35, 0.36, 0.48])
            else:
                col = P['dark'] * (0.75 if side <= 3 else 1.0 + 0.03 * side)
            cv2.fillPoly(cbuf, [pts], tuple(float(v) for v in col), cv2.LINE_AA, shift=4)
            cv2.fillPoly(abuf, [pts], 1.0, cv2.LINE_AA, shift=4)
        belly = float((R @ np.float32([0, -1, 0]))[2])
        if belly > 0.05:
            rings = F3.body_rings()
            pts3 = np.concatenate([r[r[:, 1] < r[:, 1].mean()] for r in rings[3:9]])
            p2, _ = F3.project(pts3, R, (0, 0), sc)
            hull = cv2.convexHull(((p2 + [sx - X0, sy - Y0]) * ss).astype(np.float32)).reshape(-1, 2)
            tmp = cbuf.copy()
            cv2.fillPoly(tmp, [np.round(hull * 16).astype(np.int32)], tuple(float(v) for v in P['chest']), cv2.LINE_AA, shift=4)
            cbuf += (tmp - cbuf) * min(1.0, belly * 1.5) * 0.8
        cbuf = cv2.resize(cbuf, (ww, hh), interpolation=cv2.INTER_AREA)
        abuf = cv2.resize(abuf, (ww, hh), interpolation=cv2.INTER_AREA)
        col = cbuf / np.maximum(abuf, 1e-4)[..., None]
        tex = cv2.resize(self.feathers, (max(ww, 8), max(hh, 8)))[:hh, :ww]
        col = col * (1 + 0.28 * tex[..., None])
        ang = math.atan2(ly - sy, lx - sx)
        kk = max(1.2, sc / 120)
        Mr = np.float32([[1, 0, -math.cos(ang) * kk], [0, 1, -math.sin(ang) * kk]])
        rim = np.clip(abuf - cv2.warpAffine(abuf, Mr, (ww, hh)), 0, 1)
        col = col + (self.rim - col) * (np.clip(rim * 1.2, 0, 1) * self.rim_amt)[..., None]
        return col * abuf[..., None], abuf, (X0, Y0, X1, Y1)

    def draw(self, img, t):
        start = self.appear if self.appear is not None else self.times[0]
        if t < start:
            return
        out = 1 - ease((t - self.fade[0]) / self.fade[1])
        if out <= 0:
            return
        settle = ease((t - (self.settle - 0.12)) / 0.3)
        samples = 9 if t < self.settle else 1
        shutter = 0.42 / FPS
        acc = None
        for j in range(samples):
            tt = max(start, t - shutter * j / max(1, samples - 1))
            r = self.render(tt)
            if r is None:
                continue
            c, a, (x0, y0, x1, y1) = r
            if acc is None:
                acc = [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32), [x0, y0, x1, y1]]
            acc[0][y0:y1, x0:x1] += c / samples
            acc[1][y0:y1, x0:x1] += a / samples
            bb = acc[2]
            acc[2] = [min(bb[0], x0), min(bb[1], y0), max(bb[2], x1), max(bb[3], y1)]
        if acc is None and settle <= 0:
            return
        if acc is None:
            acc = [np.zeros((H, W, 3), np.float32), np.zeros((H, W), np.float32), [0, 0, W, H]]
        x0, y0, x1, y1 = acc[2]
        if settle > 0:
            ys, xs = np.nonzero(self.cov_mark > 0.01)
            x0, y0 = min(x0, xs.min()), min(y0, ys.min())
            x1, y1 = max(x1, xs.max() + 1), max(y1, ys.max() + 1)
        arrive = 1.0 if self.appear is None else ease((t - self.appear) / 0.06)
        cb = acc[0][y0:y1, x0:x1]
        ab = acc[1][y0:y1, x0:x1] * arrive
        col = cb / np.maximum(acc[1][y0:y1, x0:x1], 1e-4)[..., None]
        if settle > 0:
            mk = self.cov_mark[y0:y1, x0:x1]
            col = col * (1 - settle) + INK * settle
            a = ab * (1 - settle) + mk * settle
            # A soft bloom as the mark forms.
            bloom = cv2.GaussianBlur(mk, (0, 0), 14) * math.exp(-max(0.0, t - self.settle) / 0.5) * settle * 0.5
            region = img[y0:y1, x0:x1]
            region += INK * (bloom * out)[..., None] * 0.6
        else:
            a = ab
        over(img[y0:y1, x0:x1], col, np.clip(a, 0, 1) * out)


# ---------------------------------------------------------------- title

class Title:
    def __init__(self, top=140, baseline=100, size=118, word='Merlin', start=4.20, fade=(5.8, 0.55), ink=INK,
                 shadow=0.0):
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', size)
        full = font.getlength(word)
        left = W / 2 - full / 2
        self.letters = []
        for i, ch in enumerate(word):
            x0 = left + font.getlength(word[:i])
            mask = Image.new('L', (W, 200))
            ImageDraw.Draw(mask).text((x0, baseline), ch, font=font, fill=255, anchor='ls')
            self.letters.append(np.asarray(mask, np.float32) / 255)
        self.top, self.start, self.fade, self.ink, self.shadow = top, start, fade, np.float32(ink), shadow

    def draw(self, img, t):
        if t < self.start:
            return
        out = 1 - ease((t - self.fade[0]) / self.fade[1])
        if out <= 0:
            return
        band = img[self.top: self.top + 200]
        for i, letter in enumerate(self.letters):
            u = ease((t - self.start - 0.055 * i) / 0.5)
            if u <= 0:
                continue
            shifted = np.roll(letter, int(round(14 * (1 - u))), axis=0)
            if self.shadow:
                sh = cv2.GaussianBlur(np.roll(shifted, 3, axis=0), (0, 0), 6)
                band *= (1 - sh * self.shadow * u * out)[..., None]
            band += (self.ink - band) * (shifted * u * out)[..., None]


def wash(t, start, dist, spread=0.9, length=0.75, grain=None):
    """Light that spreads outwards: dist is 0 at the source and about 1 at the far corner."""
    d = dist if grain is None else dist + 0.04 * grain
    return ease((t - start - spread * d) / length)


GRAIN = cv2.GaussianBlur(np.random.default_rng(5).normal(0, 1, (H, W)).astype(np.float32), (0, 0), 1.2)


# ---------------------------------------------------------------- encode

def encode(frame, duration, out, write_audio, poster=None, every=30):
    import imageio_ffmpeg
    out = Path(out)
    with TemporaryDirectory() as directory:
        folder = Path(directory)
        write_audio(folder / 'score.wav')
        writer = imageio_ffmpeg.write_frames(
            str(folder / 'film.mp4'), (W, H), fps=FPS, codec='libx264', audio_path=str(folder / 'score.wav'),
            audio_codec='aac', macro_block_size=1, quality=None, ffmpeg_log_level='error',
            output_params=['-b:a', '192k', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart',
                           '-pix_fmt', 'yuv420p'])
        writer.send(None)
        try:
            for n in range(round(duration * FPS)):
                img = np.uint8(np.clip(frame(n / FPS), 0, 1) * 255 + 0.5)
                if n == 0 and poster:
                    Image.fromarray(img).resize((1200, 750), Image.Resampling.LANCZOS).save(poster, quality=89)
                writer.send(img.tobytes())
                if n % every == 0:
                    print('frame', n, flush=True)
        finally:
            writer.close()
        out.parent.mkdir(parents=True, exist_ok=True)
        (folder / 'film.mp4').replace(out)
    print('wrote', out)


def frames(frame, idx, prefix):
    for n in idx:
        img = np.uint8(np.clip(frame(n / FPS), 0, 1) * 255 + 0.5)
        Image.fromarray(img).save(HERE / f'out/{prefix}_{n:03d}.jpg', quality=90)


def main(frame, duration, name, write_audio, argv):
    if '--frames' in argv:
        idx = [int(v) for v in argv[argv.index('--frames') + 1].split(',')]
        frames(frame, idx, name)
        return
    if '--audio' in argv:
        write_audio(HERE / f'out/{name}.wav')
        return
    encode(frame, duration, HERE / f'out/{name}.mp4', write_audio, poster=HERE / f'out/{name}-poster.jpg')


# ---------------------------------------------------------------- aurora

_RAY1 = fbm((1, 6000), 501, scale=30, octaves=3)[0]
_RAY2 = fbm((1, 6000), 502, scale=80, octaves=2)[0]


def aurora_light(diff, hem, k, M, t, flare=1.0, sway=1.0):
    """The curtain's light at time t in screen space: folds travel along it, rays flicker, a pulse runs through."""
    pw = diff.shape[1]
    px, py = inverse_grid(M)
    xi = np.clip(px, 0, pw - 1)
    hm = np.interp(xi, np.arange(pw), hem)
    hf = np.clip((hm - py) / (150 * k), 0, 2)
    s = (0.4 + 0.6 * hf) * sway
    dx = (16 * np.sin(2 * np.pi * px / (760 * k) - 0.55 * t) + 5 * np.sin(2 * np.pi * px / (240 * k) + 1.2 * t + 1)) * s * k
    dy = (10 * k * np.sin(2 * np.pi * px / (520 * k) - 0.75 * t) + 4 * k * np.sin(2 * np.pi * px / (190 * k) + 1.6 * t)) * sway
    d = remap(diff, px - dx, py - dy, border=cv2.BORDER_CONSTANT)
    i1 = np.clip((xi / k + 90 * t).astype(np.int32), 0, len(_RAY1) - 1)
    i2 = np.clip((xi / k - 50 * t + 400).astype(np.int32), 0, len(_RAY2) - 1)
    flick = 0.55 + 0.6 * _RAY1[i1] * (0.6 + 0.4 * _RAY2[i2])
    pulse_x = ((t * 520 * k + 200 * k) % (pw + 900 * k)) - 450 * k
    pulse = 1 + 0.55 * np.exp(-((xi - pulse_x) / (260 * k)) ** 2)
    breathe = 1 + 0.08 * math.sin(1.1 * t)
    return d * (flick * pulse * breathe * flare)[..., None]
