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
SUNRISE, FLIGHT, TITLE = .42, .58, 2.11


def ease(value):
    t = np.clip(value, 0, 1)
    return t * t * (3 - 2 * t)


def draw_falcon(image, t):
    """A bird crosses the headland, banks, then settles into the printed falcon mark."""
    u = (t - FLIGHT) / 2.47
    if not 0 < u < 1:
        return
    # A cubic flight path levels out at the wordmark. Ease out of the bank so
    # the painted silhouette can cross-dissolve into Merlin's actual mark.
    q = 1 - (1 - u) ** 1.32
    back = 1 - q
    x = W * (-.045 * back ** 3 + 3 * .15 * back ** 2 * q + 3 * .44 * back * q ** 2 + .5 * q ** 3)
    y = H * (.47 * back ** 3 + 3 * .40 * back ** 2 * q + 3 * .195 * back * q ** 2 + .32 * q ** 3)
    size = 13 + 37 * ease(u)
    flap = math.sin(2 * math.pi * 1.86 * u) * math.sin(math.pi * u) ** 2
    bank = .13 + .45 * math.sin(math.pi * u)
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
    # Only blend the bird's bounding box during the handoff, leaving the
    # brushwork behind it undisturbed.
    x0, y0, w, h = cv2.boundingRect(points // 16)
    x0, y0, x1, y1 = max(0, x0 - 2), max(0, y0 - 2), min(W, x0 + w + 2), min(H, y0 + h + 2)
    if x1 <= x0 or y1 <= y0:
        return
    area = image[y0:y1, x0:x1]
    layer = area.copy()
    cv2.fillPoly(layer, [points - np.int32([x0, y0]) * 16], (45, 53, 54), lineType=cv2.LINE_AA, shift=4)
    opacity = 1 - ease((u - .76) / .24)
    cv2.addWeighted(layer, float(opacity), area, float(1 - opacity), 0, dst=area)


def brush_map(rng, shape):
    """A fixed map of overlapping bristle marks, sampled throughout the shot.
    Stable pigment keeps the sun and the moving light from flickering."""
    height, width = shape
    marks = np.zeros(shape, np.float32)
    for _ in range(4800):
        px, py = rng.integers(width), rng.integers(height)
        length = int(rng.integers(5, 35))
        cv2.ellipse(marks, (px, py), (length, max(2, length // 5)),
                    float(rng.uniform(-40, -10)), 0, 360, float(rng.uniform(-1, 1)), -1)
    return cv2.GaussianBlur(marks, (3, 3), .6)


def painted_sun(image, u, v, tooth, t):
    """Short concentric ochre strokes give the solar disc its own paint surface."""
    rise = ease((t - SUNRISE) / 3.9)
    sx, sy = .76 - .048 * rise, .64 - .31 * rise
    dx, dy = (u - sx) * W / H, v - sy
    distance = np.sqrt(dx * dx + dy * dy)
    angle = np.arctan2(dy, dx)
    radius = .052
    rim = radius * (1 + .021 * np.sin(angle * 7 + .3) + .016 * np.sin(angle * 13))
    sky = np.clip((.582 - v) * H, 0, 1)
    disc = np.clip((rim - distance) * H + .52 * tooth + .5, 0, 1) * sky
    bloom = np.exp(-(distance / .145) ** 2) * (.12 + .42 * rise)
    image += (np.array([255, 224, 158], np.float32) - image) * bloom[..., None]
    # The brush curves around the centre. Keep the outer ring amber and
    # leave fine ridges visible in the lighter impasto at its centre.
    ring = np.sin(distance * 1220 + 2.4 * np.sin(3 * angle) + 2 * angle + tooth) * .52
    pigment = np.clip(.72 - .43 * distance / radius + .095 * ring + .105 * tooth, 0, 1)
    amber = np.array([232, 147, 45], np.float32)
    straw = np.array([255, 231, 132], np.float32)
    pigment_color = amber + (straw - amber) * pigment[..., None]
    image += (pigment_color - image) * disc[..., None]
    reflection = np.exp(-((u - sx + .005 * np.sin(97 * v + t)) /
                          (.018 + .16 * np.maximum(v - .58, 0))) ** 2)
    shimmer = np.maximum(0, np.sin(520 * v + 2.3 * t + 1.9 * tooth + np.sin(25 * u))) ** 5
    water = np.clip((v - .583) * 90, 0, 1) * np.clip((.745 - v) * 80, 0, 1)
    image += (np.array([255, 229, 156], np.float32) - image) * (water * reflection * shimmer * rise * .73)[..., None]


def brand_mask():
    """Typeset the complete word once so kerning survives the ink reveal."""
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', 120)
    mask = Image.new('L', (W, H))
    ImageDraw.Draw(mask).text((W // 2, round(H * .44)), 'Merlin', font=font,
                              fill=255, anchor='mm', stroke_width=0)
    # Use Merlin's own falcon silhouette as the small printer's mark.
    mark = Image.open(ROOT / 'apps/browser/src/components/start/merlin-logo.png').convert('RGBA').getchannel('A')
    mark = mark.crop(mark.getbbox())
    mark.thumbnail((81, 69), Image.Resampling.LANCZOS)
    mask.paste(mark, ((W - mark.width) // 2, round(H * .32) - mark.height // 2))
    return np.asarray(mask, np.float32) / 255


def render(soundtrack, output, poster):
    base = cv2.resize(np.asarray(Image.open(ASSETS / 'MerlinDawn.jpg').convert('RGB')), (W, H))
    y, x = np.mgrid[:H, :W].astype('float32')
    u, v = x / W, y / H
    rng = np.random.default_rng(1240)
    marks = brush_map(rng, (H, W))
    luma = cv2.cvtColor(base, cv2.COLOR_RGB2GRAY).astype('float32')
    relief = np.clip((luma - cv2.GaussianBlur(luma, (0, 0), 4.5)) / 22, -1.5, 1.5)
    # Neighbouring strokes pick up the sun at slightly different moments.
    tooth = marks * .65 + relief * .60
    field_edge = np.interp(u[0], [0, .20, .43, .72, 1], [.67, .74, .78, .79, .75]).astype('float32')
    depth = ease((v - field_edge) / (1 - field_edge))
    light_arrival = .8 + 1.65 * (1 - u) + 1.25 * v + .24 * tooth + .14 * np.sin(u * 21 + v * 13)
    wash_order = .55 * (1 - u) + .45 * v + .15 * tooth
    paper = np.array([249, 246, 235], np.float32) + relief[..., None] * 1.7
    ink = brand_mask()
    writer = imageio_ffmpeg.write_frames(str(output), (W, H), fps=FPS,
        codec='libx264', audio_path=str(soundtrack), audio_codec='aac', macro_block_size=1,
        quality=None, ffmpeg_log_level='error',
        output_params=['-b:a', '192k', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart'])
    writer.send(None)
    try:
        for frame in range(round(SECONDS * FPS)):
            t = frame / FPS
            pullback = ease(t / 4.7)
            zoom = 1.105 - .085 * pullback
            world_u = (u - .5) / zoom + .5 - .014 * (1 - pullback)
            world_v = (v - .5) / zoom + .5 + .022 * (1 - pullback)
            wind = np.sin(10 * u + 3 * v - 2.5 * t) + .32 * np.sin(22 * u - 3.7 * t + 8 * v)
            mx = world_u * W + depth * (15 * wind + 12 * (1 - pullback))
            my = world_v * H + depth * wind * 4
            image = cv2.remap(base, mx.astype('float32'), my.astype('float32'), cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REFLECT).astype('float32')
            # A violet underpainting shows through first. Warm colour returns in
            # patches following the dry marks across sky, cliff, sea and meadow.
            value = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)[..., None]
            underpaint = (.61 * image + .39 * value) * np.array([.81, .66, .86], np.float32)
            underpaint += np.array([18, 9, 31], np.float32)
            light = ease((t - light_arrival) / 1.35)[..., None]
            image = underpaint + (image - underpaint) * light
            pigment = cv2.remap(tooth, mx.astype('float32'), my.astype('float32'), cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_REFLECT)
            painted_sun(image, world_u, world_v, pigment, t)
            image = np.clip(image, 0, 255).astype('uint8')
            draw_falcon(image, t)
            image = image.astype('float32')
            # A broken ink edge sweeps through the mark and lettering. Once dry,
            # the fine edges hold still even while the meadow continues to move.
            signature = ease((t - TITLE - (u - .36) * 2.4 - .20 * tooth - .22 * v) / .58)
            mark_rows = round(H * .37)
            signature[:mark_rows] = ease((t - FLIGHT - 1.88) / .59)
            image += (np.array([35, 48, 47], np.float32) - image) * (ink * signature)[..., None]
            # Lift the pigment into ivory paper at the end on the score's decay.
            wash = ease((t - 5.88 - .62 * wash_order) / .63)
            image += (paper - image) * (.95 * wash[..., None])
            image = np.clip(image, 0, 255).astype('uint8')
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
