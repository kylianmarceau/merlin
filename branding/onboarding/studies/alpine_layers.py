"""Alpine Meadow, painted as layers for the film.

  sky      sky (and moon at night)
  peaks    the great peak and the lower range, with alpha
  forest   the larch band, with alpha
  meadow   the meadow and the hut, with alpha
  flowers  the wildflower dabs, colour and alpha, so they can sway

    python alpine_layers.py 1800 golden|night
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
TONE = sys.argv[2] if len(sys.argv) > 2 else 'golden'
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)
G = TONE == 'golden'

P = dict(
    golden=dict(sky=[(0, '#6f9ad8'), (0.25, '#9bbbe6'), (0.45, '#e6d6d6'), (0.6, '#fbd9a8')],
                rock_sh='#5a4f98', rock_lit='#ee9a86', snow_sh='#9a9ee0', snow_lit='#ffd9bf',
                far='#8f9ad0', forest='#2f4a3e', forest_lit='#8a8a4a', meadow_sh='#5f7a3a', meadow_lit='#d8c86a',
                flowers=('#ffe27a', '#ffffff', '#b58ae8', '#ff8fa8', '#ffb35a'), flower_amt=1.0,
                hut='#7a4a32', roof='#4a3a3a', window='#5a4a5a', cloud='#ffe8d8'),
    night=dict(sky=[(0, '#0c0d3e'), (0.3, '#18216e'), (0.5, '#243a8e'), (0.6, '#33549c')],
               rock_sh='#1c1f5e', rock_lit='#5a6ab8', snow_sh='#5a6cb8', snow_lit='#dce8fa',
               far='#26317a', forest='#0b142e', forest_lit='#1f3450', meadow_sh='#15244a', meadow_lit='#3f5a78',
               flowers=('#c8c89a', '#dfe6f4', '#8a7ac8', '#b08ab8', '#c0a07a'), flower_amt=0.55,
               hut='#2e2236', roof='#1a1428', window='#ffc35a', cloud='#3a4a9a'),
)[TONE]
ACC_SKY = [hex2rgb(c) for c in (('#a8c4ee', '#f6d0c0', '#c8b8ee') if G else ('#2a2f9a', '#3a1f80', '#1f4a9a'))]
ACC_PK = [hex2rgb(c) for c in (('#f6b8a0', '#9a8ee0', '#ffd8c0') if G else ('#3a4aa8', '#6a7ad0', '#28307a'))]
ACC_MD = [hex2rgb(c) for c in (('#a8b84a', '#e8d070', '#6f8a3a') if G else ('#22385a', '#2f4a6a', '#1a2a4a'))]

sky = gradient_v(S, P['sky'])
veil = fbm(S, 91, scale=320 * k, octaves=3, aspect=3.5)
sky = lerp(sky, hex2rgb(P['cloud']), smooth(0.62, 0.85, veil) * smooth(380 * k, 120 * k, y) * (0.5 if G else 0.0))
moon = np.zeros(S, np.float32)
MOON = (330 * k, 170 * k, 30 * k)
if not G:
    mr = radial(S, *MOON)
    sky = lerp(sky, hex2rgb('#7c86d8'), np.exp(-(mr - 1).clip(0) / 2.5) * 0.4)
    moon = np.clip((1 - mr) * MOON[2] * 0.7, 0, 1)
sky_bare = sky
if not G:
    sky = lerp(sky, hex2rgb('#fff2d4'), moon)
skym = (y < 760 * k).astype(np.float32)
# Sky strokes see the sky without the moon, so none of them drags its paint.
cv = Canvas(sky_bare, seed=111)
cv.layer(skym, math.radians(-10), 200, 36, density=1.2, accents=ACC_SKY, accent_p=0.12, clip=skym,
         thick=0.8, curve=0.3, angle_jitter=0.08)
if not G:
    cv.target = sky
    cv.inlay(moon, thick=1.2)
sky_img = cv.finish(relief=0.5)
if G:
    sun_glow = np.exp(-radial(S, 1500 * k, 520 * k, 500 * k, 0.6) ** 2)
    sky_img = np.clip(sky_img + sun_glow[..., None] * hex2rgb('#ffcf90') * 0.18, 0, 1)
print('sky', flush=True)

X1 = X / k
tri = lambda c, w, p=1.15: np.clip(1 - np.abs(X1 - c) / w, 0, 1) ** p
peak = 820 - np.maximum.reduce([640 * tri(1060, 470, 1.6), 430 * tri(1310, 330, 1.4), 300 * tri(850, 260, 1.3), 250 * tri(1500, 260)])
rough = (noise1d(W, 92, step=14 * k) - 0.5) * 40 + (noise1d(W, 93, step=5 * k) - 0.5) * 12
pk_line = np.clip(peak + rough * 0.6 * np.clip((820 - peak) / 400, 0.1, 1), 150, 900) * k
pk = below(S, pk_line)
fold = np.sin((X1[None, :] - 1060) / 38 + 3 * fbm(S, 95, scale=120 * k, octaves=2)) * 26 * k
zp = -(y - pk_line[None, :]) * 1.0 - np.abs(X1[None, :] - 1060) * k * 0.9 + fold + 60 * k * fbm(S, 94, scale=120 * k, octaves=3)
pl, _ = shade_terrain(zp, (0.85, -0.35, 0.4), blur=3 * k)
pl = 0.6 * pl + 0.4 * np.round(pl * 5) / 5
snowy = smooth(0.25, 0.42, pl) * smooth(660 * k, 460 * k, y) + smooth(0.5, 0.6, pl) * 0.6
rock = lerp(hex2rgb(P['rock_sh']), hex2rgb(P['rock_lit']), pl * 0.8)
snow = lerp(hex2rgb(P['snow_sh']), hex2rgb(P['snow_lit']), smooth(0.4, 0.95, pl))
pcol = lerp(rock, snow, np.clip(snowy, 0, 1))
pcol = lerp(pcol, hex2rgb(P['far']), smooth(420 * k, 620 * k, y) * 0.5)
left_line = hills(W, k, 560, 90, 420, 95) - 60 * k * np.exp(-((X1 - 200) / 260) ** 2)
lm = below(S, left_line) * (1 - pk)
zl = -(y - left_line[None, :]) * 0.6 + 60 * k * fbm(S, 96, scale=200 * k, octaves=3)
ll, _ = shade_terrain(zl, (0.8, -0.4, 0.5), blur=3 * k)
lcol = lerp(hex2rgb(P['far']) * 0.8, lerp(hex2rgb(P['far']), hex2rgb(P['snow_lit']), 0.4), ll)
tgt = lerp(lerp(sky_img, pcol, pk), lcol, lm)
cv = Canvas(tgt, seed=112)
p_ang = slope_angle(zp, 5 * k)
cv.layer(pk, p_ang, 70, 20, density=1.5, accents=ACC_PK, accent_p=0.12, thick=1.3, ragged=0.5, curve=0.15)
cv.layer(pk, p_ang, 36, 10, density=1.0, accents=ACC_PK, accent_p=0.1, thick=1.4, ragged=0.5, sample_blur=2)
cv.layer(lm, slope_angle(zl, 5 * k), 70, 20, density=1.3, thick=1.1, ragged=0.5, curve=0.2)
peaks_img = cv.finish(relief=0.5)
print('peaks', flush=True)

forest_line = hills(W, k, 640, 24, 260, 97)
forest_m = below(S, forest_line)
trees = np.zeros(S, np.float32)
rng = np.random.default_rng(98)
for i in range(160):
    cx = rng.uniform(-20, 1620)
    base = np.interp(cx * k, X, forest_line) / k + rng.uniform(10, 40)
    hgt = rng.uniform(26, 60)
    trees = np.maximum(trees, poly_mask(S, scaled(pine_pts(cx, base, hgt, hgt * 0.3, 1000 + i), k)))
forest = np.clip(forest_m + trees, 0, 1)
flit = smooth(0.4, 0.8, fbm(S, 99, scale=24 * k, octaves=2))
fcol = lerp(hex2rgb(P['forest']), hex2rgb(P['forest_lit']), flit * 0.6)
base = lerp(peaks_img, peaks_img, 0)
cv = Canvas(lerp(base, fcol, forest), seed=113)
cv.layer(forest_m, math.radians(-80), 22, 8, density=1.6, thick=1.2, angle_jitter=0.3, sample_blur=1)
cv.inlay(trees * (1 - forest_m), thick=1.0)
forest_img = cv.finish(relief=0.5)
print('forest', flush=True)

m_line = hills(W, k, 730, 60, 800, 100) + 60 * k * (X1 / 1600 - 0.5)
meadow = below(S, m_line)
zm = 70 * k * fbm(S, 101, scale=200 * k, octaves=4, aspect=1.6) - (y - m_line[None, :]) * 0.15
ml, _ = shade_terrain(zm, (0.8, -0.4, 0.5), blur=4 * k)
depth = np.clip((y - 700 * k) / (H - 700 * k), 0, 1)
mcol = lerp(hex2rgb(P['meadow_sh']), hex2rgb(P['meadow_lit']), smooth(0.2, 0.9, ml))
mcol = lerp(mcol, hex2rgb(P['forest']), smooth(0.6, 0.85, fbm(S, 102, scale=90 * k, octaves=3)) * 0.25)
HX, HY = 330 * k, float(np.interp(330 * k, X, m_line)) + 18 * k
Rh = lambda pts: [(HX + px * k, HY + py * k) for px, py in pts]
hut = poly_mask(S, Rh([(-38, 0), (38, 0), (38, -40), (-38, -40)]))
roof = poly_mask(S, Rh([(-50, -36), (50, -36), (0, -74)]))
win = poly_mask(S, Rh([(-12, -24), (2, -24), (2, -10), (-12, -10)]))
hcol = lerp(hex2rgb(P['hut']), hex2rgb(P['hut']) * 0.6, smooth(HX - 10 * k, HX + 38 * k, x))
hcol = lerp(hcol, hex2rgb(P['roof']), roof)
roof_snow = poly_mask(S, Rh([(-50, -36), (-30, -36), (0, -66), (0, -74)]))
hcol = lerp(hcol, hex2rgb(P['snow_lit']) * (1 if G else 0.7), roof_snow * 0.6)
hcol = lerp(hcol, hex2rgb(P['window']), win)
hut_m = np.clip(hut + roof, 0, 1)
base = lerp(forest_img, mcol, meadow)
cv = Canvas(base, seed=114)
cv.layer(meadow, math.radians(-4), 120, 24, density=1.3, accents=ACC_MD, accent_p=0.12, thick=1.0, curve=0.4, angle_jitter=0.08)
cv.layer(meadow * (0.2 + depth), math.radians(-82), 34, 7, density=1.4, accents=ACC_MD, accent_p=0.2,
         thick=1.3, angle_jitter=0.3, curve=0.5, sample_blur=1.5, taper=0.6)
cv.target = lerp(base, hcol, hut_m)
cv.inlay(hut_m, thick=1.2)
cv.layer(hut, 0.0, 14, 5, density=1.2, thick=1.2, sample_blur=0.8)
cv.inlay(win, thick=1.4)
meadow_img = cv.finish(relief=0.5)
print('meadow', flush=True)

flowers = np.zeros(S, np.float32)
fl_col = np.zeros(S + (3,), np.float32)
rng = np.random.default_rng(103)
cols = [hex2rgb(c) for c in P['flowers']]
for i in range(3200):
    fx = rng.uniform(0, W)
    fy = 720 * k + (H - 720 * k) * rng.random() ** 0.85
    if meadow[int(min(fy, H - 1)), int(fx)] < 0.9:
        continue
    d = (fy - 720 * k) / (H - 720 * k)
    if rng.random() > 0.35 + 0.4 * d:
        continue
    r = (1.0 + 5.5 * d ** 1.8) * k * rng.uniform(0.6, 1.3)
    c = cols[int(rng.choice(len(cols), p=[0.3, 0.25, 0.2, 0.15, 0.1]))]
    ang = rng.uniform(-30, 30)
    cv2.ellipse(flowers, (int(fx * 4), int(fy * 4)), (max(1, int(r * 4)), max(1, int(r * 2.6))), ang, 0, 360, 1.0, -1, cv2.LINE_AA, shift=2)
    cv2.ellipse(fl_col, (int(fx * 4), int(fy * 4)), (max(1, int(r * 4)), max(1, int(r * 2.6))), ang, 0, 360,
                tuple(float(v) for v in c), -1, cv2.LINE_AA, shift=2)
flowers = np.clip(flowers, 0, 1) * P['flower_amt']
fl_col = fl_col * (1.0 if G else 0.9)

np.savez_compressed(f'out/alpine_{TONE}_layers.npz', sky=np.float16(sky_img), peaks=np.float16(peaks_img),
                    peaksa=np.float16(np.clip(pk + lm, 0, 1)), forest=np.float16(forest_img), foresta=np.float16(forest),
                    meadow=np.float16(meadow_img), meadowa=np.float16(meadow), flowers=np.float16(fl_col),
                    flowersa=np.float16(flowers), win=np.float16(win), moon=np.float32(MOON),
                    hut=np.float32([HX, HY]), pkline=np.float32(pk_line), k=np.float32([k]))
print('done')
