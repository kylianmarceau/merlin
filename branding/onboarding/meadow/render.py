"""Render the bundled opening film and its stereo soundtrack. Run on macOS with numpy, Pillow,
opencv-python-headless and imageio-ffmpeg installed. These are art tools only.
"""
import math
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from score import write_score


ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / 'packages/shell/macos/Onboarding'
W, H, FPS, SECONDS = 1600, 1000, 30, 7.2
SUNRISE, FLIGHT, TITLE = .42, .94, 2.84


def ease(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def foreground_stems():
    """A few near-field wild oats. Keep the central wordmark and horizon clear."""
    rng = np.random.default_rng(184)
    stems = []
    for root in [-.025, .085, .95, 1.02]:
        for _ in range(7):
            stems.append((root + rng.normal(0, .029), rng.uniform(.13, .37),
                          rng.uniform(-.075, .075), rng.uniform(0, 6.28), rng.uniform(.6, 1.3)))
    return stems


def draw_grass(image, stems, t, reveal):
    # Render only the lower part of the frame; the outer stalks move past the
    # lens faster than the hillside. Curvature increases towards each seed head.
    lower = int(.57 * H)
    overlay = image[lower:].copy()
    for root, height, lean, phase, weight in stems:
        x0 = W * (root + (root - .5) * .14 * reveal)
        y0 = H * (1.08 + .08 * reveal) - lower
        blade = H * height
        gust = math.sin(t * 1.65 - root * 4 + phase * .25) + .27 * math.sin(t * 3 + phase)
        bend = W * lean + blade * .095 * gust
        def point(h):
            return (round(x0 + h * W * lean * .4 + h * h * bend),
                    round(y0 - blade * h + h * h * abs(bend) * .14))
        color = (round(95 + 12 * weight), round(99 + 9 * weight), 70)
        cv2.polylines(overlay, [np.int32([point(h) for h in np.linspace(0, 1, 13)])], False,
                      color, max(1, round(1.5 * weight)), cv2.LINE_AA)
        for j in range(5):
            h = .70 + j * .055
            x1, y1 = point(h)
            side = 1 if j % 2 else -1
            tip = (x1 + round(side * blade * .03 + bend * .055), y1 - round(blade * .032))
            cv2.line(overlay, (x1, y1), tip, color, 1, cv2.LINE_AA)
            cv2.ellipse(overlay, tip, (max(2, round(2 * weight)), max(3, round(4 * weight))),
                        side * 27, 0, 360, (168, 150, 103), -1, cv2.LINE_AA)
    # Blur the strokes by themselves, keeping the underlying meadow sharp.
    original = image[lower:]
    strokes = overlay.astype('float32') - original
    strokes = cv2.GaussianBlur(strokes, (0, 0), 1.35 + 1.7 * reveal)
    original[:] = cv2.addWeighted(original, 1, strokes, .80, 0, dtype=cv2.CV_8U)


def draw_falcon(image, t):
    """Bank across the ridge, take two wingbeats, then glide out over the sea."""
    u = (t - FLIGHT) / 3.65
    if not 0 < u < 1:
        return
    x = W * (-.07 + 1.19 * u)
    y = H * (.52 - .30 * u - .068 * math.sin(math.pi * u))
    size = 11 + 40 * math.sin(math.pi * u * .78) ** 2
    flap = math.sin(2 * math.pi * 2.18 * u) * math.sin(math.pi * u) ** 2
    bank = .19 + .32 * math.sin(math.pi * u)
    # Two swept, pointed wings around a compact body, with the far wing
    # foreshortened as the bird banks. Coordinates face right.
    outline = np.array([
        [.44, -.035], [.31, -.09], [.18, -.075], [.03, -.28],
        [-.48, -1.02 + .56 * flap], [-.29, -.36 + .11 * flap], [-.13, -.07],
        [-.55, -.03], [-.62, .09], [-.16, .075], [-.32, .28 - .12 * flap],
        [-.57, .61 - .37 * flap], [-.10, .35], [.13, .11], [.29, .075], [.42, .04],
    ])
    angle = -.26 + .22 * math.cos(math.pi * u)
    outline[:, 1] *= 1 - bank * .48
    rotation = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
    points = ((outline @ rotation.T * size + [x, y]) * 16).round().astype('int32')
    cv2.fillPoly(image, [points], (62, 69, 67), lineType=cv2.LINE_AA, shift=4)


def render(soundtrack, output, poster):
    stems = foreground_stems()
    base = cv2.resize(np.asarray(Image.open(ASSETS / 'MerlinDawn.jpg').convert('RGB')), (W, H))
    y, x = np.mgrid[:H, :W].astype('float32')
    u, v = x / W, y / H
    field_edge = np.interp(np.arange(W) / W, [0, .22, .5, .73, 1], [.46, .57, .73, .78, .75]).astype('float32')
    depth = np.clip((v - field_edge) / (1 - field_edge), 0, 1)
    waves = np.cos(12 * u + 4 * v)
    sun_x, radius = .748, .037
    rng = np.random.default_rng(402)
    pollen = rng.uniform(size=(27, 4))
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', 128)
    word = 'Merlin'
    letters = []
    for i, char in enumerate(word):
        mask = Image.new('L', (165, 158))
        ImageDraw.Draw(mask).text((15, 115), char, font=font, fill=255, anchor='ls')
        offset = font.getlength(word[:i + 1]) - font.getlength(char)
        letters.append((np.asarray(mask), offset))
    writer = imageio_ffmpeg.write_frames(str(output), (W, H), fps=FPS,
        codec='libx264', audio_path=str(soundtrack), audio_codec='aac', macro_block_size=1, quality=None, ffmpeg_log_level='error',
        output_params=['-b:a', '192k', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart'])
    writer.send(None)
    try:
        for frame in range(round(SECONDS * FPS)):
            t = frame / FPS
            dawn = ease((t - .12) / 4.95)
            reveal = ease(t / 4.3)
            # Wind crosses the meadow in bands. The nearby stalks bend further
            # than the distant ones. The sea and the skyline stay level.
            gust = np.sin(7.8 * u - 2.5 * t + 3.5 * v) + .35 * np.sin(18 * u + 3.1 * t - 6 * v)
            sway = depth ** .85 * gust
            zoom = 1.21 - .18 * reveal
            mx = (x - W / 2) / zoom + W / 2 + sway * 17 + depth * (14 - 25 * reveal) - 24 * (1 - reveal)
            my = (y - H / 2) / zoom + H / 2 + depth * (4 * gust * waves + 8 * dawn) + 47 * (1 - reveal)
            image = cv2.remap(base, mx.astype('float32'), my.astype('float32'), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype('float32')
            image *= np.array([.67 + .38 * dawn, .74 + .274 * dawn, .92 + .052 * dawn], np.float32)
            # Clip the rising sun at the waterline; its bloom extends into the sea fog.
            world_u = ((x - W / 2) / zoom + W / 2 - 24 * (1 - reveal)) / W
            world_v = ((y - H / 2) / zoom + H / 2 + 47 * (1 - reveal)) / H
            sky = np.clip((.541 - world_v) * 440, 0, 1)
            sy = .59 - .203 * ease((t - SUNRISE) / 4.6)
            d2 = ((world_u - sun_x) * W / H) ** 2 + (world_v - sy) ** 2
            halo = np.exp(-d2 / .014) * (.08 + .25 * dawn)
            disc = np.clip((radius * radius - d2) * 12000 + .5, 0, 1) * sky
            glow = (halo + (1 - halo) * disc * .95)[:, :, None]
            image += (np.array([255, 236, 178]) - image) * glow
            # Broken, widening trail of sunlight follows ripples below the horizon.
            water = np.clip((world_v - .542) * 100, 0, 1) * np.clip((field_edge - v) * 50, 0, 1)
            reflection = np.exp(-((world_u - sun_x + .008 * np.sin(120 * world_v + t)) / (.011 + .24 * np.maximum(v - .54, 0))) ** 2)
            ripple = np.maximum(0, np.sin(780 * v + 3 * t + 5 * np.sin(30 * u))) ** 6
            image += (water * reflection * ripple * dawn * 33)[:, :, None]
            for i, (mask, offset) in enumerate(letters):
                amount = ease((t - TITLE - i * .058) / 1.02)
                if amount == 0:
                    continue
                left = round((W - font.getlength(word)) / 2 + offset - 15 + (i - 2) * (1 - amount) * 5)
                top = round(H * .292 + (1 - amount) * 15)
                region = image[top:top + mask.shape[0], left:left + mask.shape[1]]
                region += (np.array([32, 49, 49]) - region) * (mask[..., None] * (amount / 255))
            image = np.clip(image, 0, 255).astype('uint8')
            # Motes catch the light only over the grasses, below the title.
            for px, py, rate, phase in pollen:
                x1 = int(((px + .006 * t + .004 * math.sin(t + phase * 8)) % 1) * W)
                y1 = int((.63 + py * .35 - .009 * t + .008 * math.sin(t * rate + phase * 6)) * H)
                glint = (.36 + .3 * math.sin(t * 1.5 + phase * 9)) * dawn
                tint = tuple((image[y1, x1] * (1 - glint) + np.array([255, 237, 190]) * glint).astype(int).tolist())
                cv2.circle(image, (x1, y1), 1 + int(rate > .73), tint, -1, cv2.LINE_AA)
            draw_grass(image, stems, t, reveal)
            draw_falcon(image, t)
            if frame == 0:
                Image.fromarray(image).resize((1200, 750), Image.Resampling.LANCZOS).save(poster, quality=88)
            writer.send(image.tobytes())
    finally:
        writer.close()


if __name__ == '__main__':
    with TemporaryDirectory(dir=ASSETS) as directory:
        soundtrack = Path(directory) / 'first-light.wav'
        output = Path(directory) / 'first-light.mp4'
        write_score(soundtrack, SECONDS, SUNRISE, FLIGHT, TITLE)
        poster = Path(directory) / 'poster.jpg'
        render(soundtrack, output, poster)
        poster.replace(ROOT / 'apps/browser/src/components/onboarding/first-light-poster.jpg')
        output.replace(ASSETS / 'MerlinFirstLight.mp4')
