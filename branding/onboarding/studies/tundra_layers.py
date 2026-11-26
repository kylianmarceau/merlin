"""Tundra Lights, painted as layers for the film.

  sky     sky (dawn keeps its ghost of aurora; the night curtain is separate)
  aurora  night only: the sky with the curtain, added by the film as light
  far     the far hills and spruce groves, with alpha
  near    the near snowfield and trees, with alpha
  tufts   the dry grass, as its own layer so it can sway
The reindeer are drawn by the film so they can walk.

    python tundra_layers.py 1800 night|dawn
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
TONE = sys.argv[2] if len(sys.argv) > 2 else 'night'
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)
HZ = 640 * k
N = TONE == 'night'

P = dict(
    night=dict(sky=[(0, '#0c0b3c'), (0.3, '#191a70'), (0.5, '#24358f'), (0.62, '#2f5f9e'), (0.66, '#3c7fa4')],
               veil='#3a1f80', far_dark='#1c2470', far_lit='#6f8fd0', near_dark='#2a3a8a', near_lit='#a9c8ee',
               snow_sh='#3a4fa6', snow_lit='#d2e6f8', tint='#8ff0c8', tint_amt=0.35, tree='#08102a',
               deer='#0d1230', aur=1.0, sun=0.0, glint='#dff6ff'),
    dawn=dict(sky=[(0, '#7d8ad4'), (0.25, '#a9a2e0'), (0.45, '#e2b2cc'), (0.56, '#f7c4ae'), (0.64, '#fde0b4')],
              veil='#b48fd8', far_dark='#6a6ab4', far_lit='#d9b2d0', near_dark='#8f8ccc', near_lit='#fbe1d2',
              snow_sh='#8a90d4', snow_lit='#fff0e2', tint='#ffc9a0', tint_amt=0.3, tree='#3a3a6e',
              deer='#4a3f6e', aur=0.18, sun=1.0, glint='#fff4e0'),
)[TONE]

sky = gradient_v(S, P['sky'])
veil = fbm(S, 5, scale=340 * k, octaves=3, aspect=3.2)
sky = lerp(sky, hex2rgb(P['veil']), smooth(0.62, 0.9, veil) * 0.35)
SUN = (1130 * k, HZ + 10 * k)
sun_d = radial(S, SUN[0], SUN[1], 260 * k, 0.55)
sky = lerp(sky, hex2rgb('#ffe3b0'), np.exp(-sun_d ** 2) * 0.75 * P['sun'])

u = X / W
hem = (560 - 240 * u ** 1.4 + 26 * np.sin(u * 15 + 0.7) + 14 * np.sin(u * 37)) * k
tall = (150 + 90 * u) * k
above = hem[None, :] - y
rays = 0.45 + 0.55 * smooth(0.25, 0.85, fbm(S, 7, scale=30 * k, octaves=3, aspect=0.12))
body = smooth(-3 * k, 6 * k, above) * np.exp(-np.clip(above, 0, None) / tall[None, :])
body *= smooth(3.0, 1.0, above / tall[None, :]) * smooth(0.0, 0.08, u)[None, :] * smooth(1.0, 0.82, u)[None, :]
aur = np.clip(body * rays * 1.3, 0, 1) * P['aur']
hf = np.clip(above / tall[None, :], 0, 1.5)
acol = lerp(hex2rgb('#86f7bc'), hex2rgb('#35c8b8'), smooth(0.0, 0.45, hf))
acol = lerp(acol, hex2rgb('#9361d6'), smooth(0.5, 1.2, hf))
if not N:
    acol = lerp(acol, hex2rgb('#e8f2ff'), 0.5)
with_aur = lerp(sky, acol, aur)
glow = cv2.GaussianBlur(aur, (0, 0), 40 * k)
with_aur = lerp(with_aur, hex2rgb('#2f9a9a' if N else '#f0d8e8'), np.clip(glow * 0.5, 0, 1) * (1 - aur))

far_line = hills(W, k, 600, 55, 520, 31)
far_line -= 70 * k * np.exp(-((X - 380 * k) / (260 * k)) ** 2)
far_line -= 40 * k * np.exp(-((X - 1380 * k) / (300 * k)) ** 2)
far = below(S, far_line)
zf = -(y - far_line[None, :]) * 0.6 + 50 * k * fbm(S, 32, scale=260 * k, octaves=3)
fl, _ = shade_terrain(zf, (0.7, -0.5, 0.6) if not N else (-0.6, -0.6, 0.5), blur=4 * k)
far_col = lerp(hex2rgb(P['far_dark']), hex2rgb(P['far_lit']), fl)
far_col = lerp(far_col, hex2rgb(P['tint']), smooth(0.7, 1, fl) * P['tint_amt'])
far_col = lerp(far_col, sky, smooth(HZ - 120 * k, HZ, y) * 0.35)
disc = np.zeros(S, np.float32)
sky_t = with_aur if not N else sky
if not N:
    sy = float(np.interp(SUN[0], X, far_line)) - 26 * k
    disc = np.clip((1 - radial(S, SUN[0], sy, 46 * k)) * 46 * k * 0.7, 0, 1)
    sky_t = lerp(sky_t, hex2rgb('#fff1c8'), disc)
    sky_t = lerp(sky_t, hex2rgb('#ffd9a0'), np.exp(-(radial(S, SUN[0], sy, 140 * k) ** 2)) * 0.5 * (1 - disc))

ACC_SKY = [hex2rgb(c) for c in (('#3a1f8a', '#1f2f9a', '#2a6f9a') if N else ('#c7a6e6', '#f3c1b8', '#a7b4ec'))]
ACC_AUR = [hex2rgb(c) for c in ('#5ef0b0', '#36d0c4', '#a07ae0')]
ACC_SNOW = [hex2rgb(c) for c in (('#5a78c8', '#8fd8d0', '#3a4fa8') if N else ('#f6cfc6', '#c9b8ee', '#ffe4c8'))]

skym = np.clip((y < HZ + 20 * k) * 1.0, 0, 1).astype(np.float32)


def sky_pass(cv, with_curtain):
    cv.layer(skym * (1 - aur * (1 if N else 0)), math.radians(-14), 190, 34, density=1.2, accents=ACC_SKY, accent_p=0.14,
             clip=skym, thick=0.8, curve=0.3, angle_jitter=0.08, seed=1)
    cv.layer(skym * (1 - aur * (1 if N else 0)), math.radians(-12), 90, 18, density=0.7, accents=ACC_SKY, accent_p=0.1,
             clip=skym, thick=0.8, curve=0.3, angle_jitter=0.1, sample_blur=2, seed=2)
    if with_curtain:
        lean = np.gradient(hem)[None, :] * 0.5
        ray_ang = (math.radians(-90) + np.arctan(lean)).astype(np.float32) * np.ones(S, np.float32)
        aur_clip = cv2.dilate(np.clip(aur * 3, 0, 1), np.ones((int(5 * k) + 1, int(5 * k) + 1), np.uint8))
        cv.layer(np.clip(aur * 1.6, 0, 1), ray_ang, 100, 20, density=1.6, accents=ACC_AUR, accent_p=0.18,
                 clip=aur_clip, thick=0.9, curve=0.15, angle_jitter=0.05, sample_blur=2, pickup=0.25, taper=0.5, seed=3)


out = {}
if N:
    cv = Canvas(sky, seed=51)
    sky_pass(cv, False)
    out['sky'] = cv.finish(relief=0.5)
    cv = Canvas(with_aur, seed=51)
    sky_pass(cv, True)
    a = cv.finish(relief=0.5)
    out['aurora'] = np.clip(a + glow[..., None] * hex2rgb('#3fe0a8') * 0.12, 0, 1)
    out['aura'] = np.clip(cv2.dilate(np.clip(aur * 2.5, 0, 1), np.ones((9, 9), np.uint8)), 0, 1)
    out['hem'] = hem
else:
    cv = Canvas(sky_t, seed=51)
    sky_pass(cv, False)
    cv.inlay(disc, thick=1.2)
    s = cv.finish(relief=0.5)
    out['sky'] = np.clip(s + np.exp(-sun_d ** 2)[..., None] * hex2rgb('#ffdca8') * 0.18, 0, 1)
print('sky', flush=True)

# Far hills and the spruce groves at their foot.
groves = np.zeros(S, np.float32)
rng = np.random.default_rng(41)
for i in range(70):
    cx = rng.uniform(0, 1600)
    if 620 < cx < 1000 and rng.random() < 0.8:
        continue
    base = np.interp(cx * k, X, far_line) / k + rng.uniform(4, 30)
    hgt = rng.uniform(18, 46)
    groves = np.maximum(groves, poly_mask(S, scaled(pine_pts(cx, base, hgt, hgt * 0.28, 900 + i), k)))
near_trees = np.zeros(S, np.float32)
for i, (cx, b, h, w) in enumerate([(150, 860, 210, 46), (230, 830, 140, 32), (95, 900, 300, 64),
                                   (1480, 880, 230, 50), (1395, 840, 140, 32), (1560, 930, 330, 70)]):
    near_trees = np.maximum(near_trees, poly_mask(S, scaled(pine_pts(cx, b, h, w, 960 + i), k)))


def tree_col(trees):
    cap = np.clip(trees - np.roll(trees, int(3 * k) + 1, axis=0), 0, 1)
    c = lerp(hex2rgb(P['tree']), hex2rgb(P['near_dark']), smooth(0.5, 0.9, fbm(S, 42, scale=30 * k, octaves=2)) * 0.5)
    return lerp(c, hex2rgb(P['snow_lit']), cap * 0.85)


near_line = hills(W, k, 690, 30, 700, 33)
near = below(S, near_line)
groves *= (1 - near)
base_img = out['sky'] if N else out['sky']
tgt = lerp(lerp(base_img, far_col, far), tree_col(groves), groves)
cv = Canvas(tgt, seed=52)
f_ang = slope_angle(zf, 6 * k) * 0.3
cv.layer(far, f_ang, 110, 24, density=1.4, accents=ACC_SNOW, accent_p=0.1, thick=1.0, curve=0.3, angle_jitter=0.1)
cv.inlay(groves, thick=1.0)
cv.layer(groves, math.radians(-160), 18, 5, density=1.2, thick=1.2, angle_jitter=0.35, sample_blur=1, ragged=0.6)
far_img = cv.finish(relief=0.5)
print('far', flush=True)

zn = -(y - near_line[None, :]) * 0.25 + 40 * k * fbm(S, 34, scale=180 * k, octaves=4, aspect=2.5)
nl, _ = shade_terrain(zn, (0.6, -0.6, 0.6) if not N else (-0.5, -0.7, 0.6), blur=4 * k)
depth = np.clip((y - 680 * k) / (H - 680 * k), 0, 1)
snow = lerp(hex2rgb(P['snow_sh']), hex2rgb(P['snow_lit']), smooth(0.2, 0.9, nl))
snow = lerp(snow, hex2rgb(P['tint']), smooth(0.65, 1.0, nl) * P['tint_amt'] * (1 - depth * 0.5))
drift = smooth(0.55, 0.8, fbm(S, 35, scale=70 * k, octaves=3, aspect=5))
snow = lerp(snow, hex2rgb(P['snow_sh']), drift * 0.3)
snow = lerp(snow, hex2rgb(P['tint']), np.clip(glow[::-1] * 0.6, 0, 1) * near * P['tint_amt'])
if not N:
    sunpath = np.exp(-((x - SUN[0]) / (80 * k + 200 * k * depth)) ** 2) * (1 - depth * 0.6)
    snow = lerp(snow, hex2rgb('#ffe0b8'), sunpath * 0.45)
tgt = lerp(lerp(far_img, snow, near), tree_col(near_trees), near_trees)
cv = Canvas(lerp(far_img, snow, near), seed=53)
cv.layer(near, 0.03, 150, 30, density=1.3, accents=ACC_SNOW, accent_p=0.1, thick=1.0, curve=0.4, angle_jitter=0.06)
cv.layer(near * (0.3 + depth), 0.03, 80, 16, density=0.9, accents=ACC_SNOW, accent_p=0.08, thick=1.1, curve=0.4,
         angle_jitter=0.06, sample_blur=2)
cv.target = tgt
cv.inlay(near_trees, thick=1.0)
cv.layer(near_trees, math.radians(-160), 18, 5, density=1.2, thick=1.2, angle_jitter=0.35, sample_blur=1, ragged=0.6)
near_img = cv.finish(relief=0.5)
print('near', flush=True)

tufts = np.zeros(S, np.float32)
rng = np.random.default_rng(43)
for i in range(420):
    tx = rng.uniform(0, W)
    ty = 700 * k + (H - 700 * k) * rng.random() ** 0.8
    if near[int(min(ty, H - 1)), int(tx)] < 0.9:
        continue
    d = (ty - 680 * k) / (H - 680 * k)
    Ln = (4 + 40 * d ** 1.5) * k * rng.uniform(0.6, 1.3)
    for j in range(int(rng.integers(2, 5))):
        a = math.radians(-90 + rng.normal(0, 9) + 6)
        x2, y2 = tx + math.cos(a) * Ln, ty + math.sin(a) * Ln
        cv2.line(tufts, (int(tx * 4), int(ty * 4)), (int(x2 * 4), int(y2 * 4)), 1.0,
                 max(1, int(round((0.4 + 1.4 * d) * k))), cv2.LINE_AA, shift=2)
tuft_col = hex2rgb('#3a4a7a') if N else hex2rgb('#b7926e')

out.update(far=far_img, fara=np.clip(far + groves, 0, 1), near=near_img, neara=np.clip(near + near_trees, 0, 1),
           tufts=np.clip(tufts, 0, 1) * 0.6, tuftcol=tuft_col, nearline=near_line, farline=far_line,
           sun=np.float32([SUN[0], float(np.interp(SUN[0], X, far_line)) - 26 * k]), hz=np.float32([HZ]), k=np.float32([k]))
np.savez_compressed(f'out/tundra_{TONE}_layers.npz', **{kk: (np.float16(v) if isinstance(v, np.ndarray) and v.ndim >= 2 else v) for kk, v in out.items()})
print('done')
