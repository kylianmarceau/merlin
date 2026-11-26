"""Alpine Meadow opening film.

    python alpine_layers.py 1800 night && python alpine_layers.py 1800 golden
    python alpine_film.py [--frames 0,48] [--audio]

Night in the high meadow: stars and a moon, thin cloud drifting past, the hut
window glowing with smoke from the chimney, fireflies over the flowers, which
sway in the night air. The merlin stoops from high by the peak, sweeps low
over the meadow and climbs into Merlin's mark as the name rises. Then the sun
reaches the summit first and the light runs down the mountain into golden hour,
and butterflies come out over the flowers.
"""
import math
import sys

import cv2
import numpy as np

import kit
import sound as snd
from impasto import fbm
from kit import H, W, XX, YY, ease

NAME = 'alpine_film'
DUR = 7.6
SETTLE, TITLE, DAWN = 4.32, 4.20, 5.5

T = {'night': kit.load('alpine_night_layers'), 'golden': kit.load('alpine_golden_layers')}
N = T['night']
PH, PW = N['sky'].shape[:2]
k = float(N['k'][0])
cam = kit.Camera(DUR, PW, focus=(820, 520))
DEPTH = dict(sky=0.018, peaks=0.03, forest=0.05, meadow=0.1)
PAN = dict(sky=4, peaks=8, forest=14, meadow=30)

rng = np.random.default_rng(31)
SKY_MASK = np.ones((PH, PW), np.float32) * (np.arange(PH)[:, None] < np.min(N['pkline']) + 40 * k)
SKY_MASK *= (np.arange(PH)[:, None] < N['pkline'][None, :] - 10 * k)
STARS = kit.Stars(SKY_MASK, 230, 112, top=0.7)
WISP = fbm((300, W + 900), 901, scale=90, octaves=4, aspect=8)
SWAY = fbm((H, W + 1200), 902, scale=140, octaves=2, aspect=1.4)
FLIES = [(rng.uniform(0, W), rng.uniform(720, 990), rng.uniform(0, 6.3), rng.uniform(0.6, 1.4), rng.normal(0, 1))
         for _ in range(46)]
BUTTER = [(rng.uniform(100, 1500), rng.uniform(760, 960), rng.uniform(0, 6.3), rng.choice([0, 1])) for _ in range(9)]
SMOKE = [(rng.uniform(0, 3.2), rng.normal(0, 1), rng.uniform(0.6, 1.3)) for _ in range(60)]

falcon = kit.Falcon(
    keys=[(1.15, 1330, -70, 56), (1.5, 1130, 200, 70), (1.9, 860, 430, 100), (2.25, 600, 560, 138),
          (2.6, 400, 500, 132), (2.95, 340, 350, 112), (3.3, 420, 210, 98), (3.65, 580, 128, 92)],
    beats=kit.Beats([(1.15, 2.05, 0), (2.05, 2.95, 3.9), (2.95, 3.35, 0), (3.35, 4.08, 3.6)], p0=0.4),
    settle=SETTLE, blend_at=3.98, light=(330 * 0.889, 170 * 0.889), rim=(0.86, 0.9, 1.0), lit=0.5, rim_amt=0.9,
    palette=dict(dark=(0.08, 0.08, 0.17), dorsal=(0.15, 0.17, 0.32), ventral=(0.13, 0.12, 0.23), chest=(0.24, 0.2, 0.3)),
    tail=lambda t: 0.1 if t < 2.0 else 0.35)
title = kit.Title(start=TITLE)


def compose(tone, t):
    L = T[tone]
    night = tone == 'night'
    Ms = cam.M(DEPTH['sky'], t, PAN['sky'])
    img = kit.warp(L['sky'], Ms)
    if night:
        STARS.draw(img, Ms, t)
        kit.meteor(img, t, 0.7, (1500, 60), (1290, 170), dur=0.55)
    # Thin cloud drifting high across the sky.
    o = int(16 * t)
    wv = WISP[:, o:o + W]
    a = np.clip((wv - 0.6) * 2.6, 0, 1) * np.hanning(300)[:, None]
    y0 = 90
    col = np.float32([0.42, 0.46, 0.82]) if night else np.float32([1.0, 0.93, 0.88])
    kit.over(img[y0:y0 + 300], col, a * (0.35 if night else 0.45))
    Mp = cam.M(DEPTH['peaks'], t, PAN['peaks'])
    p = kit.warp(np.dstack([L['peaks'], L['peaksa']]), Mp)
    kit.over(img, p[..., :3], p[..., 3])
    Mf = cam.M(DEPTH['forest'], t, PAN['forest'])
    f = kit.warp(np.dstack([L['forest'], L['foresta']]), Mf)
    kit.over(img, f[..., :3], f[..., 3])
    Mm = cam.M(DEPTH['meadow'], t, PAN['meadow'])
    m = kit.warp(np.dstack([L['meadow'], L['meadowa']]), Mm)
    kit.over(img, m[..., :3], m[..., 3])
    # Flowers nod in the breeze.
    px, py = kit.inverse_grid(Mm)
    oo = int(70 * t)
    gust = SWAY[:, oo:oo + W] - 0.5
    d = np.clip((py / k - 740) / 260, 0, 1)
    dx = (1.5 * np.sin(1.8 * t + 0.015 * px) + 4 * gust) * (0.3 + d) * k
    fl = kit.remap(np.dstack([L['flowers'], L['flowersa']]), px - dx, py - np.abs(dx) * 0.3, border=cv2.BORDER_CONSTANT)
    amt = 1.0 if tone == 'golden' else 0.55
    cov = fl[..., 3:] / amt
    kit.over(img, fl[..., :3] / np.maximum(cov, 1e-3) * (cov > 0.02), fl[..., 3] * (0.75 if tone == 'night' else 1.0))
    hx, hy = kit.apply(Mm, *L['hut'])
    if night:
        flick = 1 + 0.15 * math.sin(6.7 * t) * math.sin(2.1 * t) + 0.05 * math.sin(21 * t)
        glow = np.exp(-((XX - (hx - 6)) ** 2 + ((YY - (hy - 20)) * 1.4) ** 2) / (2 * 34 ** 2))
        img += (glow * 0.35 * flick)[..., None] * np.float32([1.0, 0.72, 0.36])
    buf = np.zeros((H, W), np.float32)
    for ph, j, sz in SMOKE:
        age = (t + ph) % 3.2
        u = age / 3.2
        kit.add_blob(buf, hx + 18 + 36 * age + 8 * j * u, hy - 62 - 30 * age, 2 + 9 * u * sz, 0.09 * (1 - u) ** 1.5 * min(1, age * 6))
    kit.over(img, np.float32([0.45, 0.48, 0.7]) if night else np.float32([0.95, 0.9, 0.88]), np.clip(buf, 0, 0.5))
    if night:
        for x0, y0, ph, s, j in FLIES:
            x = x0 + 30 * math.sin(0.5 * t + ph) + 10 * t * j
            y = y0 + 14 * math.sin(0.8 * t + ph * 2)
            e = max(0.0, math.sin(1.7 * t + ph * 3)) ** 2
            if e < 0.02:
                continue
            kit.add_blob(img[..., 0], x, y, 9 * s, 0.22 * e)
            kit.add_blob(img[..., 1], x, y, 9 * s, 0.28 * e)
            kit.add_blob(img[..., 2], x, y, 9 * s, 0.05 * e)
            kit.add_blob(img[..., 0], x, y, 2.2 * s, 0.85 * e)
            kit.add_blob(img[..., 1], x, y, 2.2 * s, 0.95 * e)
            kit.add_blob(img[..., 2], x, y, 2.2 * s, 0.35 * e)
    else:
        for x0, y0, ph, c in BUTTER:
            x = x0 + 40 * math.sin(0.6 * t + ph) + 14 * t
            y = y0 + 20 * math.sin(1.1 * t + ph) - 10 * abs(math.sin(5 * t + ph))
            flap = abs(math.sin(14 * t + ph))
            col = (1.0, 1.0, 0.95) if c == 0 else (1.0, 0.85, 0.35)
            for side in (-1, 1):
                pts = np.float32([(x, y), (x + side * 7 * flap, y - 5), (x + side * 6 * flap, y + 3)])
                cv2.fillPoly(img, [np.round(pts * 16).astype(np.int32)], col, cv2.LINE_AA, shift=4)
    return img


def frame(t):
    img = compose('night', t)
    if t > DAWN:
        # Sunlight reaches the summit first and runs down the mountain.
        sx, sy = 1500 * 0.889, 520 * 0.889
        dist = 0.6 * np.clip((YY - 120) / 880, 0, 1) + 0.4 * np.hypot(XX - sx, YY - sy) / 1500
        dawn = kit.wash(t, DAWN, dist, spread=1.25, length=0.8, grain=kit.GRAIN)
        if dawn.max() > 0:
            img = img + (compose('golden', t) - img) * dawn[..., None]
    falcon.draw(img, t)
    title.draw(img, t)
    return np.clip(img, 0, 1)


def write_audio(path):
    m = snd.Mix(DUR, seed=8)
    snd.wind(m, gain=0.07)
    snd.crickets(m, 0.1, DAWN + 0.8, gain=0.012, voices=5)
    for t0, f, p in ((0.6, 640, 0.6), (1.9, 720, -0.4), (3.3, 600, 0.5), (6.0, 680, 0.3), (6.9, 610, -0.5)):
        snd.cowbell(m, t0, gain=0.02, pan=p, f=f, seed=int(t0 * 10))
    snd.birdsong(m, DAWN + 0.5, DUR, gain=0.022, pan=0.4, seed=17, kind='finch')
    snd.pad(m, [43, 50, 58, 65], 0.0, 1.6, attack=1.1, release=0.7, bright=0.2, gain=0.5)
    for t0, note, vel, p in [(0.25, 74, 0.4, -0.1), (0.58, 81, 0.36, 0.1), (0.9, 77, 0.38, 0), (1.22, 75, 0.33, -0.1)]:
        m.add(snd.piano(note, vel), t0, pan=p, send=0.4)
    m.add(snd.noise_burst(0.7, 3500, 9000, 0.25, 0.25, seed=3), 0.7, gain=0.04, pan=0.7, send=0.6)
    # The stoop: air rushing past as the bird dives.
    dive = snd.noise_burst(1.0, 600, 4000, 0.7, 0.2, seed=31)
    m.add(dive * np.linspace(0.3, 1, len(dive)), 1.2, gain=0.05, pan=0.2, send=0.3)
    snd.pad(m, [51, 58, 65, 74], 1.4, 2.8, attack=0.5, release=0.5, bright=lambda t: 0.3 + 0.4 * snd.smooth((t - 1.4) / 1.0), gain=0.6)
    strokes = falcon.strokes()
    snd.wings(m, strokes, ref_scale=120, gain=0.15)
    for i, (ts, p, sc) in enumerate(strokes[:4]):
        m.add(snd.piano([70, 74, 77, 82][i], 0.36 + 0.04 * i), ts, pan=p * 0.4, send=0.45)
    snd.pad(m, [48, 55, 63, 74, 82], 2.6, 3.5, attack=0.6, release=0.5, bright=0.45, gain=0.55, send=0.45)
    m.add(snd.celesta(89, 0.4), 2.3, pan=-0.3, send=0.7)
    snd.pad(m, [53, 60, 70, 72, 77], 3.4, 4.4, attack=0.7, release=0.3, bright=lambda t: 0.4 + 0.4 * snd.smooth((t - 3.4) / 0.9), gain=0.55)
    m.add(snd.piano(82, 0.34), 3.62, pan=-0.1, send=0.45)
    snd.mark_sting(m, SETTLE, [(58, 0.5), (65, 0.45), (74, 0.42), (77, 0.4), (84, 0.38)], bell=89)
    snd.pad(m, [46, 53, 62, 70, 72, 77], SETTLE - 0.02, 6.4, attack=0.35, release=1.0,
            bright=lambda t: 0.45 + 0.35 * snd.smooth((t - DAWN) / 1.2), gain=0.6)
    snd.ticks(m, TITLE, [89, 91, 94, 96, 98, 101])
    m.add(snd.piano(86, 0.3), 4.95, pan=0.2, send=0.5)
    m.add(snd.piano(82, 0.27), 5.3, pan=-0.1, send=0.5)
    snd.pad(m, [74, 77, 82, 86], DAWN, 7.0, attack=1.0, release=0.8, bright=0.6, gain=0.3, send=0.6)
    m.add(snd.noise_burst(2.2, 1800, 7000, 0.9, 0.7, seed=21), DAWN + 0.1, gain=0.025, pan=0.3, send=0.6)
    m.add(snd.celesta(94, 0.3), DAWN + 0.45, pan=0.25, send=0.8)
    m.add(snd.piano(89, 0.3), DAWN + 0.62, pan=0.1, send=0.6)
    m.write(path)


if __name__ == '__main__':
    kit.main(frame, DUR, NAME, write_audio, sys.argv)
