"""Render Night Watch. Run with the same offline art tools as the coastal opening."""

import math
import sys
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from fjord import Fjord, skyline


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ASSETS = ROOT / "packages/shell/macos/Onboarding"
sys.path.insert(0, str(ROOT / "scripts"))
from merlin_mark import parse_polygon, start_page_path

UI = ROOT / "apps/browser/src/components/onboarding"
W, H, FPS, DURATION = 1600, 1000, 30, 7.2


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def painting(path):
    return np.asarray(Image.open(path).convert("RGB").resize((W, H), Image.Resampling.LANCZOS))


class Sky:
    """Project folded curtains of light. Folds overlap as they turn edge-on."""

    def __init__(self, base):
        self.width, self.height = W // 2, H // 2
        self.s = np.linspace(-0.25, 1.25, 1500, dtype="float32")[None, :]
        self.alt = np.linspace(0, 1, 120, dtype="float32")[:, None]
        self.row, self.col = np.mgrid[:H, :W].astype("float32")
        self.sky = skyline(base)
        luma = cv2.cvtColor(base, cv2.COLOR_RGB2GRAY).astype("float32")
        self.tooth = np.clip((luma - cv2.GaussianBlur(luma, (0, 0), 2.8)) / 13, -1, 1)
        # The palette knife left broad slabs and narrow raised seams. Use
        # both scales of the painting to break the luminous edge of a curtain.
        body = luma - cv2.GaussianBlur(luma, (0, 0), 12)
        self.pigment = np.clip(0.98 + 0.23 * np.tanh(body / 11) + 0.15 * self.tooth, 0.60, 1.32)
        rng = np.random.default_rng(7428)
        self.stars = []
        for _ in range(179):
            x, y = rng.integers(W), rng.integers(int(H * 0.70))
            if self.sky[y, x] > 0.96:
                self.stars.append(
                    (x, y, rng.uniform(0.38, 1.22), rng.uniform(0, 6.28), rng.uniform(0.68, 1.36))
                )

    def curtain(self, t, distant):
        s, z = self.s, self.alt
        phase = 0.58 * t + (1.65 if distant else 0)
        # The lower hem doubles back across the line of sight. Multiple
        # strands then land on the same pixel and the thin folds shine.
        x = s + 0.099 * np.sin(12.5 * s + phase) + 0.035 * np.sin(23 * s - 0.57 * t)
        y = 0.20 + 0.20 * s + 0.15 * np.sin(7.9 * s + 0.67 * t) + 0.055 * np.cos(16 * s - phase)
        if distant:
            y = 0.53 - 0.15 * s + 0.069 * np.cos(8 * s - phase)
        height = (0.19 if distant else 0.44) * (0.81 + 0.24 * np.sin(9 * s - phase))
        xx = (x + z * (0.095 + 0.038 * np.sin(5 * s)) + 0.025 * z * z) * self.width
        yy = (y - z * height) * self.height
        filament = (
            0.70
            + 0.19 * np.sin(126 * s + 2.8 * np.sin(11 * s + phase))
            + 0.14 * np.cos(294 * s - 1.6 * phase)
            + 0.06 * np.sin(515 * s + phase)
        )
        folds = (
            0.49
            + 0.41 * (0.5 + 0.5 * np.sin(17 * s + phase)) ** 2
            + 0.20 * np.cos(8 * s - 0.73 * t) ** 4
        )
        envelope = np.exp(-3.9 * z) * (1 - z) ** 1.4
        weights = filament * folds * envelope * (0.36 + 0.64 * ease(z / 0.028))
        ix, iy = np.floor(xx).astype(int), np.floor(yy).astype(int)
        valid = (ix >= 0) & (ix < self.width - 1) & (iy >= 0) & (iy < self.height - 1)
        fx, fy = xx[valid] - ix[valid], yy[valid] - iy[valid]
        at = iy[valid] * self.width + ix[valid]
        radiance = np.zeros(self.height * self.width)
        for offset, fraction in [
            (0, (1 - fx) * (1 - fy)),
            (1, fx * (1 - fy)),
            (self.width, (1 - fx) * fy),
            (self.width + 1, fx * fy),
        ]:
            radiance += np.bincount(
                at + offset, weights=weights[valid] * fraction, minlength=radiance.size
            )
        light = cv2.GaussianBlur(
            radiance.reshape(self.height, self.width).astype("float32"), (0, 0), 1.12
        )
        light = 1 - np.exp(-light * (0.52 if distant else 0.89))
        haze = cv2.GaussianBlur(light, (0, 0), 6.3)
        return cv2.resize(light * 0.82 + haze * 0.35, (W, H), interpolation=cv2.INTER_LINEAR)

    def paint(self, image, t):
        jade = self.curtain(t, False)
        violet = self.curtain(t, True)
        density = (0.52 + 0.48 * ease(t / 1.8)) * self.sky * self.pigment
        jade *= density
        violet *= density
        emission = jade[..., None] * np.float32([53, 223, 143])
        emission += (jade**2)[..., None] * np.float32([126, 68, 81])
        emission += violet[..., None] * np.float32([128, 81, 165])
        image += emission
        for x, y, radius, phase, frequency in self.stars:
            visibility = (0.54 + 0.37 * math.sin(frequency * t + phase) ** 2) * (
                1 - 0.46 * jade[y, x]
            )
            colour = tuple(float(k) for k in (np.float32([146, 174, 188]) * visibility + 43))
            cv2.circle(
                image, (int(x * 16), int(y * 16)), round(radius * 16), colour, -1, cv2.LINE_8, 4
            )
        return emission


class Constellation:
    """One set of closed master contours drives the chart, stars and wet ink."""

    SCALE = 4
    TILE = 248

    def __init__(self):
        # The same source used by the new-tab glyph already separates out the
        # terminal prompt. Its even-odd contours include the eye and wing cuts.
        paths = []
        for command, coordinates in parse_polygon(start_page_path("falcon")):
            if command == "M":
                path = []
            if coordinates:
                path.append(coordinates)
            if command == "Z":
                paths.append(np.array(path + path[:1], dtype="float32"))
        points = np.concatenate(paths)
        centre = (points.max(0) + points.min(0)) / 2
        factor = 103 / np.ptp(points[:, 0])
        self.paths = sorted(
            ((p - centre) * factor for p in paths),
            key=lambda p: cv2.arcLength(p, True),
            reverse=True,
        )
        self.lengths = [
            np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))] for p in self.paths
        ]
        # Only put stars on turns in an actual contour. Wide spacing at the
        # chart scale keeps the negative spaces between feathers legible.
        self.knots = []
        self.guides = []
        for path, arc in zip(self.paths, self.lengths):
            corners = cv2.approxPolyDP(path, 1.8, True).reshape(-1, 2)
            # Draw a straight chord between feather tips first. Each chord
            # unfolds along its source arc as the stars settle into the mark.
            indices = sorted(
                {
                    0,
                    len(path) - 1,
                    *(int(np.argmin(np.linalg.norm(path - v, axis=1))) for v in corners),
                }
            )
            self.guides.append(
                np.column_stack(
                    [np.interp(arc, arc[indices], path[indices, axis]) for axis in (0, 1)]
                )
            )
            for vertex in corners:
                if all(np.linalg.norm(vertex - p) > 7.0 for p in self.knots):
                    self.knots.append(vertex)
        start_x, start_y = (W - self.TILE) // 2, round(0.267 * H) - self.TILE // 2
        self.final_mask = self.silhouette(1)
        self.bounds = np.s_[start_y : start_y + self.TILE, start_x : start_x + self.TILE]
        mask = Image.new("L", (W, 170))
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Baskerville.ttc", 132)
        ImageDraw.Draw(mask).text((W / 2, 85), "Merlin", font=font, fill=255, anchor="mm")
        self.text = np.asarray(mask, dtype="float32") / 255
        self.tx = np.linspace(0, 1, W, dtype="float32")[None, :]

    def silhouette(self, zoom):
        # Rasterise only the small bird bounds. Sixteen samples across a
        # pixel preserve the narrow clearances between individual feathers.
        scale = 16
        pad = math.ceil(53 * zoom) + 1
        mask = np.zeros((2 * pad * scale, 2 * pad * scale), np.uint8)
        paths = [np.rint(((p * zoom + pad) * scale - 0.5) * 16).astype("int32") for p in self.paths]
        cv2.fillPoly(mask, paths, 255, shift=4)
        alpha = np.zeros((self.TILE, self.TILE), np.float32)
        box = slice(self.TILE // 2 - pad, self.TILE // 2 + pad)
        alpha[box, box] = cv2.resize(mask, (2 * pad, 2 * pad), interpolation=cv2.INTER_AREA) / 255
        return alpha

    def bird(self, area, t, opacity):
        if t <= 0.32 or opacity <= 0:
            return
        zoom = 1 + 0.84 * (1 - ease((t - 1.34) / 1.37))
        scale = self.SCALE

        def project(p):
            return np.rint((p * zoom + self.TILE / 2) * scale).astype("int32")

        def coverage(mask):
            return (
                cv2.resize(mask, (self.TILE, self.TILE), interpolation=cv2.INTER_AREA).astype(
                    "float32"
                )
                / 255
            )

        settle = ease((t - 1.72) / 1.02)
        if settle > 0:
            silhouette = self.final_mask if zoom == 1 else self.silhouette(zoom)
            # Ink catches the quill tips before it travels across the beak.
            x = (np.arange(self.TILE) - self.TILE / 2) / (103 * zoom) + 0.5
            ink = silhouette * ease((settle * 1.6 - 0.52 * x) / 0.98)
            area += (np.float32([253, 241, 214]) - area) * (ink * opacity)[..., None]

        if t >= 2.78:
            return
        trace = np.zeros((self.TILE * scale, self.TILE * scale), np.uint8)
        lights = np.zeros_like(trace)
        refine = ease((t - 1.30) / 0.72)
        for i, (contour, guide, arc) in enumerate(zip(self.paths, self.guides, self.lengths)):
            path = guide + (contour - guide) * refine
            amount = ease((t - 0.42 - 0.052 * i) / (0.94 if i < 2 else 0.67))
            if amount <= 0:
                continue
            stop = amount * arc[-1]
            j = np.searchsorted(arc, stop, side="left").clip(1, len(arc) - 1)
            mix = (stop - arc[j - 1]) / (arc[j] - arc[j - 1])
            tip = path[j - 1] + mix * (path[j] - path[j - 1])
            cv2.polylines(trace, [project(np.vstack((path[:j], tip)))], False, 255, scale)
            if amount < 1:
                cv2.circle(lights, tuple(project(tip)), 2 * scale, 255, -1)
        for i, p in enumerate(self.knots):
            bloom = ease((t - 0.32 - 0.027 * i) / 0.25)
            if bloom > 0:
                cv2.circle(
                    lights,
                    tuple(project(p)),
                    round(scale * (1.2 if i % 4 else 1.85)),
                    round(255 * bloom),
                    -1,
                )
        remaining = (1 - ease((t - 1.97) / 0.81)) * opacity
        area += (np.float32([200, 219, 212]) - area) * (coverage(trace) * remaining * 0.95)[
            ..., None
        ]
        cores = coverage(lights)
        shine = cores + 0.65 * cv2.GaussianBlur(cores, (0, 0), 1.5)
        area += (np.float32([255, 231, 178]) - area) * (shine.clip(0, 1) * remaining)[..., None]

    def paint(self, image, t, opacity):
        self.bird(image[self.bounds], t, opacity)
        lettering = image[305:475]
        reveal = ease((t - 2.14 - (self.tx - 0.37) * 2.7) / 0.74)
        lettering += (np.float32([253, 241, 214]) - lettering) * (self.text * reveal * opacity)[
            ..., None
        ]


def score(path):
    """An original glass-and-strings cue, with each star entering on a bell."""
    rate = 48000
    time = np.arange(round(DURATION * rate)) / rate
    stereo = np.zeros((len(time), 2))
    envelope = np.sin(math.pi * time / DURATION) ** 1.55
    for i, base in enumerate([110, 164.81, 246.94]):
        for channel in range(2):
            hz = base * (1 + channel * 0.0013)
            stereo[:, channel] += (
                (0.022 / (1 + i))
                * envelope
                * (
                    np.sin(2 * math.pi * hz * time + 0.28 * np.sin(2.3 * time + i))
                    + 0.32 * np.sin(4 * math.pi * hz * time)
                )
            )
    for start, hz, pan, gain in [
        (0.4, 329.63, -0.25, 0.095),
        (1.04, 493.88, 0.21, 0.075),
        (1.89, 659.25, -0.16, 0.065),
        (2.65, 554.37, 0.18, 0.081),
        (4.26, 369.99, 0, 0.062),
    ]:
        dt = time[time >= start] - start
        bell = (
            np.sin(2 * math.pi * hz * dt)
            + 0.29 * np.sin(2 * math.pi * 2.71 * hz * dt) * np.exp(-2 * dt)
            + 0.15 * np.sin(2 * math.pi * 4.14 * hz * dt) * np.exp(-4 * dt)
        )
        signal = bell * gain * (1 - np.exp(-dt / 0.018)) * np.exp(-dt / 1.35)
        stereo[-len(dt) :] += signal[:, None] * np.sqrt([(1 - pan) / 2, (1 + pan) / 2])
    # Low water against the hull, heard under the existing glass cue.
    rng = np.random.default_rng(630)
    frequencies = np.fft.rfftfreq(len(time), 1 / rate)
    for channel in range(2):
        noise = np.fft.rfft(rng.normal(size=len(time)))
        band = (1 - np.exp(-((frequencies / 270) ** 2))) / (1 + (frequencies / 1700) ** 3)
        lap = np.fft.irfft(noise * band, n=len(time))
        wash = (0.5 + 0.5 * np.sin(2.05 * time + 0.5 * channel + 0.28 * np.sin(3 * time))) ** 3
        stereo[:, channel] += 0.0048 * envelope * (0.2 + wash) * lap / np.std(lap)
    dry = stereo.copy()
    for delay, gain in [(0.13, 0.17), (0.243, 0.1), (0.385, 0.062)]:
        n = round(delay * rate)
        stereo[n:] += dry[:-n, ::-1] * gain
    stereo *= (1.62 * ease((DURATION - time) / 0.9))[:, None]
    with wave.open(str(path), "wb") as out:
        out.setparams((2, 2, rate, 0, "NONE", "not compressed"))
        out.writeframes((np.clip(stereo, -1, 1) * 32767).astype("<i2").tobytes())


def render():
    base = painting(HERE / "fjord.jpg")
    day = painting(ASSETS / "MerlinAlpenglow.jpg").astype("float32")
    sky, fjord, stars = Sky(base), Fjord(base), Constellation()
    # The day painting is revealed from the high right-hand peaks across
    # the water, as the last bell fades into the appearance question.
    front = 0.30 * (1 - sky.col / W) + 0.38 * sky.row / H + 0.043 * sky.tooth
    with TemporaryDirectory() as directory:
        folder = Path(directory)
        score(folder / "night.wav")
        writer = imageio_ffmpeg.write_frames(
            str(folder / "night.mp4"),
            (W, H),
            fps=FPS,
            codec="libx264",
            audio_path=str(folder / "night.wav"),
            audio_codec="aac",
            macro_block_size=1,
            quality=None,
            ffmpeg_log_level="error",
            output_params=[
                "-b:a",
                "192k",
                "-crf",
                "18",
                "-preset",
                "medium",
                "-movflags",
                "+faststart",
            ],
        )
        writer.send(None)
        try:
            for n in range(round(DURATION * FPS)):
                t = n / FPS
                image = base.astype("float32")
                emission = sky.paint(image, t)
                wash = ease((t - 5.59 - front) / 0.80)
                image += (day - image) * wash[..., None]
                fjord.water(image, emission, t, 1 - wash[fjord.top :])
                fjord.waterfall(image, t)
                fjord.boat(image, t, 1 - float(wash[758, 900]))
                if n == 124:
                    Image.fromarray(np.uint8(np.clip(image, 0, 255))).save(
                        folder / "night.jpg", quality=92
                    )
                stars.paint(image, t, 1 - ease((t - 5.72) / 0.73))
                frame = np.uint8(np.clip(image, 0, 255))
                if n == 0:
                    Image.fromarray(frame).resize((1200, 750), Image.Resampling.LANCZOS).save(
                        folder / "poster.jpg", quality=89
                    )
                writer.send(frame.tobytes())
        finally:
            writer.close()
        (folder / "night.mp4").replace(ASSETS / "MerlinNightWatch.mp4")
        (folder / "night.jpg").replace(ASSETS / "MerlinAurora.jpg")
        (folder / "poster.jpg").replace(UI / "night-watch-poster.jpg")


if __name__ == "__main__":
    render()
