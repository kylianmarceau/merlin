"""Lighthouse Point opening film.

    python lighthouse_layers.py 1800
    python lighthouse_film.py [--frames 0,48] [--audio]

Blue hour deepening into night. The lantern turns and its beam sweeps over the
sea, flaring when it faces us. The sea rolls and glints, waves break against
the headland and the rocks, the cottage chimney smokes, the windows flicker
and the cloud bars drift. The merlin comes in over the water, swings round
the lantern and climbs into Merlin's mark as the name rises.
"""
import math
import sys

import cv2
import numpy as np

import kit
import sound as snd
from impasto import fbm, noise1d
from kit import H, W, XX, YY, ease, ease_out

NAME = 'lighthouse_film'
DUR = 7.6
SETTLE, TITLE = 4.32, 4.20

L = kit.load('lighthouse_layers')
PH, PW = L['sky'].shape[:2]
k = float(L['k'][0])
HZ = float(L['hz'][0])
LX, LY = L['lantern']
cam = kit.Camera(DUR, PW, focus=(700, 420))
DEPTH = dict(sky=0.02, bars=0.03, sea=0.045, head=0.085, rocks=0.12)
PAN = dict(sky=4, bars=6, sea=10, head=22, rocks=34)

rng = np.random.default_rng(8)
G1 = fbm((H, W + 800), 601, scale=22, octaves=3, aspect=5)
G2 = fbm((H, W + 800), 602, scale=40, octaves=2, aspect=4)
FOAM = fbm((PH, PW + 600), 603, scale=30 * k, octaves=4, aspect=2.2)
RAYS = noise1d(4000, 604, step=9.0)
WIN_GLOW = cv2.GaussianBlur(L['win'], (0, 0), 14 * k) * 3
SKY_MASK = np.ones((PH, PW), np.float32) * (np.arange(PH)[:, None] < 430 * k)
STARS = kit.Stars(SKY_MASK, 160, 9, top=0.45)
SMOKE = [(rng.uniform(0, 3.0), rng.normal(0, 1), rng.uniform(0.6, 1.3)) for _ in range(60)]
# Waves breaking: (time, which shore).
CRASHES = [(0.35, 'rock'), (1.45, 'head'), (2.75, 'rock'), (3.9, 'head'), (5.15, 'rock'), (6.35, 'head')]
SPRAY_AT = {'head': [(700, 820), (725, 900), (650, 700)], 'rock': [(1400, 940), (1500, 885), (1350, 975)]}
SPRAY = [(rng.normal(0, 1), rng.uniform(0.5, 1.4), rng.uniform(0, 0.15), int(rng.integers(3))) for _ in range(160)]

falcon = kit.Falcon(
    keys=[(1.25, 1760, 470, 78), (1.62, 1420, 420, 84), (2.02, 1060, 372, 94), (2.42, 720, 322, 102),
          (2.78, 500, 262, 104), (3.08, 430, 186, 96), (3.40, 500, 122, 88), (3.75, 630, 96, 92)],
    beats=kit.Beats([(1.25, 2.15, 3.8), (2.15, 2.62, 0), (2.62, 3.30, 3.7), (3.30, 3.6, 0), (3.6, 4.08, 3.6)]),
    settle=SETTLE, blend_at=3.98, rim=(1.0, 0.88, 0.66), lit=0.5, rim_amt=0.9,
    palette=dict(dark=(0.09, 0.08, 0.18), dorsal=(0.17, 0.17, 0.33), ventral=(0.15, 0.12, 0.25), chest=(0.26, 0.2, 0.3)))
title = kit.Title(start=TITLE)


def beam(t, lx, ly):
    phi = 0.9 + 2 * math.pi * t / 6.4
    s, c = math.cos(phi), math.sin(phi)
    side = 1 if s >= 0 else -1
    a0 = math.atan2(-0.14, side)
    ang = np.arctan2(YY - ly, XX - lx)
    da = np.angle(np.exp(1j * (ang - a0))).astype(np.float32)
    dist = np.hypot(XX - lx, YY - ly)
    width = 0.045 + 0.32 * (1 - abs(s)) ** 2
    length = 140 + 1500 * abs(s) ** 0.8
    strength = (0.5 + 0.5 * abs(s)) * (1.0 if c > 0 else 0.7)
    cone = np.exp(-(da / width) ** 2) * np.exp(-dist / length) * ease(dist / 30)
    tex = 0.7 + 0.6 * RAYS[np.clip((da * 900 + 2000).astype(np.int32), 0, 3999)]
    toward = math.exp(-(math.atan2(math.sin(phi - math.pi / 2), math.cos(phi - math.pi / 2)) / 0.32) ** 2)
    lamp = np.exp(-(dist / 34) ** 2) * (0.55 + 0.45 * toward) + np.exp(-(dist / (70 + 160 * toward)) ** 2) * (0.12 + 0.55 * toward)
    return cone * tex * strength * 0.5 + lamp, toward


def surf(t, d, which, M):
    a = np.zeros_like(d)
    for t0, w in CRASHES:
        if w != which or t < t0 or t > t0 + 2.2:
            continue
        u = (t - t0) / 2.2
        r = 10 + 85 * ease_out(u / 0.7)
        a += np.exp(-((d - r) / (14 + 26 * u)) ** 2) * (1 - u) ** 1.3 + np.exp(-d / (18 + 50 * u)) * (1 - u) ** 2 * 1.1
    a += np.exp(-d / 16) * 0.55
    return a


def frame(t):
    dusk = ease(t / DUR)
    Ms = cam.M(DEPTH['sky'], t, PAN['sky'])
    img = kit.warp(L['sky'], Ms) * (1 - 0.14 * dusk)
    STARS.draw(img, Ms, t, gain=0.25 + 0.75 * ease((t - 0.5) / 5))
    Mb = cam.M(DEPTH['bars'], t, PAN['bars'], dx=-9 * t * k)
    b = kit.warp_band(np.dstack([L['bars'], L['barsa']]), Mb, int(L['band'][0]))
    kit.over(img, b[..., :3] * (1 - 0.12 * dusk), b[..., 3])

    # The sea rolls: slow displacement, swell bands and moving glints.
    Mw = cam.M(DEPTH['sea'], t, PAN['sea'])
    hz = kit.apply(Mw, 0, HZ)[1]
    px, py = kit.inverse_grid(Mw)
    d = np.clip((YY - hz) / (H - hz), 0, 1)
    dx = (1 + 6 * d) * np.sin(0.016 * px + 0.05 * py - 1.0 * t) + (0.5 + 2 * d) * np.sin(0.04 * px - 0.02 * py + 1.4 * t)
    dy = (0.4 + 2.6 * d) * np.sin(0.07 * py - 1.6 * t + 0.008 * px)
    sea = kit.remap(L['sea'], px + dx, py + dy)
    swell = 1 + 0.05 * (0.3 + d) * np.sin(2600 / (np.maximum(YY - hz, 0) + 40) - 1.3 * t)
    sea = sea * (swell * (1 - 0.1 * dusk))[..., None]
    o1, o2 = int(22 * t), int(37 * t)
    g = np.clip((G1[:, o1:o1 + W] * 0.55 + G2[:, 800 - o2 % 800 - 1: 800 - o2 % 800 - 1 + W] * 0.45 - 0.74) * 6, 0, 1)
    warm = np.exp(-((XX - kit.apply(Mw, 1220 * k, 0)[0]) / (120 + 260 * d)) ** 2) * np.exp(-(YY - hz) / 300)
    sea += (np.float32([1.0, 0.8, 0.6]) - sea) * (g * warm * 0.85)[..., None]
    sea += (np.float32([0.6, 0.62, 0.95]) - sea) * (g * (1 - warm) * 0.18 * d)[..., None]
    water = ease((YY - hz) / 2 + 0.5)
    img += (sea - img) * water[..., None]

    # The turning beam, and its glow on the water.
    Mh = cam.M(DEPTH['head'], t, PAN['head'])
    lx, ly = kit.apply(Mh, LX, LY)
    light, toward = beam(t, lx, ly)
    heada = kit.warp(L['heada'], Mh)
    img += (light * (1 - heada * 0.85))[..., None] * np.float32([1.0, 0.92, 0.72]) * (0.85 + 0.25 * dusk)
    h = kit.warp(L['head'], Mh)
    kit.over(img, h, heada)
    glass = kit.warp(L['glass'], Mh)
    img += (glass * (0.3 + 0.7 * toward))[..., None] * np.float32([0.6, 0.5, 0.3])
    fl = 1 + 0.15 * math.sin(6.1 * t) * math.sin(2.3 * t + 1) + 0.05 * math.sin(19 * t)
    img += (kit.warp(WIN_GLOW, Mh) * 0.22 * fl * (0.8 + 0.4 * dusk))[..., None] * np.float32([1.0, 0.75, 0.4])

    # Chimney smoke drifting off the land.
    buf = np.zeros((H, W), np.float32)
    cx, cy = kit.apply(Mh, 264 * k, 390 * k)
    for ph, j, sz in SMOKE:
        age = (t + ph) % 3.0
        u = age / 3.0
        kit.add_blob(buf, cx - 46 * age + 8 * j * u + 3 * math.sin(2 * age + j), cy - 30 * age + 4 * u * u,
                     2 + 9 * u * sz, 0.10 * (1 - u) ** 1.5 * min(1, age * 6))
    kit.over(img, np.float32([0.62, 0.58, 0.78]), np.clip(buf, 0, 0.5))

    # Surf against the headland and the rocks.
    Mr = cam.M(DEPTH['rocks'], t, PAN['rocks'])
    for which, M, dist in (('head', Mh, L['dhead']), ('rock', Mr, L['drock'])):
        qx, qy = kit.inverse_grid(M)
        dd = kit.remap(dist, qx, qy)
        foam = surf(t, dd, which, M)
        tex = kit.remap(FOAM, qx + 14 * t * k, qy)
        lace = np.clip((tex - (1.0 - np.clip(foam, 0, 1.2) * 0.75)) * 3.5, 0, 1)
        foam = np.clip(lace, 0, 0.92) * water * ease(dd / 3)
        foam = cv2.GaussianBlur(foam, (0, 0), 0.8)
        if which == 'rock':
            r = kit.warp(np.dstack([L['rocks'], L['rocksa']]), Mr)
            kit.over(img, np.float32([0.91, 0.89, 0.97]), foam * 0.9)
            kit.over(img, r[..., :3], r[..., 3])
        else:
            kit.over(img, np.float32([0.91, 0.89, 0.97]), foam * 0.9)
    buf = np.zeros((H, W), np.float32)
    for t0, w in CRASHES:
        u = t - t0
        if not 0 < u < 1.2:
            continue
        M = Mh if w == 'head' else Mr
        for j, (vx, vy, delay, at) in enumerate(SPRAY):
            a = u - delay
            if a <= 0:
                continue
            bx, by = SPRAY_AT[w][at]
            sx, sy = kit.apply(M, bx * k + vx * 55 * a * k, by * k - vy * 220 * a * k + 300 * a * a * k)
            kit.add_blob(buf, sx, sy, 1.4 + 2.5 * a, 0.45 * max(0.0, 1 - a / 0.9) ** 1.5)
    kit.over(img, np.float32([0.93, 0.92, 0.99]), np.clip(buf, 0, 0.8))

    falcon.light = (lx, ly)
    falcon.draw(img, t)
    title.draw(img, t)
    return np.clip(img, 0, 1)


def write_audio(path):
    m = snd.Mix(DUR, seed=5)
    snd.sea(m, [(t0 + 0.05, -0.3 if w == 'head' else 0.7, 0.9 if w == 'rock' else 0.7) for t0, w in CRASHES], gain=0.22)
    snd.wind(m, gain=0.06)
    snd.pad(m, [43, 50, 58, 69], 0.0, 1.6, attack=1.1, release=0.7, bright=0.2, gain=0.5)
    for t0, note, vel, p in [(0.25, 74, 0.4, -0.2), (0.58, 81, 0.36, 0.0), (0.9, 77, 0.38, -0.1), (1.22, 76, 0.33, 0.1)]:
        m.add(snd.piano(note, vel), t0, pan=p, send=0.4)
    for t0 in (1.9, 5.3):
        m.add(snd.celesta(50, 0.5, 3.5), t0, pan=0.75, send=0.85)          # a bell buoy far out
    snd.pad(m, [51, 58, 67, 74], 1.4, 2.8, attack=0.5, release=0.5, bright=lambda t: 0.3 + 0.4 * snd.smooth((t - 1.4) / 1.0), gain=0.6)
    strokes = falcon.strokes()
    snd.wings(m, strokes, ref_scale=95, gain=0.15)
    for i, (ts, p, sc) in enumerate(strokes[:4]):
        m.add(snd.piano([70, 74, 77, 81][i], 0.36 + 0.04 * i), ts, pan=p * 0.4, send=0.45)
    snd.pad(m, [48, 55, 63, 74, 82], 2.6, 3.5, attack=0.6, release=0.5, bright=0.45, gain=0.55, send=0.45)
    m.add(snd.celesta(86, 0.45), 2.8, pan=-0.45, send=0.7)
    snd.pad(m, [50, 57, 67, 69, 72], 3.4, 4.4, attack=0.7, release=0.3, bright=lambda t: 0.4 + 0.4 * snd.smooth((t - 3.4) / 0.9), gain=0.55)
    m.add(snd.piano(81, 0.34), 3.62, pan=-0.1, send=0.45)
    snd.mark_sting(m, SETTLE, [(55, 0.5), (62, 0.45), (71, 0.42), (74, 0.4), (81, 0.38)], bell=86)
    snd.pad(m, [43, 50, 59, 67, 69, 74], SETTLE - 0.02, 6.4, attack=0.35, release=1.0, bright=0.4, gain=0.6)
    snd.ticks(m, TITLE, [86, 88, 91, 93, 95, 98])
    m.add(snd.piano(86, 0.3), 4.95, pan=0.2, send=0.5)
    m.add(snd.piano(83, 0.27), 5.3, pan=-0.1, send=0.5)
    m.add(snd.piano(79, 0.26), 6.2, pan=0.1, send=0.6)
    snd.shimmer(m, 5.4, DUR, [74, 79, 83, 86], gain=0.03)
    m.write(path)


if __name__ == '__main__':
    kit.main(frame, DUR, NAME, write_audio, sys.argv)
