"""Render the Eyrie opening film from the night and day plates.

    python eyrie.py 1600 night --plates && python eyrie.py 1600 day --plates
    python film.py out/eyrie.mp4 [--frames 0,48,96]

The merlin watches from its crag above a moonlit sea of cloud, drops off the
ledge, crosses the moon in silhouette, banks round and settles in the open
sky as Merlin's mark while the name rises letter by letter. Daylight then
spreads out from the moon, which has become the sun.
"""
import math
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from impasto import falcon_contours, fbm
from score import write_score

HERE = Path(__file__).resolve().parent
W, H, FPS, DURATION = 1600, 1000, 30, 7.2
INK = np.float32([253, 241, 214]) / 255      # the cream of Merlin's mark
SHADOW = np.float32([26, 23, 53]) / 255      # the bird against the moon

LAUNCH = 1.62          # the perched bird leaves the ledge
SETTLE = 4.30          # the bird is the mark
TITLE = 4.05           # first letter starts to rise
FADE = 5.55            # title leaves as the light changes
DAWN = 5.45            # daylight starts at the moon


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def load(tone):
    z = np.load(HERE / f'out/eyrie_{tone}_plates.npz')
    return {k: np.float32(z[k]) for k in z.files}


# ---------------------------------------------------------------- the falcon sprite

CONTOURS = falcon_contours()


def sprite(width, sx, sy, angle):
    """Coverage of the mark, scaled by width, mirrored by sx, squashed by sy, rotated."""
    size = int(width * 1.6) + 8
    pad = size // 2
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    m = np.zeros((size * 4, size * 4), np.uint8)
    for p in CONTOURS:
        q = p * np.float32([sx, sy]) * width
        q = q @ np.float32([[c, s], [-s, c]])
        q = (q + pad) * 4
        layer = np.zeros_like(m)
        cv2.fillPoly(layer, [np.round(q * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
        m = np.bitwise_xor(m, layer)
    return cv2.resize(m, (size, size), interpolation=cv2.INTER_AREA).astype(np.float32) / 255, pad


# Flight keys: time, x, y, width, facing (-1 left, +1 right), bank (deg).
KEYS = [
    (1.62, 1248, 486, 150, -1, -12),
    (1.92, 1160, 566, 148, -1, 10),
    (2.40, 930, 470, 140, -1, -4),
    (2.90, 640, 332, 126, -1, -8),
    (3.30, 478, 232, 116, -1, -24),
    (3.56, 452, 150, 110, 0, -10),
    (3.82, 560, 104, 106, 1, -4),
    (4.30, 800, 112, 103, 1, 0),
]


def catmull(points, times, t):
    times = np.asarray(times)
    i = int(np.clip(np.searchsorted(times, t) - 1, 0, len(times) - 2))
    u = (t - times[i]) / (times[i + 1] - times[i])
    p0 = points[max(i - 1, 0)]
    p1, p2 = points[i], points[i + 1]
    p3 = points[min(i + 2, len(points) - 1)]
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)


def flight(t):
    """Position, width, horizontal scale, vertical scale and bank at time t."""
    times = [k[0] for k in KEYS]
    # Ease into the final key so the bird slows as it becomes the mark.
    if t > KEYS[-2][0]:
        span = KEYS[-1][0] - KEYS[-2][0]
        u = min(1.0, (t - KEYS[-2][0]) / span)
        t = KEYS[-2][0] + span * (1 - (1 - u) ** 2)
    pts = np.float32([[k[1], k[2]] for k in KEYS])
    x, y = catmull(pts, times, min(t, times[-1]))
    width = np.interp(t, times, [k[3] for k in KEYS])
    face = np.interp(t, times, [k[4] for k in KEYS])
    bank = np.interp(t, times, [k[5] for k in KEYS])
    # Strong beats off the ledge, two more to turn, then a glide.
    beat = 0.0
    if LAUNCH <= t < 2.75:
        beat = max(0.0, math.sin(2 * math.pi * 4.2 * (t - LAUNCH))) * (1 - (t - LAUNCH) / 1.2)
    elif 3.40 <= t < 3.85:
        beat = max(0.0, math.sin(2 * math.pi * 4.4 * (t - 3.40))) * 0.8
    sy = 1 - 0.55 * beat
    return x, y, width, face, sy, bank


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


TITLE_TOP = 140        # rows of the title band: the name sits clear of the moon
BASELINE = 100         # baseline inside that band


# ---------------------------------------------------------------- the scene

class Scene:
    def __init__(self):
        self.night = load('night')
        self.day = load('day')
        n = self.night
        self.mx, self.my, self.mr0 = n['moon']
        y, x = np.mgrid[:H, :W].astype(np.float32)
        self.x, self.y = x, y
        self.mr = np.hypot(x - self.mx, y - self.my) / self.mr0
        crag = cv2.dilate(n['crag'], np.ones((9, 9), np.uint8))
        clouds = n['clouds'] * (1 - crag)
        # Keep the moving paint off the edges so silhouettes never wobble.
        self.cloud_move = cv2.GaussianBlur(cv2.erode(clouds, np.ones((13, 13), np.uint8)), (0, 0), 6)
        self.cloud_area = clouds
        self.top = int(np.argmax(clouds.max(1) > 0.5)) - 40
        # A wide band of mist that drifts slowly left to right across the cloud sea.
        self.mist = fbm((H - self.top, W + 900), 401, scale=210, octaves=4, aspect=4.5)
        self.mist2 = fbm((H - self.top, W + 900), 402, scale=90, octaves=3, aspect=6)
        rows = np.arange(H - self.top, dtype=np.float32)[:, None] + self.top
        self.depth = np.clip((rows - 600) / 400, 0, 1)
        self.path = np.exp(-((x - self.mx) / (70 + 0.55 * np.clip(y - 600, 0, None))) ** 2) * clouds
        self.grain = cv2.GaussianBlur(np.random.default_rng(5).normal(0, 1, (H, W)).astype(np.float32), (0, 0), 1.2)
        rng = np.random.default_rng(31)
        self.stars = []
        sky = n['sky']
        for _ in range(140):
            sx, sy = int(rng.integers(W)), int(rng.integers(int(H * 0.5)))
            if sky[sy, sx] > 0.95 and self.mr[sy, sx] > 3.2:
                self.stars.append((sx, sy, rng.uniform(0.7, 1.6), rng.uniform(0, 6.3), rng.uniform(1.2, 3.0)))
        bird = n['bird']
        ys, xs = np.nonzero(bird > 0.01)
        self.bird_box = (max(0, ys.min() - 20), min(H, ys.max() + 30), max(0, xs.min() - 20), min(W, xs.max() + 20))
        self.bird = bird
        self.letters = title_layers()
        feathers = fbm((256, 256), 77, scale=40, octaves=3, aspect=3.0)
        self.feathers = (feathers - 0.5).astype(np.float32)
        # Daylight spreads from the moon: near pixels change first.
        self.front = np.clip((self.mr - 1) / 14, 0, 1) ** 0.8 + 0.04 * self.grain

    # Ambient motion shared by both lights.
    def animate(self, img, plate, t, night):
        top = self.top
        region = img[top:]
        yy = self.y[top:] - top
        xx = self.x[top:]
        d = self.depth
        # Billows breathe: a slow displacement that grows towards the viewer.
        phase = 0.011 * xx + 0.035 * yy
        dx = (1.5 + 5.5 * d) * np.sin(phase - 0.9 * t) + (0.8 + 2.5 * d) * np.sin(0.023 * xx - 0.02 * yy + 1.3 * t)
        dy = (0.6 + 2.0 * d) * np.cos(phase * 0.7 - 0.7 * t)
        moved = cv2.remap(plate[top:], xx + dx, yy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        a = self.cloud_move[top:, :, None]
        region += (moved - region) * a
        # Mist drifts across, faster in front.
        off = int(18 * t)
        m1 = self.mist[:, off: off + W]
        m2 = self.mist2[:, int(34 * t): int(34 * t) + W]
        veil = (np.clip((m1 - 0.52) * 2.4, 0, 1) * 0.6 + np.clip((m2 - 0.6) * 2.5, 0, 1) * 0.4)
        veil *= np.clip(self.cloud_area[top:] * 1.4, 0, 1) * (0.35 + 0.65 * d)
        tint = np.float32([0.80, 0.78, 0.95]) if night else np.float32([1.0, 1.0, 1.0])
        region += (tint - region) * (veil * (0.22 if night else 0.3))[..., None]
        # The light on the cloud tops shimmers in moving bands.
        shimmer = 0.5 + 0.5 * np.sin(0.06 * yy - 2.6 * t + 1.7 * np.sin(0.004 * xx + 0.5 * t))
        region *= 1 + (self.path[top:] * (shimmer - 0.5) * (0.10 if night else 0.06))[..., None]

    def sky(self, img, t, night):
        if not night:
            return
        for sx, sy, r, ph, f in self.stars:
            v = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(f * t + ph)) ** 2
            c = img[sy, sx] * (1 - v * 0.85) + np.float32([0.93, 0.94, 1.0]) * v * 0.85
            cv2.circle(img, (sx * 4, sy * 4), int(r * 4), tuple(float(q) for q in c), -1, cv2.LINE_AA, shift=2)
        breathe = 1 + 0.025 * math.sin(1.4 * t)
        halo = np.exp(-np.clip(self.mr - 1, 0, None) / 1.8) * (self.mr > 1)
        img *= (1 + halo * (breathe - 1) * 2)[..., None]

    def falcon(self, img, t):
        out = 1 - ease((t - FADE) / 0.55)
        if t < LAUNCH or out <= 0:
            return
        settle = ease((t - 3.95) / 0.45)
        # A short trail stands in for motion blur while the bird is fast.
        samples = [(t, 1.0)]
        if t < SETTLE:
            samples = [(t - 0.05, 0.18), (t - 0.025, 0.3), (t, 1.0)]
        for tt, alpha in samples:
            if tt < LAUNCH:
                continue
            x, y, width, face, sy, bank = flight(tt)
            sx = face if abs(face) > 0.06 else 0.06 * (1 if face >= 0 else -1)
            cov, pad = sprite(width, sx, sy, bank * (1 if sx > 0 else -1))
            x0, y0 = int(round(x)) - pad, int(round(y)) - pad
            h, w = cov.shape
            ys, ye = max(0, y0), min(H, y0 + h)
            xs, xe = max(0, x0), min(W, x0 + w)
            if ye <= ys or xe <= xs:
                continue
            arrive = ease((tt - LAUNCH) / 0.12)
            c = cov[ys - y0: ye - y0, xs - x0: xe - x0] * alpha * out * arrive
            region = img[ys:ye, xs:xe]
            # Paint, not a decal: streaky feather texture that travels with the bird,
            # lighter on the upper surfaces, darkest at the belly.
            tex = cv2.resize(self.feathers, (w, h))[ys - y0: ye - y0, xs - x0: xe - x0]
            if sx < 0:
                tex = tex[:, ::-1]
            vert = np.linspace(0, 1, h, dtype=np.float32)[ys - y0: ye - y0, None]
            body = SHADOW * (0.8 + 0.45 * tex[..., None]) + (np.float32([0.20, 0.21, 0.42]) - SHADOW) * (1 - vert)[..., None] * 0.6
            ink = body * (1 - settle) + INK * (0.94 + 0.08 * tex[..., None]) * settle
            region += (ink - region) * c[..., None]
            # Moonlight catches only the edge that faces the moon.
            ang = math.atan2(self.my - y, self.mx - x)
            k = max(2, int(width / 45))
            M = np.float32([[1, 0, -math.cos(ang) * k], [0, 1, -math.sin(ang) * k]])
            behind = cv2.warpAffine(c, M, (c.shape[1], c.shape[0]))
            rim = np.clip(c - behind, 0, 1)
            region += (np.float32([0.96, 0.89, 0.78]) - region) * (rim * 0.75 * (1 - settle))[..., None]

    def title(self, img, t):
        if t < TITLE:
            return
        out = 1 - ease((t - FADE) / 0.55)
        band = img[TITLE_TOP: TITLE_TOP + 200]
        for i, letter in enumerate(self.letters):
            u = ease((t - TITLE - 0.06 * i) / 0.5)
            if u <= 0:
                continue
            rise = int(round(14 * (1 - u)))
            shifted = np.roll(letter, rise, axis=0)
            band += (INK - band) * (shifted * u * out)[..., None]

    def frame(self, t):
        n, d = self.night, self.day
        launched = ease((t - LAUNCH) / 0.12)
        # The perched bird gives way to the flying one at the moment of launch.
        night = n['painting'].copy()
        if launched > 0:
            y0, y1, x0, x1 = self.bird_box
            night[y0:y1, x0:x1] += (n['bare'][y0:y1, x0:x1] - night[y0:y1, x0:x1]) * launched
        elif t > LAUNCH - 0.35:
            # Crouch: the bird gathers itself just before it goes.
            y0, y1, x0, x1 = self.bird_box
            k = 1 - 0.04 * ease((t - (LAUNCH - 0.35)) / 0.3)
            patch = n['painting'][y0:y1, x0:x1]
            hh = patch.shape[0]
            M = np.float32([[1, 0, 0], [0, k, (1 - k) * (hh - 30)]])
            night[y0:y1, x0:x1] = cv2.warpAffine(patch, M, (x1 - x0, hh), borderMode=cv2.BORDER_REPLICATE)
            bare = n['bare'][y0:y1, x0:x1]
            cov = cv2.warpAffine(self.bird[y0:y1, x0:x1], M, (x1 - x0, hh))
            night[y0:y1, x0:x1] = bare + (night[y0:y1, x0:x1] - bare) * cov[..., None]
        plate_n = night
        dawn = ease((t - DAWN - 0.9 * self.front) / 0.75) if t > DAWN else np.zeros((H, W), np.float32)
        if np.max(dawn) <= 0:
            img = plate_n.copy()
            self.animate(img, plate_n, t, True)
            self.sky(img, t, True)
        else:
            a = plate_n.copy()
            self.animate(a, plate_n, t, True)
            self.sky(a, t, True)
            b = d['bare'].copy()
            self.animate(b, d['bare'], t, False)
            img = a + (b - a) * dawn[..., None]
        self.falcon(img, t)
        self.title(img, t)
        return np.clip(img, 0, 1)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else HERE / 'out/eyrie.mp4'
    scene = Scene()
    if '--frames' in sys.argv:
        idx = [int(v) for v in sys.argv[sys.argv.index('--frames') + 1].split(',')]
        for n in idx:
            img = scene.frame(n / FPS)
            Image.fromarray(np.uint8(img * 255 + 0.5)).save(HERE / f'out/frame_{n:03d}.jpg', quality=90)
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
                        HERE / 'out/eyrie-poster.jpg', quality=89)
                writer.send(frame.tobytes())
        finally:
            writer.close()
        out.parent.mkdir(parents=True, exist_ok=True)
        (folder / 'eyrie.mp4').replace(out)
    print('wrote', out)


if __name__ == '__main__':
    main()
