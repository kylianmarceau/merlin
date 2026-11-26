"""Heather Moor opening film.

    python moor_layers.py 1800 dawn && python moor_layers.py 1800 morning
    python moor_film.py [--frames 0,48] [--audio]

Dawn on the moor: mist drifts between the ridges, clouds slide by, gusts of
wind run through the heather in waves of light, the hawthorn bends, and motes
float in the low sun. The merlin comes in from the right, crosses the sun and
climbs into Merlin's mark as the name rises; then morning spreads out from the
sun and the larks start up.
"""
import math
import sys

import cv2
import numpy as np

import kit
import sound as snd
from impasto import fbm
from kit import H, W, XX, YY, ease

NAME = 'moor_film'
DUR = 7.6
SETTLE, TITLE, DAWN = 4.32, 4.20, 5.55

T = {'dawn': kit.load('moor_dawn_layers'), 'morning': kit.load('moor_morning_layers')}
D0 = T['dawn']
PH, PW = D0['sky'].shape[:2]
k = float(D0['k'][0])
cam = kit.Camera(DUR, PW, focus=(800, 560))
RD = [0.025, 0.032, 0.042, 0.055]
RP = [5, 7, 10, 14]
MIST_COL = {'dawn': np.float32([0.98, 0.84, 0.77]), 'morning': np.float32([0.95, 0.96, 0.97])}
MIST_AMT = {'dawn': 0.8, 'morning': 0.22}

rng = np.random.default_rng(21)
MIST = fbm((PH, PW + 800), 801, scale=160 * k, octaves=3, aspect=4)
GUST = fbm((H, W + 1400), 802, scale=110, octaves=3, aspect=1.6)
MOTES = [(rng.uniform(0, W), rng.uniform(250, H), rng.uniform(0.6, 1.6), rng.uniform(0, 6.3), rng.normal(0, 1))
         for _ in range(55)]

falcon = kit.Falcon(
    keys=[(1.25, 1760, 640, 140), (1.65, 1400, 590, 124), (2.05, 1110, 528, 108), (2.45, 830, 462, 96),
          (2.85, 580, 360, 86), (3.15, 486, 252, 80), (3.45, 530, 160, 80), (3.75, 650, 110, 86)],
    beats=kit.Beats([(1.25, 2.15, 3.8), (2.15, 2.62, 0), (2.62, 3.3, 3.7), (3.3, 3.6, 0), (3.6, 4.08, 3.6)]),
    settle=SETTLE, blend_at=3.98, light=(1010 * 0.889, 540 * 0.889), rim=(1.0, 0.86, 0.66), lit=0.45, rim_amt=0.95,
    palette=dict(dark=(0.14, 0.1, 0.22), dorsal=(0.24, 0.2, 0.36), ventral=(0.22, 0.16, 0.3), chest=(0.36, 0.26, 0.34)))
title = kit.Title(start=TITLE, shadow=0.35)


def compose(tone, t):
    L = T[tone]
    Ms = cam.M(0.02, t, 4)
    img = kit.warp(L['sky'], Ms)
    Mc = cam.M(0.024, t, 5, dx=-12 * t * k)
    c = kit.warp_band(np.dstack([L['clouds'], L['cloudsa']]), Mc, int(L['cband'][0]))
    # Keep the clouds thin where the name will sit.
    calm = 1 - 0.55 * np.exp(-(((XX - 800) / 420) ** 2 + ((YY - 200) / 110) ** 2))
    kit.over(img, c[..., :3], c[..., 3] * calm)
    lines = L['lines']
    for i in range(4):
        M = cam.M(RD[i], t, RP[i])
        if i >= 1:
            # Mist pools above the next ridge and drifts along it.
            px, py = kit.inverse_grid(M)
            ln = np.interp(np.clip(px, 0, PW - 1), np.arange(PW), lines[i])
            a = kit.ease((ln - 4 * k - py) / (20 * k)) * kit.ease((py - (ln - 120 * k)) / (60 * k))
            tex = kit.remap(MIST, px + (14 + 8 * i) * t * k, py)
            a = a * (0.45 + 0.55 * tex) * MIST_AMT[tone] * (1 - 0.2 * i)
            kit.over(img, MIST_COL[tone], np.clip(a, 0, 1))
        r = kit.warp(np.dstack([L[f'ridge{i}'], L[f'ridgea{i}']]), M)
        kit.over(img, r[..., :3], r[..., 3])
        if i == 3:
            # The hawthorn bends in the wind, pivoting at its base.
            tx, ty = L['treebase']
            qx, qy = kit.inverse_grid(M)
            h = np.clip((ty - qy) / (90 * k), 0, 1.4)
            bend = (3.2 * math.sin(1.25 * t) + 1.2 * math.sin(3.4 * t + 1) + 2.0) * k * h ** 1.5
            tr = kit.remap(np.dstack([L['tree'], L['treea']]), qx - bend, qy, border=cv2.BORDER_CONSTANT)
            kit.over(img, tr[..., :3], tr[..., 3])
    # Heather: gusts run through it as waves of movement and sheen.
    Mf = cam.M(0.1, t, 30)
    px, py = kit.inverse_grid(Mf)
    o = int(120 * t)
    gust = GUST[:, (1400 - o % 1400) - 1:(1400 - o % 1400) - 1 + W]
    wall = kit.warp(L['wall'], Mf)
    d = np.clip((py / k - 780) / 220, 0, 1)
    dx = (1.2 + 3.2 * d) * k * (np.sin(0.01 * px - 2.2 * t) * 0.6 + (gust - 0.5) * 1.6) * (1 - wall)
    fg = kit.remap(np.dstack([L['fg'], L['fga']]), px - dx, py, border=cv2.BORDER_CONSTANT)
    sheen = np.clip((gust - 0.55) * 2.5, 0, 1) * (1 - wall)
    fgc = fg[..., :3] * (1 + 0.16 * sheen)[..., None]
    kit.over(img, fgc, fg[..., 3])
    # Motes float in the low light.
    for x0, y0, s, ph, j in MOTES:
        x = (x0 + 26 * t + 10 * math.sin(0.9 * t + ph)) % W
        y = y0 - 6 * t + 6 * math.sin(1.3 * t + ph * 2)
        e = (0.5 + 0.5 * math.sin(3 * t + ph)) ** 2 * 0.5
        kit.add_blob(img[..., 0], x, y, 1.3 * s, e * 0.5)
        kit.add_blob(img[..., 1], x, y, 1.3 * s, e * 0.45)
        kit.add_blob(img[..., 2], x, y, 1.3 * s, e * (0.35 if tone == 'dawn' else 0.45))
    return img


def frame(t):
    img = compose('dawn', t)
    if t > DAWN:
        Ms = cam.M(0.02, t, 4)
        sx, sy = kit.apply(Ms, *D0['sun'][:2])
        dawn = kit.wash(t, DAWN, np.hypot(XX - sx, YY - sy) / 1400, spread=1.0, length=0.8, grain=kit.GRAIN)
        if dawn.max() > 0:
            img = img + (compose('morning', t) - img) * dawn[..., None]
    falcon.draw(img, t)
    title.draw(img, t)
    return np.clip(img, 0, 1)


def write_audio(path):
    m = snd.Mix(DUR, seed=7)
    snd.wind(m, gain=0.1, lo=(150, 600), hi=(1500, 5000))
    # A curlew far off in the dawn, and larks once the morning comes.
    r = np.random.default_rng(4)
    for t0, pan in ((0.5, 0.6), (2.6, -0.5)):
        n = int(1.1 * R)
        tt = np.arange(n) / R
        f = 1700 + 900 * snd.smooth(tt / 0.8) + 60 * np.sin(2 * np.pi * 9 * tt)
        s = np.sin(2 * np.pi * np.cumsum(f) / R) * np.sin(np.pi * tt / tt[-1]) ** 1.5
        m.add(s, t0, gain=0.018, pan=pan, send=0.7)
    snd.birdsong(m, DAWN + 0.2, DUR, gain=0.03, pan=0.5, seed=12)
    snd.birdsong(m, DAWN + 0.8, DUR, gain=0.022, pan=-0.4, seed=13)
    snd.pad(m, [41, 48, 57, 64], 0.0, 1.6, attack=1.1, release=0.7, bright=0.25, gain=0.5)
    for t0, note, vel, p in [(0.25, 72, 0.4, -0.1), (0.58, 79, 0.36, 0.1), (0.9, 76, 0.38, 0), (1.22, 74, 0.33, -0.1)]:
        m.add(snd.piano(note, vel), t0, pan=p, send=0.4)
    snd.pad(m, [50, 57, 65, 72], 1.4, 2.8, attack=0.5, release=0.5, bright=lambda t: 0.3 + 0.4 * snd.smooth((t - 1.4) / 1.0), gain=0.6)
    strokes = falcon.strokes()
    snd.wings(m, strokes, ref_scale=120, gain=0.15)
    for i, (ts, p, sc) in enumerate(strokes[:4]):
        m.add(snd.piano([69, 72, 76, 79][i], 0.36 + 0.04 * i), ts, pan=p * 0.4, send=0.45)
    snd.pad(m, [46, 53, 62, 69, 77], 2.6, 3.5, attack=0.6, release=0.5, bright=0.45, gain=0.55, send=0.45)
    m.add(snd.celesta(84, 0.45), 2.35, pan=0.2, send=0.7)
    snd.pad(m, [48, 55, 65, 67, 72], 3.4, 4.4, attack=0.7, release=0.3, bright=lambda t: 0.4 + 0.4 * snd.smooth((t - 3.4) / 0.9), gain=0.55)
    m.add(snd.piano(77, 0.34), 3.62, pan=-0.1, send=0.45)
    snd.mark_sting(m, SETTLE, [(53, 0.5), (60, 0.45), (69, 0.42), (72, 0.4), (79, 0.38)], bell=84)
    snd.pad(m, [41, 48, 57, 65, 67, 72], SETTLE - 0.02, 6.4, attack=0.35, release=1.0,
            bright=lambda t: 0.45 + 0.35 * snd.smooth((t - DAWN) / 1.2), gain=0.6)
    snd.ticks(m, TITLE, [84, 86, 89, 91, 93, 96])
    m.add(snd.piano(84, 0.3), 4.95, pan=0.2, send=0.5)
    m.add(snd.piano(81, 0.27), 5.3, pan=-0.1, send=0.5)
    snd.pad(m, [72, 77, 81, 84], DAWN, 7.0, attack=1.0, release=0.8, bright=0.6, gain=0.3, send=0.6)
    m.add(snd.noise_burst(2.2, 1800, 7000, 0.9, 0.7, seed=21), DAWN + 0.1, gain=0.025, pan=0.3, send=0.6)
    m.add(snd.piano(84, 0.3), DAWN + 0.62, pan=0.1, send=0.6)
    m.write(path)


R = snd.R

if __name__ == '__main__':
    kit.main(frame, DUR, NAME, write_audio, sys.argv)
