"""Render Night Watch. Run with the same offline art tools as the coastal opening."""

import math
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
        density = (0.52 + 0.48 * ease(t / 1.8)) * self.sky * (1 + 0.095 * self.tooth)
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
    def __init__(self):
        alpha = (
            Image.open(ROOT / "apps/browser/src/components/start/merlin-logo.png")
            .convert("RGBA")
            .getchannel("A")
        )
        alpha = alpha.crop(alpha.getbbox())
        alpha.thumbnail((103, 81), Image.Resampling.LANCZOS)
        x, y = (W - alpha.width) // 2, round(0.267 * H) - alpha.height // 2
        self.bounds = np.s_[y : y + alpha.height, x : x + alpha.width]
        self.mark = np.asarray(alpha, dtype="float32") / 255
        # Use the actual extremities of Merlin's inked silhouette for the
        # little star chart. The points disappear into the printed mark.
        anchors = [
            (0.05, 0.02),
            (0.55, 0.20),
            (0.70, 0.48),
            (0.85, 0.40),
            (0.97, 0.51),
            (0.74, 0.57),
            (0.44, 0.76),
            (0.07, 0.90),
            (0.52, 0.56),
            (0.19, 0.17),
        ]
        self.points = np.array([x, y]) + np.array(anchors) * [alpha.width, alpha.height]
        self.edges = [(0, 1), (1, 2), (2, 3), (3, 4), (2, 5), (5, 6), (6, 7), (6, 8), (8, 9)]
        mask = Image.new("L", (W, 170))
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Baskerville.ttc", 132)
        ImageDraw.Draw(mask).text((W / 2, 85), "Merlin", font=font, fill=255, anchor="mm")
        self.text = np.asarray(mask, dtype="float32") / 255
        self.tx = np.linspace(0, 1, W, dtype="float32")[None, :]

    def paint(self, image, t, opacity):
        ink = np.float32([253, 241, 214])
        take = ease((t - 0.62) / 1.05)
        settle = ease((t - 1.90) / 0.82)
        points = np.array([W * 0.5, H * 0.267]) + (self.points - [W * 0.5, H * 0.267]) * (
            2.4 - 1.4 * ease((t - 0.95) / 1.58)
        )
        lines = image.copy() if 0.62 < t < 2.72 else None
        if lines is not None:
            for i, (source, target) in enumerate(self.edges):
                x, y = points[source]
                u = ease((take * 1.75 - i / len(self.edges)) / 0.37)
                if u <= 0:
                    continue
                a = tuple(np.rint([x, y]).astype(int))
                b = tuple(np.rint([x, y] + (points[target] - [x, y]) * u).astype(int))
                cv2.line(lines, a, b, (146, 177, 172), 1, cv2.LINE_AA)
                cv2.circle(lines, a, 2, (244, 228, 184), -1, cv2.LINE_AA)
            cv2.addWeighted(
                lines,
                float(take * (1 - settle)),
                image,
                float(1 - take * (1 - settle)),
                0,
                dst=image,
            )
        area = image[self.bounds]
        area += (ink - area) * (self.mark * settle * opacity)[..., None]
        lettering = image[305:475]
        reveal = ease((t - 2.00 - (self.tx - 0.37) * 2.7) / 0.74)
        lettering += (ink - lettering) * (self.text * reveal * opacity)[..., None]


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
