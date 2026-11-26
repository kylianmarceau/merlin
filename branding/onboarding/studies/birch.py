"""Scene H: Birch Lake.

A still lake in autumn, framed by white birches with gold leaves. Mist lies
on the water in the morning; at dusk the sky burns low and the mist turns
lavender.

    python birch.py 1600 morning|dusk
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 800
TONE = sys.argv[2] if len(sys.argv) > 2 else 'morning'
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)
M = TONE == 'morning'
HZ = 585 * k

P = dict(
    morning=dict(sky=[(0, '#8fb2e2'), (0.3, '#b9cdea'), (0.5, '#efe2d0'), (0.6, '#fbe8c8')],
                 far='#8f9fcc', shore=('#d79a3a', '#e8b84a', '#b8572e', '#5f6a3a'), spruce='#2f4038',
                 mist='#fff4e4', mist_amt=0.85, water_tint='#6f8fc0', bark='#f1ece2', bark_sh='#a89cb8',
                 leaf=('#f2b437', '#e48a2a', '#f7d15a', '#c9662a'), bank='#b99a4a', bank_sh='#6a5a3a',
                 sun=(860, 470, 34), sun_col='#fff6dc', glow='#fff0c8'),
    dusk=dict(sky=[(0, '#202a78'), (0.28, '#4a4aa8'), (0.45, '#b86fa8'), (0.56, '#f59a7a'), (0.6, '#ffc58a')],
              far='#4a3f86', shore=('#8a4a4a', '#a8603a', '#6a3a4a', '#2f2a4a'), spruce='#1a1632',
              mist='#c8a8e0', mist_amt=0.6, water_tint='#2f3a8a', bark='#d8c8dc', bark_sh='#5a4a7a',
              leaf=('#e0843a', '#c85a3a', '#f0a050', '#8a3a4a'), bank='#6a4a5a', bank_sh='#2a2040',
              sun=(860, 600, 0), sun_col='#ffe0b0', glow='#ffb070'),
)[TONE]

# ---------------------------------------------------------------- sky
sky = gradient_v(S, [(a, c) for a, c in P['sky']])
SX, SY, SR = (v * k for v in P['sun'])
sd = radial(S, SX, SY, max(SR, 1))
glow = np.exp(-radial(S, SX, HZ, 420 * k, 0.45) ** 2)
sky = lerp(sky, hex2rgb(P['glow']), glow * 0.6)
cl = fbm(S, 121, scale=200 * k, octaves=4, aspect=4)
clouds = smooth(0.6, 0.78, cl) * smooth(60 * k, 160 * k, y) * smooth(470 * k, 300 * k, y)
sky = lerp(sky, hex2rgb('#ffffff' if M else '#f6a0a0'), clouds * (0.55 if M else 0.5))
disc = np.clip((1 - sd) * SR * 0.7, 0, 1) if SR > 0 else np.zeros(S, np.float32)
target = lerp(sky, hex2rgb(P['sun_col']), disc)

# ---------------------------------------------------------------- far shore
far_line = hills(W, k, 470, 50, 600, 122)
far = below(S, far_line) * (y < HZ)
target = lerp(target, lerp(hex2rgb(P['far']), sky, 0.25), far)
shore_line = hills(W, k, 530, 26, 340, 123)
shore = below(S, shore_line) * (y < HZ)
pa = fbm(S, 124, scale=30 * k, octaves=3)
pb = fbm(S, 125, scale=60 * k, octaves=2)
s0, s1, s2, s3 = (hex2rgb(c) for c in P['shore'])
scol = lerp(s0, s1, smooth(0.45, 0.7, pa))
scol = lerp(scol, s2, smooth(0.65, 0.85, pb))
scol = lerp(scol, s3, smooth(0.7, 0.85, pa * 0.5 + pb * 0.5) * 0.7)
target = lerp(target, scol, shore)
spr = np.zeros(S, np.float32)
rng = np.random.default_rng(126)
for i in range(90):
    cx = rng.uniform(0, 1600)
    base = np.interp(cx * k, X, shore_line) / k + rng.uniform(6, 50)
    h = rng.uniform(18, 42)
    spr = np.maximum(spr, poly_mask(S, scaled(pine_pts(cx, base, h, h * 0.26, 1200 + i), k)))
spr *= (y < HZ)
target = lerp(target, hex2rgb(P['spruce']), spr)
upper = target.copy()

# ---------------------------------------------------------------- lake
depth = np.clip((y - HZ) / (H - HZ), 0, 1)
wob = (fbm(S, 127, scale=20 * k, octaves=3, aspect=10) - 0.5) * (2 + 18 * depth) * k
mir = cv2.remap(upper, x + wob * 2, np.clip(2 * HZ - y + wob * 0.3, 0, H - 1), cv2.INTER_LINEAR)
lake = lerp(mir, hex2rgb(P['water_tint']), 0.18 + 0.25 * depth)
ripple = smooth(0.6, 0.8, fbm(S, 128, scale=22 * k, octaves=2, aspect=12)) * (0.3 + depth)
lake = lerp(lake, lerp(hex2rgb(P['water_tint']), sky[int(HZ * 0.6)], 0.6), ripple * 0.35)
water = smooth(HZ - 1, HZ + 1, y)
target = lerp(target, lake, water)
# Mist: a soft bank lying on the water against the far shore.
mist = np.exp(-((y - HZ - 4 * k) / (34 * k)) ** 2) * (0.5 + 0.5 * fbm(S, 129, scale=180 * k, octaves=3, aspect=5))
mist = np.clip(mist * 1.2, 0, 1)
target = lerp(target, hex2rgb(P['mist']), mist * P['mist_amt'])

# ---------------------------------------------------------------- near bank and birches
bank_line = 930 * k - 80 * k * np.exp(-((X - 0) / (420 * k)) ** 2) - 90 * k * np.exp(-((X - W) / (380 * k)) ** 2)
bank = below(S, bank_line)
bz = 40 * k * fbm(S, 130, scale=60 * k, octaves=3)
bl, _ = shade_terrain(bz, (0.6, -0.6, 0.5), blur=2 * k)
target = lerp(target, lerp(hex2rgb(P['bank_sh']), hex2rgb(P['bank']), bl), bank)

trunks = np.zeros(S, np.float32)
bark = np.zeros(S + (3,), np.float32)
leaves = np.zeros(S, np.float32)
leafcol = np.zeros(S + (3,), np.float32) + hex2rgb(P['leaf'][0])
rng = np.random.default_rng(131)
lc = [hex2rgb(c) for c in P['leaf']]
for i, (bx, lean, w0) in enumerate([(70, 0.06, 34), (190, -0.03, 22), (260, 0.08, 16), (1350, -0.05, 20),
                                    (1450, 0.04, 30), (1540, -0.02, 38)]):
    base_y = float(np.interp(bx * k, X, bank_line)) / k + 30
    pts = [(bx - w0 / 2, base_y), (bx + w0 / 2, base_y), (bx + w0 * 0.3 + lean * 1000, -20), (bx - w0 * 0.3 + lean * 1000, -20)]
    m = poly_mask(S, scaled(pts, k))
    # Bark: white, shaded on the far side, with dark lenticels.
    cx_line = (bx + lean * (base_y - y / k)) * k
    side = smooth(-0.2, 1.0, (x - cx_line) / (w0 * 0.5 * k))
    col = lerp(hex2rgb(P['bark']), hex2rgb(P['bark_sh']), side)
    marks = smooth(0.72, 0.8, fbm(S, 140 + i, scale=10 * k, octaves=2, aspect=4.0))
    col = lerp(col, hex2rgb('#2a2230'), marks * 0.85)
    bark = lerp(bark, col, m)
    trunks = np.maximum(trunks, m)
    # Gold crowns hang in loose clusters, densest at the top of the frame.
    for _ in range(70):
        t = rng.random() ** 1.6
        ly = (-30 + t * 520) * k
        lx = (bx + lean * (base_y - ly / k) + rng.normal(0, 70 + 60 * (1 - t))) * k
        r = rng.uniform(14, 34) * k * (1.2 - t * 0.5)
        c = lc[int(rng.integers(len(lc)))]
        for _ in range(13):
            ox, oy = rng.normal(0, r * 0.6), rng.normal(0, r * 0.4)
            rr = rng.uniform(3, 7) * k
            cv2.ellipse(leaves, (int((lx + ox) * 4), int((ly + oy) * 4)), (max(1, int(rr * 4)), max(1, int(rr * 2.4))),
                        rng.uniform(0, 180), 0, 360, 1.0, -1, cv2.LINE_AA, shift=2)
            cv2.ellipse(leafcol, (int((lx + ox) * 4), int((ly + oy) * 4)), (max(1, int(rr * 4)), max(1, int(rr * 2.4))),
                        rng.uniform(0, 180), 0, 360, tuple(float(v) for v in (c * rng.uniform(0.85, 1.12))), -1,
                        cv2.LINE_AA, shift=2)
leaves *= 1 - trunks * 0.0

# ---------------------------------------------------------------- strokes
cv = Canvas(target, seed=141)
ACC_SKY = [hex2rgb(c) for c in (('#c8d8f0', '#fff0d8', '#e8d0e0') if M else ('#5a3fa8', '#f08a8a', '#ffb07a'))]
ACC_SH = [hex2rgb(c) for c in P['shore']]
ACC_W = [hex2rgb(c) for c in (('#8fb0e0', '#f0d8a8', '#e8a84a') if M else ('#4a3f9a', '#e08a7a', '#ffb07a'))]
skym = np.clip(1 - far - shore - water - bank, 0, 1) * (y < HZ)
sky_clip = cv2.dilate(skym, np.ones((int(12 * k), int(12 * k)), np.uint8))
cv.layer(skym, math.radians(-6), 200, 36, density=1.2, accents=ACC_SKY, accent_p=0.12, clip=sky_clip,
         thick=0.8, curve=0.3, angle_jitter=0.07)
cv.inlay(disc, thick=1.2)
cv.layer(far * (1 - shore), 0.0, 90, 16, density=1.3, thick=0.9, angle_jitter=0.05)
cv.layer(shore, math.radians(-85), 16, 7, density=2.2, accents=ACC_SH, accent_p=0.3, thick=1.3, angle_jitter=0.4,
         sample_blur=1, ragged=0.6)
cv.inlay(spr, thick=1.1)
cv.layer(water, 0.0, 170, 18, density=1.4, accents=ACC_W, accent_p=0.1, thick=0.9, curve=0.1, angle_jitter=0.02,
         sample_blur=2)
cv.layer(water * np.clip(mist * 1.5, 0, 1), 0.0, 220, 26, density=1.2, thick=0.8, angle_jitter=0.02, curve=0.2,
         sample_blur=4, opacity=0.8)
cv.layer(bank, math.radians(-75), 30, 8, density=1.8, accents=ACC_SH, accent_p=0.15, thick=1.4, angle_jitter=0.4,
         sample_blur=1.5, ragged=0.6, curve=0.5, taper=0.5)
cv.target = lerp(cv.target, bark, trunks)
cv.inlay(trunks, thick=1.3)
cv.layer(trunks, math.radians(-90), 30, 6, density=1.2, thick=1.4, angle_jitter=0.05, sample_blur=0.8, ragged=0.5)
cv.target = lerp(cv.target, leafcol, leaves)
cv.layer(leaves, math.radians(70), 10, 6, density=1.6, thick=1.5, angle_jitter=0.8, sample_blur=0.8, ragged=0.6,
         curve=0.6, accents=[hex2rgb(c) for c in P['leaf']], accent_p=0.3)
img = cv.finish(relief=0.55)
img = np.clip(img + glow[..., None] * hex2rgb(P['glow']) * 0.1, 0, 1)
if not M:
    sprinkle_stars(img, skym * smooth(260 * k, 80 * k, y) * (1 - leaves), k, 60, 142, top=0.4)
img = paper(img, k, 5, 0.04)
save(img, f'out/birch_{TONE}_{W}.jpg')
print('done')
