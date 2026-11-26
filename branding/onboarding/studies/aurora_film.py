"""Aurora Lake opening film.

    python aurora_layers.py 1800
    python aurora_film.py [--frames 0,48] [--audio]

The aurora folds and ripples across the sky and lies again in the lake, which
reflects it live through moving ripples. Stars twinkle, a meteor falls, the
cabin's window flickers and its chimney smokes. The merlin comes in low over
the lake, climbs through the curtain, circles and becomes the mark under the
arch as the name rises; then the aurora flares and settles.
"""
import math
import sys

import cv2
import numpy as np

import kit
import sound as snd
from impasto import fbm
from kit import H, W, XX, YY, ease

NAME = 'aurora_film'
DUR = 7.6
SETTLE, TITLE, FLARE = 4.32, 4.20, 5.55

L = kit.load('aurora_layers')
PH, PW = L['sky'].shape[:2]
k = float(L['k'][0])
HZ = float(L['hz'][0])
cam = kit.Camera(DUR, PW, focus=(800, 470))
DEPTH = dict(sky=0.02, mid=0.042, front=0.11)
PAN = dict(sky=4, mid=10, front=32)
DIFF = L['aurora'] - L['sky']
HEM = L['hem']

rng = np.random.default_rng(3)
ray1 = fbm((1, PW + 2000), 501, scale=26 * k, octaves=3)[0]
ray2 = fbm((1, PW + 2000), 502, scale=70 * k, octaves=2)[0]
WOB = fbm((H, W + 600), 503, scale=26, octaves=3, aspect=9) - 0.5
WOB2 = fbm((H, W + 600), 504, scale=60, octaves=2, aspect=6) - 0.5
SKY_MASK = np.ones((PH, PW), np.float32) * (np.arange(PH)[:, None] < HZ - 120 * k)
STARS = kit.Stars(SKY_MASK, 220, 7, top=0.55, avoid=cv2.GaussianBlur(L['aura'], (0, 0), 8))
SMOKE = [(rng.uniform(0, 3.2), rng.normal(0, 1), rng.uniform(0.6, 1.3)) for _ in range(70)]
win_ys, win_xs = np.nonzero(L['win'] > 0.3)
WIN = (float(win_xs.mean()), float(win_ys.mean()))

falcon = kit.Falcon(
    keys=[(1.20, -120, 760, 250), (1.62, 280, 650, 180), (2.05, 640, 560, 118), (2.45, 980, 470, 84),
          (2.85, 1150, 330, 68), (3.18, 1060, 236, 62), (3.5, 880, 220, 64), (3.82, 800, 268, 72)],
    beats=kit.Beats([(1.20, 2.36, 3.9), (2.36, 2.78, 0), (2.78, 3.22, 3.7), (3.22, 3.56, 0), (3.56, 4.1, 3.7)]),
    mark=(800, 312, 80), settle=SETTLE, blend_at=3.98, light=(800, 150), rim=(0.78, 1.0, 0.86), lit=0.45, rim_amt=0.9,
    palette=dict(dark=(0.07, 0.07, 0.15), dorsal=(0.13, 0.16, 0.28), ventral=(0.11, 0.10, 0.2), chest=(0.2, 0.18, 0.3)),
    tail=lambda t: 0.5 if t < 1.8 else 0.3)
title = kit.Title(top=330, baseline=100, size=100, start=TITLE)


def aurora_light(t, M):
    """The ribbon's light at time t, in screen space."""
    px, py = kit.inverse_grid(M)
    xi = np.clip(px, 0, PW - 1)
    hem = np.interp(xi, np.arange(PW), HEM)
    hf = np.clip((hem - py) / (150 * k), 0, 2)
    sway = 0.4 + 0.6 * hf
    dx = (16 * np.sin(2 * np.pi * px / (760 * k) - 0.55 * t) + 5 * np.sin(2 * np.pi * px / (240 * k) + 1.2 * t + 1)) * sway * k
    dy = 10 * k * np.sin(2 * np.pi * px / (520 * k) - 0.75 * t) + 4 * k * np.sin(2 * np.pi * px / (190 * k) + 1.6 * t)
    d = kit.remap(DIFF, px - dx, py - dy, border=cv2.BORDER_CONSTANT)
    # Rays flicker and run along the curtain; a brighter pulse travels through it.
    i1 = np.clip((xi + 90 * t).astype(np.int32), 0, len(ray1) - 1)
    i2 = np.clip((xi - 50 * t + 400).astype(np.int32), 0, len(ray2) - 1)
    flick = 0.55 + 0.6 * ray1[i1] * (0.6 + 0.4 * ray2[i2])
    pulse_x = ((t * 520 + 200) % (PW + 900)) - 450
    pulse = 1 + 0.55 * np.exp(-((xi - pulse_x) / (260 * k)) ** 2)
    flare = 1 + 0.55 * ease((t - FLARE) / 0.5) * (1 - ease((t - FLARE - 0.9) / 1.1))
    breathe = 1 + 0.08 * math.sin(1.1 * t)
    return d * (flick * pulse * flare * breathe)[..., None]


def frame(t):
    Ms = cam.M(DEPTH['sky'], t, PAN['sky'])
    Mm = cam.M(DEPTH['mid'], t, PAN['mid'])
    Mf = cam.M(DEPTH['front'], t, PAN['front'])
    img = kit.warp(L['sky'], Ms)
    STARS.draw(img, Ms, t)
    kit.meteor(img, t, 0.75, (1350, 80), (1120, 190), dur=0.6)
    img += aurora_light(t, Ms)
    m = kit.warp(np.dstack([L['mtn'], L['mtna']]), Mm)
    kit.over(img, m[..., :3], m[..., 3])

    # The lake mirrors whatever is above it, through slow ripples.
    hz = kit.apply(Mm, 0, HZ)[1]
    d = np.clip((YY - hz) / (H - hz), 0, 1)
    o = int(18 * t)
    wob = WOB[:, o:o + W] * (2 + 22 * d) + WOB2[:, int(8 * t):int(8 * t) + W] * (1 + 8 * d)
    wob += (0.8 + 2.5 * d) * np.sin(0.05 * YY - 1.7 * t + 0.01 * XX)
    sy = np.clip(2 * hz - YY + wob * 0.3 * d, 0, H - 1)
    refl = kit.remap(img, XX + wob * 2.2, sy)
    lake_tex = kit.warp(L['lake'], Mm)
    detail = lake_tex - cv2.GaussianBlur(lake_tex, (0, 0), 6)
    lake = refl * 0.9 + (np.float32([0.063, 0.102, 0.353]) - refl * 0.9) * (0.08 + 0.22 * d)[..., None]
    lake = lake * 0.82 + lake_tex * 0.18 + detail * 0.9
    # The cabin light lies on the water as a broken gold column.
    wx, wy = kit.apply(Mm, *WIN)
    col = np.exp(-((XX - wx) / (16 + 30 * d)) ** 2) * kit.ease((YY - hz) / 6) * np.exp(-(YY - hz) / 260)
    flick = np.clip((WOB[:, (o * 2) % 600: (o * 2) % 600 + W] + 0.15) * 4, 0, 1)
    lake += (np.float32([1.0, 0.69, 0.31]) - lake) * (col * flick * 0.85)[..., None]
    water = kit.ease((YY - hz) / 2 + 0.5)
    img = img + (lake - img) * water[..., None]

    s = kit.warp(np.dstack([L['shore'], L['shorea'], L['smalla']]), Mm)
    kit.over(img, s[..., :3], np.maximum(s[..., 3], s[..., 4]))
    # Window flicker and chimney smoke.
    fl = 1 + 0.18 * math.sin(7.3 * t) * math.sin(3.1 * t + 1) + 0.06 * math.sin(23 * t)
    glow = np.exp(-((XX - wx) ** 2 + ((YY - wy) * 1.6) ** 2) / (2 * 26 ** 2))
    img += (glow * 0.22 * fl)[..., None] * np.float32([1.0, 0.72, 0.35])
    buf = np.zeros((H, W), np.float32)
    cx, cy = kit.apply(Mm, 352 * k, 528 * k)
    for ph, j, sz in SMOKE:
        age = (t + ph) % 3.2
        u = age / 3.2
        x = cx + 40 * age + 10 * j * u + 4 * math.sin(2 * age + j)
        y = cy - 34 * age + 6 * u * u
        kit.add_blob(buf, x, y, 2 + 9 * u * sz, 0.10 * (1 - u) ** 1.5 * min(1, age * 6))
    kit.over(img, np.float32([0.55, 0.6, 0.78]), np.clip(buf, 0, 0.5))

    # Front pines, with the slightest sway.
    px, py = kit.inverse_grid(Mf)
    sway = 1.6 * k * np.sin(0.9 * t + px / (300 * k)) * np.clip((PH - py) / PH, 0, 1) ** 2
    tr = kit.remap(np.dstack([L['trees'], L['treesa']]), px - sway, py, border=cv2.BORDER_CONSTANT)
    kit.over(img, tr[..., :3], tr[..., 3])

    falcon.draw(img, t)
    title.draw(img, t)
    return np.clip(img, 0, 1)


def write_audio(path):
    m = snd.Mix(DUR, seed=4)
    t = m.t
    snd.wind(m, gain=0.07, env=lambda t: snd.smooth(t / 1.2) * 0.8)
    snd.lapping(m, gain=0.035, pan=-0.45)
    snd.shimmer(m, 0.0, DUR, [83, 88, 90, 95], gain=0.012)
    snd.pad(m, [40, 47, 55, 66], 0.0, 1.7, attack=1.1, release=0.7, bright=0.2, gain=0.55)
    for t0, note, vel, p in [(0.22, 76, 0.4, -0.1), (0.55, 83, 0.36, 0.1), (0.86, 79, 0.38, 0), (1.2, 78, 0.33, -0.05)]:
        m.add(snd.piano(note, vel), t0, pan=p, send=0.4)
    meteor = snd.noise_burst(0.7, 3500, 9000, 0.25, 0.25, seed=3)
    m.add(meteor, 0.75, gain=0.04, pan=0.6, send=0.6)
    snd.pad(m, [48, 55, 64, 71], 1.45, 2.8, attack=0.5, release=0.5, bright=lambda t: 0.3 + 0.4 * snd.smooth((t - 1.5) / 1.0), gain=0.6)
    strokes = falcon.strokes()
    snd.wings(m, strokes, ref_scale=150)
    for i, (ts, p, sc) in enumerate(strokes[:4]):
        m.add(snd.piano([72, 76, 79, 83][i], 0.36 + 0.04 * i), ts, pan=p * 0.4, send=0.45)
    snd.pad(m, [45, 52, 60, 71, 79], 2.6, 3.5, attack=0.6, release=0.5, bright=0.45, gain=0.55, send=0.45)
    m.add(snd.celesta(83, 0.5), 2.9, pan=0.4, send=0.7)
    m.add(snd.celesta(90, 0.25), 2.96, pan=0.45, send=0.8)
    snd.pad(m, [47, 54, 64, 66, 71], 3.4, 4.4, attack=0.7, release=0.3, bright=lambda t: 0.4 + 0.4 * snd.smooth((t - 3.4) / 0.9), gain=0.55)
    m.add(snd.piano(78, 0.34), 3.62, pan=0.1, send=0.45)
    snd.mark_sting(m, SETTLE, [(52, 0.5), (59, 0.45), (68, 0.42), (71, 0.4), (78, 0.38)], bell=88)
    snd.pad(m, [40, 47, 56, 64, 66, 71], SETTLE - 0.02, 6.4, attack=0.35, release=1.0,
            bright=lambda t: 0.45 + 0.3 * snd.smooth((t - FLARE) / 1.0), gain=0.6)
    snd.ticks(m, TITLE, [88, 90, 92, 95, 97, 100])
    m.add(snd.piano(83, 0.3), 4.95, pan=0.2, send=0.5)
    m.add(snd.piano(80, 0.27), 5.3, pan=-0.1, send=0.5)
    snd.shimmer(m, FLARE - 0.2, DUR, [76, 80, 83, 88, 92], gain=0.05)
    m.add(snd.celesta(92, 0.3), FLARE + 0.3, pan=-0.25, send=0.8)
    m.add(snd.piano(88, 0.3), FLARE + 0.55, pan=0.1, send=0.6)
    m.add(snd.piano(83, 0.26), 6.5, pan=0.2, send=0.6)
    m.write(path)


if __name__ == '__main__':
    kit.main(frame, DUR, NAME, write_audio, sys.argv)
