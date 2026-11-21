"""Render the bundled silent opening film. Run on macOS with numpy, Pillow,
opencv-python-headless and imageio-ffmpeg installed. These are art tools only.
"""
import math
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / 'packages/shell/macos/Onboarding'
W, H, FPS, SECONDS = 1600, 1000, 30, 6.4


def ease(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def render():
    base = cv2.resize(np.asarray(Image.open(ASSETS / 'MerlinDawn.jpg').convert('RGB')), (W, H))
    y, x = np.mgrid[:H, :W].astype('float32')
    u, v = x / W, y / H
    field_edge = np.interp(np.arange(W) / W, [0, .22, .5, .73, 1], [.46, .57, .73, .78, .75]).astype('float32')
    depth = np.clip((v - field_edge) / (1 - field_edge), 0, 1)
    sky = np.clip((.542 - v) * 440, 0, 1)
    waves = np.cos(12 * u + 4 * v)
    sun_x, radius = .748, .037
    halo_x = ((u - sun_x) * W / H) ** 2
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
    writer = imageio_ffmpeg.write_frames(str(ASSETS / 'MerlinFirstLight.mp4'), (W, H), fps=FPS,
        codec='libx264', macro_block_size=1, quality=None, ffmpeg_log_level='error',
        output_params=['-crf', '18', '-preset', 'medium', '-movflags', '+faststart'])
    writer.send(None)
    try:
        for frame in range(round(SECONDS * FPS)):
            t = frame / FPS
            dawn = ease(t / 4.6)
            # Wind crosses the meadow in bands. The nearby stalks bend further
            # than the distant ones. The sea and the skyline stay level.
            gust = np.sin(7.8 * u - 2.5 * t + 3.5 * v) + .35 * np.sin(18 * u + 3.1 * t - 6 * v)
            sway = depth ** .85 * gust
            zoom = 1.055 - .035 * ease(t / SECONDS)
            mx = (x - W / 2) / zoom + W / 2 + sway * 17 + depth * (8 - 14 * dawn)
            my = (y - H / 2) / zoom + H / 2 + depth * (3 * gust * waves + 5 * dawn)
            image = cv2.remap(base, mx.astype('float32'), my.astype('float32'), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype('float32')
            image *= np.array([.83 + .19 * dawn, .85 + .15 * dawn, .96 + .018 * dawn], np.float32)
            # Clip the rising sun at the waterline; its bloom extends into the sea fog.
            sy = .558 - .165 * ease(t / 5.1)
            d2 = halo_x + (v - sy) ** 2
            halo = np.exp(-d2 / .014) * (.08 + .25 * dawn)
            disc = np.clip((radius * radius - d2) * 12000 + .5, 0, 1) * sky
            glow = (halo + (1 - halo) * disc * .95)[:, :, None]
            image += (np.array([255, 236, 178]) - image) * glow
            # Broken, widening trail of sunlight follows ripples below the horizon.
            water = np.clip((v - .542) * 100, 0, 1) * np.clip((field_edge - v) * 50, 0, 1)
            reflection = np.exp(-((u - sun_x + .008 * np.sin(120 * v + t)) / (.011 + .24 * np.maximum(v - .54, 0))) ** 2)
            ripple = np.maximum(0, np.sin(780 * v + 3 * t + 5 * np.sin(30 * u))) ** 6
            image += (water * reflection * ripple * dawn * 33)[:, :, None]
            for i, (mask, offset) in enumerate(letters):
                amount = ease((t - 1.1 - i * .07) / .86)
                if amount == 0:
                    continue
                left = round((W - font.getlength(word)) / 2 + offset - 15)
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
            writer.send(image.tobytes())
    finally:
        writer.close()


if __name__ == '__main__':
    render()
