"""Tundra Lights opening film.

    python tundra_layers.py 1800 night && python tundra_layers.py 1800 dawn
    python tundra_film.py [--frames 0,48] [--audio]

Night on the tundra: the aurora curtain folds and flickers over the hills,
stars twinkle, a meteor falls, reindeer wander across the far snow, grass
tufts tremble, snow streams low over the field and ice crystals glitter in
the air. The merlin crosses under the curtain and climbs into Merlin's mark
as the name rises; then dawn spreads from the rising sun, the aurora fades
and the snow turns pink and peach.
"""
import math
import sys

import cv2
import numpy as np

import kit
import sound as snd
from impasto import fbm
from kit import H, W, XX, YY, ease

NAME = 'tundra_film'
DUR = 7.6
SETTLE, TITLE, DAWN = 4.32, 4.20, 5.55

T = {'night': kit.load('tundra_night_layers'), 'day': kit.load('tundra_dawn_layers')}
N = T['night']
PH, PW = N['sky'].shape[:2]
k = float(N['k'][0])
HZ = float(N['hz'][0])
cam = kit.Camera(DUR, PW, focus=(800, 520))
DEPTH = dict(sky=0.02, far=0.04, near=0.1)
PAN = dict(sky=4, far=10, near=30)
DIFF = N['aurora'] - N['sky']
SUN = T['day']['sun']

rng = np.random.default_rng(12)
SKY_MASK = np.ones((PH, PW), np.float32) * (np.arange(PH)[:, None] < HZ - 140 * k)
BELOW_HEM = np.float32(np.arange(PH)[:, None] > N['hem'][None, :] - 12 * k)
STARS = kit.Stars(SKY_MASK, 240, 6, top=0.6, avoid=np.maximum(cv2.GaussianBlur(N['aura'], (0, 0), 8), BELOW_HEM))
DRIFT = fbm((H, W + 1600), 701, scale=50, octaves=3, aspect=9)
GLINTS = []
nl = N['nearline']
for _ in range(60):
    gx = rng.uniform(0, PW)
    gy = rng.uniform(np.interp(gx, np.arange(PW), nl) + 20 * k, PH - 10)
    GLINTS.append((gx, gy, rng.uniform(0, DUR), rng.uniform(0.5, 1.1)))
DUST = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(4, 14), rng.normal(0, 1), rng.uniform(0, 6.3),
         rng.uniform(0.5, 1.3)) for _ in range(70)]
# Reindeer: x, y, size, facing, walking speed (painting px/s), gait phase.
DEER = [(760, 676, 1.0, 1, 7, 0.0), (800, 680, 0.9, -1, 0, 0.0), (842, 674, 1.05, 1, 6, 1.3),
        (880, 682, 0.85, 1, 8, 2.1), (705, 684, 0.8, -1, 0, 0.0), (930, 679, 0.9, 1, 6.5, 0.7)]

falcon = kit.Falcon(
    keys=[(1.25, 1740, 540, 120), (1.65, 1360, 488, 110), (2.05, 1010, 440, 98), (2.45, 690, 384, 88),
          (2.85, 470, 300, 80), (3.15, 418, 210, 76), (3.45, 500, 140, 78), (3.75, 640, 106, 86)],
    beats=kit.Beats([(1.25, 2.1, 3.8), (2.1, 2.62, 0), (2.62, 3.3, 3.7), (3.3, 3.6, 0), (3.6, 4.08, 3.6)]),
    settle=SETTLE, blend_at=3.98, light=(420, 380), rim=(0.72, 1.0, 0.84), lit=0.45, rim_amt=0.9,
    palette=dict(dark=(0.07, 0.07, 0.16), dorsal=(0.13, 0.16, 0.3), ventral=(0.11, 0.1, 0.21), chest=(0.2, 0.18, 0.3)))
title = kit.Title(start=TITLE)


def deer_mask(t, M):
    m = np.zeros((H * 2, W * 2), np.float32)
    for dx0, dy0, s, face, speed, ph in DEER:
        x0 = (dx0 + face * speed * t) * k
        y0 = dy0 * k
        sx, sy = kit.apply(M, x0, y0)
        sc = s * k * M[0, 0]
        g = 2 * math.pi * (1.5 * t) + ph if speed else 0.0
        bob = 0.6 * math.sin(2 * g) if speed else 0.0
        graze = 0 if speed else 6 + 1.5 * math.sin(0.8 * t + ph)
        body = [(-9, -9), (8, -10), (11, -14 + graze), (14, -16 + graze), (16, -13 + graze), (13, -9 + graze * 0.5),
                (8, -6), (-6, -6), (-10, -6)]
        pts = np.float32([(sx + face * px * sc, sy + (py + bob) * sc) for px, py in body])
        cv2.fillPoly(m, [np.round(pts * 2 * 16).astype(np.int32)], 1.0, cv2.LINE_AA, shift=4)
        for lx, lp in ((-7, 0), (-5, math.pi), (6, math.pi), (8, 0)):
            sw = 0.35 * math.sin(g + lp) if speed else 0.0
            a = (sx + face * lx * sc, sy + (-6 + bob) * sc)
            b = (a[0] + face * math.sin(sw) * 7 * sc, a[1] + math.cos(sw) * 7 * sc)
            cv2.line(m, (int(a[0] * 8), int(a[1] * 8)), (int(b[0] * 8), int(b[1] * 8)), 1.0, max(1, int(3.2 * sc)), cv2.LINE_AA, shift=2)
        antl = [(12, -16 + graze), (10, -24 + graze), (14, -20 + graze), (16, -27 + graze), (17, -18 + graze)]
        ap = np.float32([(sx + face * px * sc, sy + (py + bob) * sc) for px, py in antl])
        cv2.polylines(m, [np.round(ap * 2 * 16).astype(np.int32)], False, 1.0, max(1, int(2.4 * sc)), cv2.LINE_AA, shift=4)
    return cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA)


def compose(tone, t):
    L = T[tone]
    night = tone == 'night'
    Ms = cam.M(DEPTH['sky'], t, PAN['sky'])
    img = kit.warp(L['sky'], Ms)
    if night:
        STARS.draw(img, Ms, t)
        kit.meteor(img, t, 0.8, (300, 70), (520, 180), dur=0.6)
        img += kit.aurora_light(DIFF, N['hem'], k, Ms, t)
    Mf = cam.M(DEPTH['far'], t, PAN['far'])
    f = kit.warp(np.dstack([L['far'], L['fara']]), Mf)
    kit.over(img, f[..., :3], f[..., 3])
    kit.over(img, np.float32([0.05, 0.07, 0.19]) if night else np.float32([0.29, 0.25, 0.43]), deer_mask(t, Mf))
    Mn = cam.M(DEPTH['near'], t, PAN['near'])
    n = kit.warp(np.dstack([L['near'], L['neara']]), Mn)
    kit.over(img, n[..., :3], n[..., 3])
    # Grass trembles in the wind.
    px, py = kit.inverse_grid(Mn)
    d = np.clip((py / k - 680) / 320, 0, 1)
    sway = (2.5 * np.sin(1.9 * t + 0.012 * px) + 1.2 * np.sin(3.3 * t + 0.04 * px + 1)) * (0.4 + d) * k
    tf = kit.remap(L['tufts'], px - sway, py, border=cv2.BORDER_CONSTANT)
    kit.over(img, L['tuftcol'], tf)
    # Snow streams low over the field.
    o = int(90 * t)
    near_a = n[..., 3]
    stream = np.clip((DRIFT[:, o:o + W] - 0.62) * 3, 0, 1) * near_a * np.clip((YY - 700) / 300, 0, 1)
    kit.over(img, np.float32([0.85, 0.9, 1.0]) if night else np.float32([1, 0.97, 0.95]), stream * 0.22)
    for gx, gy, t0, s in GLINTS:
        e = math.exp(-((t - t0) / 0.14) ** 2)
        if e > 0.02:
            x, y = kit.apply(Mn, gx, gy)
            kit.glint(img, x, y, 6 * s, e, col=(0.9, 1.0, 1.0) if night else (1.0, 0.97, 0.9))
    return img


def frame(t):
    img = compose('night', t)
    if t > DAWN:
        Ms = cam.M(DEPTH['far'], t, PAN['far'])
        sx, sy = kit.apply(Ms, SUN[0], SUN[1])
        dist = np.hypot(XX - sx, YY - sy) / 1500
        dawn = kit.wash(t, DAWN, dist, spread=1.0, length=0.8, grain=kit.GRAIN)
        if dawn.max() > 0:
            day = compose('day', t)
            img = img + (day - img) * dawn[..., None]
    # Ice crystals glitter in the air.
    for x0, y0, sp, j, ph, s in DUST:
        x = (x0 + 6 * t + 8 * math.sin(0.7 * t + ph)) % W
        y = (y0 + sp * t) % H
        e = (0.5 + 0.5 * math.sin(4.5 * t + ph * 3)) ** 6
        kit.glint(img, x, y, 4 * s, e * 0.8)
    falcon.draw(img, t)
    title.draw(img, t)
    return np.clip(img, 0, 1)


def write_audio(path):
    m = snd.Mix(DUR, seed=6)
    snd.wind(m, gain=0.13, hi=(1200, 4000), env=lambda t: snd.smooth(t / 1.0) * (1 - 0.4 * snd.smooth((t - DAWN) / 1.5)))
    snd.shimmer(m, 0.0, DAWN + 1.0, [88, 93, 95, 100], gain=0.01)
    r = np.random.default_rng(3)
    for _ in range(14):
        m.add(snd.celesta(int(r.choice([88, 91, 93, 95, 98, 100])), 0.05, 1.5), r.uniform(0.2, 7.0),
              pan=r.uniform(-0.8, 0.8), send=0.9)
    snd.pad(m, [45, 52, 60, 71], 0.0, 1.6, attack=1.1, release=0.7, bright=0.2, gain=0.5)
    for t0, note, vel, p in [(0.25, 76, 0.4, 0.1), (0.58, 83, 0.36, -0.1), (0.9, 79, 0.38, 0), (1.22, 77, 0.33, 0.1)]:
        m.add(snd.piano(note, vel), t0, pan=p, send=0.45)
    m.add(snd.noise_burst(0.7, 3500, 9000, 0.25, 0.25, seed=3), 0.8, gain=0.04, pan=-0.5, send=0.6)
    snd.pad(m, [53, 60, 64, 69], 1.4, 2.8, attack=0.5, release=0.5, bright=lambda t: 0.3 + 0.4 * snd.smooth((t - 1.4) / 1.0), gain=0.6)
    strokes = falcon.strokes()
    snd.wings(m, strokes, ref_scale=110, gain=0.15)
    for i, (ts, p, sc) in enumerate(strokes[:4]):
        m.add(snd.piano([72, 76, 79, 84][i], 0.36 + 0.04 * i), ts, pan=p * 0.4, send=0.45)
    snd.pad(m, [50, 57, 65, 76, 84], 2.6, 3.5, attack=0.6, release=0.5, bright=0.45, gain=0.55, send=0.45)
    m.add(snd.celesta(88, 0.45), 2.85, pan=-0.4, send=0.7)
    snd.pad(m, [52, 59, 69, 71, 76], 3.4, 4.4, attack=0.7, release=0.3, bright=lambda t: 0.4 + 0.4 * snd.smooth((t - 3.4) / 0.9), gain=0.55)
    m.add(snd.piano(83, 0.34), 3.62, pan=-0.1, send=0.45)
    snd.mark_sting(m, SETTLE, [(57, 0.5), (64, 0.45), (73, 0.42), (76, 0.4), (83, 0.38)], bell=88)
    snd.pad(m, [45, 52, 61, 69, 71, 76], SETTLE - 0.02, 6.4, attack=0.35, release=1.0,
            bright=lambda t: 0.45 + 0.35 * snd.smooth((t - DAWN) / 1.2), gain=0.6)
    snd.ticks(m, TITLE, [88, 90, 93, 95, 97, 100])
    m.add(snd.piano(88, 0.3), 4.95, pan=0.2, send=0.5)
    m.add(snd.piano(85, 0.27), 5.3, pan=-0.1, send=0.5)
    snd.pad(m, [76, 81, 85, 88], DAWN, 7.0, attack=1.0, release=0.8, bright=0.6, gain=0.3, send=0.6)
    m.add(snd.noise_burst(2.2, 1800, 7000, 0.9, 0.7, seed=21), DAWN + 0.1, gain=0.025, pan=0.3, send=0.6)
    m.add(snd.celesta(93, 0.3), DAWN + 0.45, pan=0.25, send=0.8)
    m.add(snd.piano(88, 0.3), DAWN + 0.62, pan=0.1, send=0.6)
    m.write(path)


if __name__ == '__main__':
    kit.main(frame, DUR, NAME, write_audio, sys.argv)
