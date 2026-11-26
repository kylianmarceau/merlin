"""Scene C: Aurora Lake (Night Watch, revisited).

One hero: a great ribbon of aurora folds across the sky and lies again in a
mirror-calm lake. A single red cabin keeps a light on at the shore; pines
frame the view.
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 800
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)
HZ = 590 * k


def R(pts):
    return [(px * k, py * k) for px, py in pts]


# ---------------------------------------------------------------- sky
sky = gradient_v(S, [(0, '#0b0a3a'), (0.25, '#17166a'), (0.45, '#232a8e'), (0.59, '#2d4aa0')])
veil = fbm(S, 5, scale=320 * k, octaves=3, aspect=3.0)
sky = lerp(sky, hex2rgb('#3a1f80'), smooth(0.6, 0.9, veil) * 0.35)

# The ribbon: a lower hem that folds in an S across the sky.
u = X / W
hem = (480 - 230 * np.abs(np.sin(np.pi * np.clip(u * 1.05 - 0.02, 0, 1))) ** 1.3 + 22 * np.sin(u * 13 + 1.3)) * k
hem = np.clip(hem, 200 * k, HZ - 90 * k)
tall = (120 + 60 * np.sin(u * 5.2 + 2.0)) * k
above = hem[None, :] - y
rays = fbm(S, 7, scale=34 * k, octaves=3, aspect=0.12)
rays = 0.45 + 0.55 * smooth(0.25, 0.85, rays)
body = smooth(-3 * k, 6 * k, above) * np.exp(-np.clip(above, 0, None) / tall[None, :]) * smooth(3.2, 1.2, above / tall[None, :])
fold = 0.6 + 0.4 * np.sin(u * 17 + 0.5)[None, :] ** 2
aur = np.clip(body * rays * fold * 1.25, 0, 1)
heightf = np.clip(above / tall[None, :], 0, 1.5)
acol = lerp(hex2rgb('#7cf5b4'), hex2rgb('#2fc7b6'), smooth(0.0, 0.45, heightf))
acol = lerp(acol, hex2rgb('#8a55d2'), smooth(0.45, 1.1, heightf))
acol = lerp(acol, hex2rgb('#e8ffe9'), smooth(0.08, 0.0, heightf) * 0.5)
target = lerp(sky, acol, aur)
# A second, fainter band low over the mountains.
hem2 = (520 - 30 * np.sin(u * 6 + 2)) * k
a2 = smooth(-3 * k, 5 * k, hem2[None, :] - y) * np.exp(-np.clip(hem2[None, :] - y, 0, None) / (90 * k)) * rays * 0.55
a2 *= smooth(0.2, 0.6, u)[None, :]
target = lerp(target, hex2rgb('#3fd8a8'), a2)
glow = cv2.GaussianBlur(aur + a2, (0, 0), 30 * k)
target = lerp(target, hex2rgb('#2a8f9a'), np.clip(glow * 0.35, 0, 1) * (1 - aur))

# ---------------------------------------------------------------- mountains
mline = ridge_line(W, 77, HZ - 50 * k, 100 * k, scale=340 * k, octaves=4)
peak = 170 * k * np.clip(1 - np.abs(X - 1000 * k) / (300 * k), 0, 1) ** 1.3
mline = np.minimum(mline, HZ - 40 * k - peak)
mline = np.clip(mline, 200 * k, HZ)
mtn = below(S, mline) * (y < HZ + 1)
zm = -(y - mline[None, :]) * 0.9 + 120 * k * fbm(S, 78, scale=220 * k, octaves=3)
ml, _ = shade_terrain(zm, (-0.6, -0.5, 0.5), blur=3 * k)
ml = 0.6 * ml + 0.4 * np.round(ml * 5) / 5
snow = smooth(0.36, 0.5, ml) * smooth(HZ - 20 * k, HZ - 120 * k, y) + smooth(0.5, 0.6, ml) * 0.5
mcol = lerp(hex2rgb('#141760'), hex2rgb('#2d2f8a'), ml)
mcol = lerp(mcol, lerp(hex2rgb('#6f86cf'), hex2rgb('#dff0f1'), smooth(0.6, 1.0, ml)), snow)
mcol = lerp(mcol, hex2rgb('#8ff0c8'), smooth(0.75, 1.0, ml) * 0.35)  # aurora light on the snow
target = lerp(target, mcol, mtn)

sky_only = np.clip(1 - mtn - aur * 2, 0, 1)

# ---------------------------------------------------------------- shore, cabin, pines
shore_l = poly_mask(S, R([(0, HZ / k + 30), (0, HZ / k - 6), (120, HZ / k - 12), (260, HZ / k - 10),
                         (420, HZ / k - 2), (520, HZ / k + 4), (470, HZ / k + 14), (300, HZ / k + 22), (0, HZ / k + 30)]))
shore_r = poly_mask(S, R([(1600, HZ / k + 26), (1600, HZ / k - 8), (1440, HZ / k - 6), (1300, HZ / k + 2),
                         (1240, HZ / k + 8), (1350, HZ / k + 18)]))
shore = np.clip(shore_l + shore_r, 0, 1)
scol = lerp(hex2rgb('#121034'), hex2rgb('#c6d6ee'), smooth(0.55, 0.75, fbm(S, 81, scale=30 * k, octaves=2)) * 0.6)
target = lerp(target, scol, shore)

cab = poly_mask(S, R([(300, 586), (380, 586), (380, 552), (300, 552)]))
cab_roof = poly_mask(S, R([(292, 555), (388, 555), (360, 530), (320, 530)]))
cab_win = poly_mask(S, R([(318, 562), (332, 562), (332, 576), (318, 576)])) + poly_mask(S, R([(348, 562), (362, 562), (362, 576), (348, 576)]))
ccol = lerp(hex2rgb('#c2402f'), hex2rgb('#6d1f30'), smooth(300 * k, 380 * k, x) * 0.7)
ccol = lerp(ccol, hex2rgb('#eef3fb'), cab_roof)
ccol = lerp(ccol, hex2rgb('#ffc95e'), np.clip(cab_win, 0, 1))
cabin = np.clip(cab + cab_roof, 0, 1)
target = lerp(target, ccol, cabin)


def pine(cx, base, height, width, seed):
    """Jagged tiers of a spruce silhouette."""
    rng = np.random.default_rng(seed)
    pts_l, pts_r = [], []
    tiers = int(height / 22) + 4
    for i in range(tiers + 1):
        t = i / tiers
        yy = base - height * t
        wv = width * (1 - t) ** 1.1 * (0.7 + 0.3 * rng.random())
        pts_l.append((cx - wv, yy))
        pts_l.append((cx - wv * 0.45, yy - height / tiers * 0.45))
        pts_r.append((cx + wv * (0.9 + 0.2 * rng.random()), yy))
        pts_r.append((cx + wv * 0.45, yy - height / tiers * 0.45))
    pts = [(cx - 4, base + 30)] + pts_l + [(cx, base - height - 10)] + pts_r[::-1] + [(cx + 4, base + 30)]
    return poly_mask(S, R(pts))


trees = np.zeros(S, np.float32)
for i, (cx, b, h, w) in enumerate([(30, 1000, 760, 120), (150, 960, 540, 90), (230, 900, 380, 66),
                                   (1580, 1000, 820, 130), (1460, 980, 560, 92), (1380, 930, 380, 66),
                                   (90, 640, 150, 30), (440, 600, 70, 16), (1290, 600, 90, 20)]):
    trees = np.maximum(trees, pine(cx, b, h, w, 900 + i))
tcol = lerp(hex2rgb('#07081e'), hex2rgb('#1b2c4a'), smooth(0.5, 0.9, fbm(S, 82, scale=40 * k, octaves=2)))
# The aurora rims the left side of each needle tier.
trim = np.clip(trees - cv2.erode(trees, np.ones((3, 3), np.uint8)), 0, 1)
tcol = lerp(tcol, hex2rgb('#3f9f8a'), trim * 0.6)

# ---------------------------------------------------------------- lake (mirror)
above_img = target.copy()
depth = np.clip((y - HZ) / (H - HZ), 0, 1)
wob = (fbm(S, 83, scale=26 * k, octaves=3, aspect=9) - 0.5) * (2 + 22 * depth) * k
mir_y = np.clip(2 * HZ - y + wob * 0.4, 0, H - 1)
refl = cv2.remap(above_img, x + wob * 2.2, mir_y, cv2.INTER_LINEAR)
lake = lerp(refl * 0.92, hex2rgb('#101a5a'), 0.08 + 0.22 * depth)
ripple = smooth(0.58, 0.8, fbm(S, 84, scale=24 * k, octaves=2, aspect=10)) * depth
lake = lerp(lake, hex2rgb('#3a59b8'), ripple * 0.35)
water = smooth(HZ - 1, HZ + 1, y) * (1 - shore)
target = lerp(target, lake, water)
# Cabin light lies in the water as a broken gold column.
col_l = np.exp(-((x - 340 * k) / (16 * k + 30 * k * depth)) ** 2) * smooth(HZ + 260 * k, HZ + 4 * k, y)
target = lerp(target, hex2rgb('#ffb04f'), col_l * smooth(0.4, 0.7, fbm(S, 85, scale=12 * k, octaves=2, aspect=6)) * water * 0.9)

no_trees = target.copy()
target = lerp(target, tcol, trees)

# ---------------------------------------------------------------- strokes
cv = Canvas(no_trees, seed=21)
ACC_SKY = [hex2rgb(c) for c in ('#3a1f8a', '#1f2f9a', '#2a6f9a', '#4a2fa0')]
ACC_AUR = [hex2rgb(c) for c in ('#5ef0b0', '#36d0c4', '#a07ae0', '#c8ffe0')]
ACC_MTN = [hex2rgb(c) for c in ('#3a3a9e', '#2a5f9e', '#5a4fa8')]
ACC_LAKE = [hex2rgb(c) for c in ('#2a7fae', '#1f3a9a', '#3fc0b0', '#4a2f9a')]

skym = np.clip(1 - mtn - water - shore, 0, 1) * (y < HZ)
sky_clip = cv2.dilate(skym, np.ones((int(12 * k), int(12 * k)), np.uint8))
cv.layer(skym * (1 - aur), math.radians(-18), 240, 42, density=1.2, accents=ACC_SKY, accent_p=0.14,
         clip=sky_clip, thick=0.9, curve=0.3, angle_jitter=0.08)
# Curtain rays: tall strokes that lean with the fold of the ribbon.
lean = np.gradient(hem)[None, :] * 0.6
ray_ang = (math.radians(-90) + np.arctan(lean)).astype(np.float32) * np.ones(S, np.float32)
aur_clip = cv2.dilate(np.clip((aur + a2) * 3, 0, 1), np.ones((int(5 * k) + 1, int(5 * k) + 1), np.uint8)) * sky_clip
cv.layer(np.clip(aur * 1.6 + a2, 0, 1) * skym, ray_ang, 100, 22, density=1.6, accents=ACC_AUR, accent_p=0.2,
         clip=aur_clip, thick=1.0, curve=0.15, angle_jitter=0.05, sample_blur=2, pickup=0.25, taper=0.5)
cv.layer(np.clip(aur * 2, 0, 1) * skym, ray_ang, 70, 9, density=0.5, accents=ACC_AUR, accent_p=0.15,
         clip=aur_clip, thick=1.1, angle_jitter=0.05, sample_blur=1, taper=0.6)
hem_band = np.exp(-((above - 6 * k) / (9 * k)) ** 2) * skym
hem_ang = np.arctan(np.gradient(hem))[None, :] * np.ones(S, np.float32)
cv.target = lerp(cv.target, hex2rgb('#b8f7d8'), hem_band * 0.55 * smooth(0.3, 0.7, fbm(S, 86, scale=60 * k, octaves=2)))
cv.layer(hem_band, hem_ang.astype(np.float32), 60, 9, density=0.9, clip=aur_clip, thick=1.3, angle_jitter=0.05,
         sample_blur=1, curve=0.1)
cv.target = no_trees
m_ang = slope_angle(zm, 5 * k)
cv.layer(mtn, m_ang, 70, 20, density=1.5, accents=ACC_MTN, accent_p=0.14, thick=1.4, ragged=0.5, curve=0.15)
cv.layer(mtn, m_ang, 36, 11, density=1.0, accents=ACC_MTN, accent_p=0.1, thick=1.5, ragged=0.5, sample_blur=2)
cv.layer(water, 0.0, 200, 22, density=1.4, accents=ACC_LAKE, accent_p=0.12, thick=0.9, curve=0.1,
         angle_jitter=0.02, sample_blur=3)
cv.layer(water * (0.3 + depth), 0.0, 120, 12, density=1.1, accents=ACC_LAKE, accent_p=0.1, thick=1.0,
         angle_jitter=0.02, sample_blur=2)
cv.layer(shore, 0.0, 50, 8, density=2.0, thick=1.3, angle_jitter=0.1, sample_blur=1)
cv.inlay(cabin, thick=1.3)
cv.layer(cab, 0.0, 14, 5, density=1.5, thick=1.2, sample_blur=0.8)
cv.inlay(np.clip(cab_win, 0, 1), thick=1.5)
cv.target = target
cv.inlay(trees, thick=1.0)
cv.layer(trees, math.radians(-160), 26, 6, density=1.6, thick=1.4, angle_jitter=0.35, sample_blur=1, ragged=0.6)

img = cv.finish()
# Stars, then a soft bloom from the aurora.
rng = np.random.default_rng(4)
for _ in range(260):
    sx, sy = int(rng.random() * W), int(rng.random() * HZ * 0.8)
    if skym[sy, sx] > 0.9 and aur[sy, sx] < 0.15 and trees[sy, sx] < 0.1:
        r = max(1, int(rng.uniform(0.6, 1.8) * k + 0.5))
        b = rng.uniform(0.45, 1.0)
        cv2.circle(img, (sx, sy), r, tuple(float(c) for c in (img[sy, sx] * (1 - b) + np.array([0.9, 0.93, 1.0]) * b)), -1, cv2.LINE_AA)
bloom = cv2.GaussianBlur(np.clip(aur + a2, 0, 1), (0, 0), 18 * k)
img = np.clip(img + bloom[..., None] * hex2rgb('#3fe0a8') * 0.18, 0, 1)
save(img, f'out/aurora_{W}.jpg')
print('done')
