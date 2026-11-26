"""Aurora Lake, painted as layers for the film.

  sky      the night sky alone
  aurora   the same sky with the ribbon; the film adds the difference as light
  mtn      the mountains, with alpha
  lake     the painted lake, used by the film for its brush texture
  shore    the shore and the red cabin, with alpha
  trees    the framing spruces, with alpha

    python aurora_layers.py 1800
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)
HZ = 590 * k


def R(pts):
    return [(px * k, py * k) for px, py in pts]


def canvas(target, seed):
    cv = Canvas(target, seed=seed)
    return cv


sky = gradient_v(S, [(0, '#0b0a3a'), (0.25, '#17166a'), (0.45, '#232a8e'), (0.59, '#2d4aa0')])
veil = fbm(S, 5, scale=320 * k, octaves=3, aspect=3.0)
sky = lerp(sky, hex2rgb('#3a1f80'), smooth(0.6, 0.9, veil) * 0.35)

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
with_aur = lerp(sky, acol, aur)
hem2 = (520 - 30 * np.sin(u * 6 + 2)) * k
a2 = smooth(-3 * k, 5 * k, hem2[None, :] - y) * np.exp(-np.clip(hem2[None, :] - y, 0, None) / (90 * k)) * rays * 0.55
a2 *= smooth(0.2, 0.6, u)[None, :]
with_aur = lerp(with_aur, hex2rgb('#3fd8a8'), a2)
glow = cv2.GaussianBlur(aur + a2, (0, 0), 30 * k)
with_aur = lerp(with_aur, hex2rgb('#2a8f9a'), np.clip(glow * 0.35, 0, 1) * (1 - aur))

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
mcol = lerp(mcol, hex2rgb('#8ff0c8'), smooth(0.75, 1.0, ml) * 0.35)

ACC_SKY = [hex2rgb(c) for c in ('#3a1f8a', '#1f2f9a', '#2a6f9a', '#4a2fa0')]
ACC_AUR = [hex2rgb(c) for c in ('#5ef0b0', '#36d0c4', '#a07ae0', '#c8ffe0')]
ACC_MTN = [hex2rgb(c) for c in ('#3a3a9e', '#2a5f9e', '#5a4fa8')]
ACC_LAKE = [hex2rgb(c) for c in ('#2a7fae', '#1f3a9a', '#3fc0b0', '#4a2f9a')]

# The sky runs on behind the mountains, so it can show if they move.
skym = (y < HZ + 10 * k).astype(np.float32)
sky_clip = skym


def sky_pass(cv, aurora):
    cv.layer(skym * (1 - aur), math.radians(-18), 240, 42, density=1.2, accents=ACC_SKY, accent_p=0.14,
             clip=sky_clip, thick=0.9, curve=0.3, angle_jitter=0.08, seed=1)
    if not aurora:
        return
    lean = np.gradient(hem)[None, :] * 0.6
    ray_ang = (math.radians(-90) + np.arctan(lean)).astype(np.float32) * np.ones(S, np.float32)
    aur_clip = cv2.dilate(np.clip((aur + a2) * 3, 0, 1), np.ones((int(5 * k) + 1, int(5 * k) + 1), np.uint8))
    cv.layer(np.clip(aur * 1.6 + a2, 0, 1), ray_ang, 100, 22, density=1.6, accents=ACC_AUR, accent_p=0.2,
             clip=aur_clip, thick=1.0, curve=0.15, angle_jitter=0.05, sample_blur=2, pickup=0.25, taper=0.5, seed=2)
    cv.layer(np.clip(aur * 2, 0, 1), ray_ang, 70, 9, density=0.5, accents=ACC_AUR, accent_p=0.15,
             clip=aur_clip, thick=1.1, angle_jitter=0.05, sample_blur=1, taper=0.6, seed=3)
    hem_band = np.exp(-((above - 6 * k) / (9 * k)) ** 2)
    hem_ang = np.arctan(np.gradient(hem))[None, :] * np.ones(S, np.float32)
    tg = cv.target
    cv.target = lerp(cv.target, hex2rgb('#b8f7d8'), hem_band * 0.55 * smooth(0.3, 0.7, fbm(S, 86, scale=60 * k, octaves=2)))
    cv.layer(hem_band, hem_ang.astype(np.float32), 60, 9, density=0.9, clip=aur_clip, thick=1.3, angle_jitter=0.05,
             sample_blur=1, curve=0.1, seed=4)
    cv.target = tg


cv = canvas(sky, 21)
sky_pass(cv, False)
sky_img = cv.finish()
cv = canvas(with_aur, 21)
sky_pass(cv, True)
aur_img = cv.finish()
bloom = cv2.GaussianBlur(np.clip(aur + a2, 0, 1), (0, 0), 18 * k)
aur_img = np.clip(aur_img + bloom[..., None] * hex2rgb('#3fe0a8') * 0.18, 0, 1)
print('sky', flush=True)

cv = canvas(lerp(with_aur, mcol, mtn), 22)
m_ang = slope_angle(zm, 5 * k)
cv.layer(mtn, m_ang, 70, 20, density=1.5, accents=ACC_MTN, accent_p=0.14, thick=1.4, ragged=0.5, curve=0.15)
cv.layer(mtn, m_ang, 36, 11, density=1.0, accents=ACC_MTN, accent_p=0.1, thick=1.5, ragged=0.5, sample_blur=2)
mtn_img = cv.finish()
above_img = lerp(aur_img, mtn_img, mtn)
print('mountains', flush=True)

shore_l = poly_mask(S, R([(0, HZ / k + 30), (0, HZ / k - 6), (120, HZ / k - 12), (260, HZ / k - 10),
                         (420, HZ / k - 2), (520, HZ / k + 4), (470, HZ / k + 14), (300, HZ / k + 22), (0, HZ / k + 30)]))
shore_r = poly_mask(S, R([(1600, HZ / k + 26), (1600, HZ / k - 8), (1440, HZ / k - 6), (1300, HZ / k + 2),
                         (1240, HZ / k + 8), (1350, HZ / k + 18)]))
shore = np.clip(shore_l + shore_r, 0, 1)
scol = lerp(hex2rgb('#121034'), hex2rgb('#c6d6ee'), smooth(0.55, 0.75, fbm(S, 81, scale=30 * k, octaves=2)) * 0.6)

depth = np.clip((y - HZ) / (H - HZ), 0, 1)
wob = (fbm(S, 83, scale=26 * k, octaves=3, aspect=9) - 0.5) * (2 + 22 * depth) * k
mir_y = np.clip(2 * HZ - y + wob * 0.4, 0, H - 1)
refl = cv2.remap(np.float32(above_img), x + wob * 2.2, mir_y, cv2.INTER_LINEAR)
lake = lerp(refl * 0.92, hex2rgb('#101a5a'), 0.08 + 0.22 * depth)
ripple = smooth(0.58, 0.8, fbm(S, 84, scale=24 * k, octaves=2, aspect=10)) * depth
lake = lerp(lake, hex2rgb('#3a59b8'), ripple * 0.35)
water = smooth(HZ - 1, HZ + 1, y)
cv = canvas(lake, 23)
cv.layer(water, 0.0, 200, 22, density=1.4, accents=ACC_LAKE, accent_p=0.12, thick=0.9, curve=0.1,
         angle_jitter=0.02, sample_blur=3)
cv.layer(water * (0.3 + depth), 0.0, 120, 12, density=1.1, accents=ACC_LAKE, accent_p=0.1, thick=1.0,
         angle_jitter=0.02, sample_blur=2)
lake_img = cv.finish()
print('lake', flush=True)

cab = poly_mask(S, R([(300, 586), (380, 586), (380, 552), (300, 552)]))
cab_roof = poly_mask(S, R([(292, 555), (388, 555), (360, 530), (320, 530)]))
cab_win = np.clip(poly_mask(S, R([(318, 562), (332, 562), (332, 576), (318, 576)])) +
                  poly_mask(S, R([(348, 562), (362, 562), (362, 576), (348, 576)])), 0, 1)
ccol = lerp(hex2rgb('#c2402f'), hex2rgb('#6d1f30'), smooth(300 * k, 380 * k, x) * 0.7)
ccol = lerp(ccol, hex2rgb('#eef3fb'), cab_roof)
ccol = lerp(ccol, hex2rgb('#ffc95e'), cab_win)
cabin = np.clip(cab + cab_roof, 0, 1)
base = lerp(lerp(lake_img, above_img, 1 - water), scol, shore)
cv = canvas(base, 24)
cv.layer(shore, 0.0, 50, 8, density=2.0, thick=1.3, angle_jitter=0.1, sample_blur=1)
cv.target = lerp(base, ccol, cabin)
cv.inlay(cabin, thick=1.3)
cv.layer(cab, 0.0, 14, 5, density=1.5, thick=1.2, sample_blur=0.8)
cv.inlay(cab_win, thick=1.5)
shore_img = cv.finish()
print('shore', flush=True)


def pine(cx, base_, height, width, seed):
    rng = np.random.default_rng(seed)
    pts_l, pts_r = [], []
    tiers = int(height / 22) + 4
    for i in range(tiers + 1):
        t = i / tiers
        yy = base_ - height * t
        wv = width * (1 - t) ** 1.1 * (0.7 + 0.3 * rng.random())
        pts_l.append((cx - wv, yy))
        pts_l.append((cx - wv * 0.45, yy - height / tiers * 0.45))
        pts_r.append((cx + wv * (0.9 + 0.2 * rng.random()), yy))
        pts_r.append((cx + wv * 0.45, yy - height / tiers * 0.45))
    pts = [(cx - 4, base_ + 30)] + pts_l + [(cx, base_ - height - 10)] + pts_r[::-1] + [(cx + 4, base_ + 30)]
    return poly_mask(S, R(pts))


trees = np.zeros(S, np.float32)
small = np.zeros(S, np.float32)
for i, (cx, b, h, w) in enumerate([(30, 1000, 760, 120), (150, 960, 540, 90), (230, 900, 380, 66),
                                   (1580, 1000, 820, 130), (1460, 980, 560, 92), (1380, 930, 380, 66),
                                   (90, 640, 150, 30), (440, 600, 70, 16), (1290, 600, 90, 20)]):
    m = pine(cx, b, h, w, 900 + i)
    if i >= 6:
        small = np.maximum(small, m)
    else:
        trees = np.maximum(trees, m)
tcol = lerp(hex2rgb('#07081e'), hex2rgb('#1b2c4a'), smooth(0.5, 0.9, fbm(S, 82, scale=40 * k, octaves=2)))
alltrees = np.maximum(trees, small)
trim = np.clip(alltrees - cv2.erode(alltrees, np.ones((3, 3), np.uint8)), 0, 1)
tcol = lerp(tcol, hex2rgb('#3f9f8a'), trim * 0.6)
cv = canvas(lerp(shore_img, tcol, alltrees), 25)
cv.inlay(alltrees, thick=1.0)
cv.layer(alltrees, math.radians(-160), 26, 6, density=1.6, thick=1.4, angle_jitter=0.35, sample_blur=1, ragged=0.6)
tree_img = cv.finish()
print('trees', flush=True)

np.savez_compressed('out/aurora_layers.npz', sky=np.float16(sky_img), aurora=np.float16(aur_img),
                    mtn=np.float16(mtn_img), mtna=np.float16(mtn), lake=np.float16(lake_img),
                    shore=np.float16(shore_img), shorea=np.float16(np.clip(shore + cabin, 0, 1)),
                    trees=np.float16(tree_img), treesa=np.float16(trees), smalla=np.float16(small),
                    aura=np.float16(np.clip(cv2.dilate(np.clip((aur + a2) * 2.5, 0, 1), np.ones((9, 9), np.uint8)), 0, 1)),
                    hem=np.float32(hem), hz=np.float32([HZ]), k=np.float32([k]), win=np.float16(cab_win))
print('done')
