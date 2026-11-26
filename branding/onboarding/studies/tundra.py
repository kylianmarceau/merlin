"""Scene E: Tundra Lights.

Open snow country, as quiet as a meadow: two soft hills, scattered spruce,
a few reindeer far off. At night an aurora curtain hangs low over the hills;
at dawn the same field turns pink and peach and the aurora fades to a ghost.

    python tundra.py 1600 night|dawn
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 800
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

# ---------------------------------------------------------------- sky
sky = gradient_v(S, P['sky'])
veil = fbm(S, 5, scale=340 * k, octaves=3, aspect=3.2)
sky = lerp(sky, hex2rgb(P['veil']), smooth(0.62, 0.9, veil) * 0.35)
SUN = (1130 * k, HZ + 10 * k)
sun_d = radial(S, SUN[0], SUN[1], 260 * k, 0.55)
sky = lerp(sky, hex2rgb('#ffe3b0'), np.exp(-sun_d ** 2) * 0.75 * P['sun'])

# A low curtain that rises from the left horizon and leans away to the right,
# leaving the upper middle of the sky open for the title.
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
target = lerp(sky, acol, aur)
glow = cv2.GaussianBlur(aur, (0, 0), 40 * k)
target = lerp(target, hex2rgb('#2f9a9a' if N else '#f0d8e8'), np.clip(glow * 0.5, 0, 1) * (1 - aur))

# ---------------------------------------------------------------- land
far_line = hills(W, k, 600, 55, 520, 31)
far_line -= 70 * k * np.exp(-((X - 380 * k) / (260 * k)) ** 2)   # the left hill
far_line -= 40 * k * np.exp(-((X - 1380 * k) / (300 * k)) ** 2)  # and a lower one right
far = below(S, far_line)
zf = -(y - far_line[None, :]) * 0.6 + 50 * k * fbm(S, 32, scale=260 * k, octaves=3)
fl, _ = shade_terrain(zf, (0.7, -0.5, 0.6) if not N else (-0.6, -0.6, 0.5), blur=4 * k)
far_col = lerp(hex2rgb(P['far_dark']), hex2rgb(P['far_lit']), fl)
far_col = lerp(far_col, hex2rgb(P['tint']), smooth(0.7, 1, fl) * P['tint_amt'])
haze = smooth(HZ - 120 * k, HZ, y)
far_col = lerp(far_col, sky, haze * 0.35)
target = lerp(target, far_col, far)
if not N:
    sy = float(np.interp(SUN[0], X, far_line)) - 26 * k
    disc = np.clip((1 - radial(S, SUN[0], sy, 46 * k)) * 46 * k * 0.7, 0, 1) * (1 - far)
    target = lerp(target, hex2rgb('#fff1c8'), disc)
    target = lerp(target, hex2rgb('#ffd9a0'), np.exp(-(radial(S, SUN[0], sy, 140 * k) ** 2)) * 0.5 * (1 - disc) * (1 - far))
else:
    disc = np.zeros(S, np.float32)

near_line = hills(W, k, 690, 30, 700, 33)
near = below(S, near_line)
zn = -(y - near_line[None, :]) * 0.25 + 40 * k * fbm(S, 34, scale=180 * k, octaves=4, aspect=2.5)
nl, _ = shade_terrain(zn, (0.6, -0.6, 0.6) if not N else (-0.5, -0.7, 0.6), blur=4 * k)
depth = np.clip((y - 680 * k) / (H - 680 * k), 0, 1)
snow = lerp(hex2rgb(P['snow_sh']), hex2rgb(P['snow_lit']), smooth(0.2, 0.9, nl))
snow = lerp(snow, hex2rgb(P['tint']), smooth(0.65, 1.0, nl) * P['tint_amt'] * (1 - depth * 0.5))
# Long shadows in the hollows of drifts.
drift = smooth(0.55, 0.8, fbm(S, 35, scale=70 * k, octaves=3, aspect=5))
snow = lerp(snow, hex2rgb(P['snow_sh']), drift * 0.3)
# The aurora (or the low sun) lies as a soft reflection on the snow.
refl = cv2.GaussianBlur(np.ascontiguousarray(aur[::-1]), (0, 0), 25 * k)
snow = lerp(snow, hex2rgb(P['tint']), np.clip(refl[:H] * 0.0 + glow[::-1] * 0.6, 0, 1) * near * P['tint_amt'])
if not N:
    sunpath = np.exp(-((x - SUN[0]) / (80 * k + 200 * k * depth)) ** 2) * (1 - depth * 0.6)
    snow = lerp(snow, hex2rgb('#ffe0b8'), sunpath * 0.45)
target = lerp(target, snow, near)

# Spruce groves: a dark band at the foot of the far hills, and a few near trees.
trees = np.zeros(S, np.float32)
rng = np.random.default_rng(41)
for i in range(70):
    cx = rng.uniform(0, 1600)
    if 620 < cx < 1000 and rng.random() < 0.8:
        continue                                        # keep the centre open
    base = np.interp(cx * k, X, far_line) / k + rng.uniform(4, 30)
    hgt = rng.uniform(18, 46)
    trees = np.maximum(trees, poly_mask(S, scaled(pine_pts(cx, base, hgt, hgt * 0.28, 900 + i), k)))
for i, (cx, b, h, w) in enumerate([(150, 860, 210, 46), (230, 830, 140, 32), (95, 900, 300, 64),
                                   (1480, 880, 230, 50), (1395, 840, 140, 32), (1560, 930, 330, 70)]):
    trees = np.maximum(trees, poly_mask(S, scaled(pine_pts(cx, b, h, w, 960 + i), k)))
snowcap = np.clip(trees - np.roll(trees, int(3 * k) + 1, axis=0), 0, 1)
tcol = lerp(hex2rgb(P['tree']), hex2rgb(P['near_dark']), smooth(0.5, 0.9, fbm(S, 42, scale=30 * k, octaves=2)) * 0.5)
tcol = lerp(tcol, hex2rgb(P['snow_lit']), snowcap * 0.85)

# A small herd of reindeer, far off on the snowfield.
deer = np.zeros(S, np.float32)
for i, (dx, dy, s, face) in enumerate([(760, 676, 1.0, 1), (800, 680, 0.9, -1), (842, 674, 1.05, 1),
                                       (880, 682, 0.85, 1), (705, 684, 0.8, -1)]):
    f = face
    body_pts = [(-9, -9), (8, -10), (11, -14), (14, -16), (16, -13), (13, -9), (10, -2), (8, 0), (7, -6),
                (-6, -6), (-7, 0), (-9, 0), (-10, -6)]
    antl = [(12, -16), (10, -24), (14, -20), (16, -27), (17, -18)]
    pts = [(dx + f * px * s, dy + py * s) for px, py in body_pts]
    deer = np.maximum(deer, poly_mask(S, scaled(pts, k)))
    apts = [(dx + f * px * s, dy + py * s) for px, py in antl]
    cv2.polylines(deer, [np.round(np.array(scaled(apts, k)) * 16).astype(np.int32)], False, 1.0,
                  max(1, int(1.2 * k)), cv2.LINE_AA, shift=4)
deer = np.clip(deer, 0, 1)

# Tufts of dry grass through the snow, densest in the foreground.
tufts = np.zeros(S, np.float32)
rng = np.random.default_rng(43)
for i in range(360):
    tx = rng.uniform(0, W)
    ty = 700 * k + (H - 700 * k) * rng.random() ** 0.8
    if near[int(min(ty, H - 1)), int(tx)] < 0.9:
        continue
    d = (ty - 680 * k) / (H - 680 * k)
    L = (4 + 40 * d ** 1.5) * k * rng.uniform(0.6, 1.3)
    for j in range(int(rng.integers(2, 5))):
        a = math.radians(-90 + rng.normal(0, 9) + 6)
        x2, y2 = tx + math.cos(a) * L, ty + math.sin(a) * L
        cv2.line(tufts, (int(tx * 4), int(ty * 4)), (int(x2 * 4), int(y2 * 4)), 1.0,
                 max(1, int(round((0.4 + 1.4 * d) * k))), cv2.LINE_AA, shift=2)
tuft_col = hex2rgb('#3a4a7a') if N else hex2rgb('#b7926e')

# ---------------------------------------------------------------- strokes
cv = Canvas(target, seed=51)
ACC_SKY = [hex2rgb(c) for c in (('#3a1f8a', '#1f2f9a', '#2a6f9a') if N else ('#c7a6e6', '#f3c1b8', '#a7b4ec'))]
ACC_AUR = [hex2rgb(c) for c in ('#5ef0b0', '#36d0c4', '#a07ae0')]
ACC_SNOW = [hex2rgb(c) for c in (('#5a78c8', '#8fd8d0', '#3a4fa8') if N else ('#f6cfc6', '#c9b8ee', '#ffe4c8'))]

skym = np.clip(1 - far - near, 0, 1)
sky_clip = cv2.dilate(skym, np.ones((int(12 * k), int(12 * k)), np.uint8))
cv.layer(skym * (1 - aur), math.radians(-14), 190, 34, density=1.2, accents=ACC_SKY, accent_p=0.14,
         clip=sky_clip, thick=0.8, curve=0.3, angle_jitter=0.08)
cv.layer(skym * (1 - aur), math.radians(-12), 90, 18, density=0.7, accents=ACC_SKY, accent_p=0.1,
         clip=sky_clip, thick=0.8, curve=0.3, angle_jitter=0.1, sample_blur=2)
if P['aur'] > 0.5:
    lean = np.gradient(hem)[None, :] * 0.5
    ray_ang = (math.radians(-90) + np.arctan(lean)).astype(np.float32) * np.ones(S, np.float32)
    aur_clip = cv2.dilate(np.clip(aur * 3, 0, 1), np.ones((int(5 * k) + 1, int(5 * k) + 1), np.uint8)) * sky_clip
    cv.layer(np.clip(aur * 1.6, 0, 1) * skym, ray_ang, 100, 20, density=1.6, accents=ACC_AUR, accent_p=0.18,
             clip=aur_clip, thick=0.9, curve=0.15, angle_jitter=0.05, sample_blur=2, pickup=0.25, taper=0.5)
cv.inlay(disc, thick=1.2)
f_ang = slope_angle(zf, 6 * k) * 0.3
cv.layer(far, f_ang, 110, 24, density=1.4, accents=ACC_SNOW, accent_p=0.1, thick=1.0, curve=0.3, angle_jitter=0.1)
cv.layer(near, 0.03, 150, 30, density=1.3, accents=ACC_SNOW, accent_p=0.1, thick=1.0, curve=0.4, angle_jitter=0.06)
cv.layer(near * (0.3 + depth), 0.03, 80, 16, density=0.9, accents=ACC_SNOW, accent_p=0.08, thick=1.1, curve=0.4,
         angle_jitter=0.06, sample_blur=2)
cv.target = lerp(target, tcol, trees)
cv.target = lerp(cv.target, hex2rgb(P['deer']), deer)
cv.inlay(trees, thick=1.0)
cv.layer(trees, math.radians(-160), 18, 5, density=1.2, thick=1.2, angle_jitter=0.35, sample_blur=1, ragged=0.6)
cv.inlay(deer, thick=1.0)
img = cv.finish(relief=0.5)
# Tufts are painted last, as quick dry-brush flicks.
img = lerp(img, tuft_col, np.clip(tufts, 0, 1) * 0.6)
if N:
    sprinkle_stars(img, skym * (1 - np.clip(aur * 3, 0, 1)), k, 240, 6, top=0.75)
else:
    img = np.clip(img + np.exp(-sun_d ** 2)[..., None] * hex2rgb('#ffdca8') * 0.18, 0, 1)
img = np.clip(img + glow[..., None] * hex2rgb('#3fe0a8') * 0.12 * P['aur'], 0, 1)
img = paper(img, k, 2, 0.04)
save(img, f'out/tundra_{TONE}_{W}.jpg')
print('done')
