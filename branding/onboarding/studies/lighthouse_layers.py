"""Lighthouse Point, painted as layers for the film.

  sky    sky, afterglow and the far coast (no beam: the film turns it)
  bars   the long cloud bars, on a wide canvas so they can drift
  sea    the sea, mirroring the sky
  head   the headland with the lighthouse and cottage, with alpha
  rocks  the foreground rocks, with alpha
  plus distance maps to the shore for the surf, and the lit windows

    python lighthouse_layers.py 1800
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
HZ = 575 * k
LX, LY = 360 * k, 262 * k
EXTRA = int(300 * k)
WW = W + EXTRA

sky = gradient_v(S, [(0, '#120f4c'), (0.2, '#221f86'), (0.38, '#3b37a8'), (0.5, '#6a4fb4'), (0.56, '#c27aa6'),
                     (0.6, '#f0a58e')])
warm = np.exp(-((x - 1250 * k) / (600 * k)) ** 2) * smooth(330 * k, HZ, y)
sky = lerp(sky, hex2rgb('#f6b98f'), warm * 0.55)
sky = lerp(sky, hex2rgb('#ffd7a3'), warm * smooth(520 * k, HZ, y) * 0.6)
veil = fbm(S, 31, scale=300 * k, octaves=3, aspect=3.5)
sky = lerp(sky, hex2rgb('#4a2a95'), smooth(0.62, 0.9, veil) * 0.5 * smooth(450 * k, 100 * k, y))

far_line = ridge_line(W, 41, HZ - 30 * k, 40 * k, scale=420 * k, octaves=4, sharp=False)
far_line = np.where(X > 1050 * k, far_line + (X - 1050 * k) * -0.05, HZ + 5)
far = below(S, far_line) * (y < HZ + 2 * k)
target = lerp(sky, lerp(hex2rgb('#5a3f93'), hex2rgb('#8b5ea8'), smooth(1600 * k, 1100 * k, x)), far)

ACC_SKY = [hex2rgb(c) for c in ('#5b2fa3', '#2f43c0', '#8a4fa8', '#3b6fb5')]
ACC_WARM = [hex2rgb(c) for c in ('#f6a98a', '#e48aa0', '#ffd09a', '#b07ab8')]
ACC_SEA = [hex2rgb(c) for c in ('#2a6fae', '#3f3aa6', '#2d9bb0', '#5a3fa0')]
ACC_ROCK = [hex2rgb(c) for c in ('#4a2f8f', '#6b3f8a', '#2e4f8e', '#a3567f')]

skym = np.clip((y < HZ + 6 * k) - far, 0, 1)
cv = Canvas(target, seed=11)
cv.layer(skym * (1 - warm * 0.6), math.radians(-12), 260, 44, density=1.2, accents=ACC_SKY, accent_p=0.15,
         clip=skym, thick=1.0, curve=0.25, angle_jitter=0.07)
cv.layer(skym * warm, math.radians(-4), 220, 30, density=1.4, accents=ACC_WARM, accent_p=0.2, clip=skym,
         thick=1.0, curve=0.2, angle_jitter=0.05)
cv.layer(far, 0.0, 90, 14, density=1.5, thick=1.0, angle_jitter=0.03)
sky_img = cv.finish()
print('sky', flush=True)

# Cloud bars on a wider canvas.
yw, xw = np.mgrid[:H, :WW].astype(np.float32)
warm_w = np.exp(-((xw - 1250 * k) / (600 * k)) ** 2) * smooth(330 * k, HZ, yw)
bars = fbm((H, WW), 32, scale=60 * k, octaves=3, aspect=8.0)
barm = smooth(0.62, 0.75, bars) * smooth(260 * k, 380 * k, yw) * smooth(560 * k, 470 * k, yw)
bar_col = lerp(hex2rgb('#7b4f9c'), hex2rgb('#ffb48f'), warm_w)
sky_w = np.pad(target, ((0, 0), (0, EXTRA), (0, 0)), mode='edge')
cv = Canvas(lerp(sky_w, bar_col, barm * 0.8), seed=12)
cv.k = k
cv.layer(barm, math.radians(-3), 150, 16, density=1.2, accents=ACC_WARM, accent_p=0.15, clip=np.clip(barm * 1.6, 0, 1),
         thick=1.1, angle_jitter=0.04)
bars_img = cv.finish()
y0b, y1b = int(240 * k), int(580 * k)
print('bars', flush=True)

# Sea: a mirror of the sky, broken into slabs, with the rose column.
full_sky = lerp(target, bar_col[:, :W], barm[:, :W] * 0.8)
depth = np.clip((y - HZ) / (H - HZ), 0, 1)
sea = gradient_v(S, [(0, '#2b2a86'), (0.57, '#2a2f92'), (0.66, '#1f3596'), (0.85, '#172a80'), (1, '#0f1a5a')])
mir_y = np.clip(2 * HZ - y, 0, H - 1)
wob = (fbm(S, 33, scale=40 * k, octaves=3, aspect=6) - 0.5) * (6 + 30 * depth) * k
refl = cv2.remap(np.float32(full_sky), x + wob * 3, mir_y + wob, cv2.INTER_LINEAR)
sea = lerp(sea, refl, 0.42 - 0.32 * depth)
glint = smooth(0.55, 0.8, fbm(S, 34, scale=30 * k, octaves=3, aspect=7))
sea = lerp(sea, hex2rgb('#ffc89a'), glint * np.exp(-((x - 1250 * k) / (380 * k)) ** 2) * smooth(HZ + 260 * k, HZ, y) * 0.6)
sea = lerp(sea, hex2rgb('#2a8fae'), smooth(0.55, 0.85, fbm(S, 35, scale=80 * k, octaves=3, aspect=5)) * (0.3 + depth) * 0.55)
column = np.exp(-((x - 1200 * k) / (90 * k + 200 * k * depth)) ** 2) * smooth(HZ + 330 * k, HZ, y)
sea = lerp(sea, hex2rgb('#ffbf94'), column * smooth(0.45, 0.75, fbm(S, 36, scale=24 * k, octaves=2, aspect=8)) * 0.85)
water = smooth(HZ - 1, HZ + 1, y)
cv = Canvas(lerp(full_sky, sea, water), seed=13)
cv.layer(water, 0.0, 170, 22, density=1.3, accents=ACC_SEA, accent_p=0.16, thick=1.0, curve=0.15, angle_jitter=0.03)
cv.layer(water * (0.4 + depth), 0.0, 110, 14, density=1.0, accents=ACC_SEA, accent_p=0.12, thick=1.1,
         curve=0.15, angle_jitter=0.03, sample_blur=2)
sea_img = cv.finish()
print('sea', flush=True)

head_pts = [(0, 1000), (0, 500), (60, 494), (140, 486), (220, 482), (300, 478), (380, 476), (450, 480),
            (500, 492), (540, 520), (575, 560), (610, 610), (650, 680), (700, 760), (740, 850), (730, 930), (690, 1000)]
head = poly_mask(S, [(px * k, py * k) for px, py in head_pts])
zh = 150 * k * fbm(S, 51, scale=300 * k, octaves=3) - x * 0.45 + y * 0.1
hl, _ = shade_terrain(zh, (0.85, -0.45, 0.35), blur=3 * k)
hl = 0.55 * hl + 0.45 * np.round(hl * 5) / 5
strata = smooth(0.5, 0.8, fbm(S, 54, scale=90 * k, octaves=3, aspect=0.25))
hl = np.clip(hl + 0.25 * strata * smooth(380 * k, 650 * k, x), 0, 1)
rock = lerp(hex2rgb('#0f0b2e'), hex2rgb('#2f2266'), hl)
rock = lerp(rock, hex2rgb('#7f4f96'), smooth(0.65, 0.95, hl) * 0.6)
rock = lerp(rock, hex2rgb('#e79a8e'), smooth(0.9, 1.0, hl) * 0.45)
top = np.interp(X, [p[0] * k for p in head_pts[1:11]], [p[1] * k for p in head_pts[1:11]])
grass = smooth(top[None, :] + 50 * k, top[None, :] + 20 * k, y) * (x < 560 * k)
rock = lerp(rock, lerp(hex2rgb('#1d2c5e'), hex2rgb('#4f5a8f'), smooth(0.4, 0.8, hl)), grass * 0.85)
scene = lerp(lerp(full_sky, sea, water), rock, head)


def Rp(pts):
    return [(px * k, py * k) for px, py in pts]


TB, TT = 478, 300
tower = poly_mask(S, Rp([(330, TB), (390, TB), (378, TT), (342, TT)]))
tshade = smooth(LX - 26 * k, LX + 26 * k, x)
tcol = lerp(hex2rgb('#f3ecf6'), hex2rgb('#7b77b8'), tshade)
bandm = (((y > 345 * k) & (y < 372 * k)) | ((y > 410 * k) & (y < 437 * k))).astype(np.float32)
tcol = lerp(tcol, lerp(hex2rgb('#d4543f'), hex2rgb('#7a2b48'), tshade), bandm)
door = poly_mask(S, Rp([(352, TB), (368, TB), (368, 452), (352, 452)]))
tcol = lerp(tcol, hex2rgb('#3a2a5a'), door)
gallery = poly_mask(S, Rp([(334, 304), (386, 304), (386, 294), (334, 294)]))
glass = poly_mask(S, Rp([(345, 294), (375, 294), (375, 256), (345, 256)]))
cap = poly_mask(S, Rp([(340, 258), (380, 258), (360, 232)]))
lh = np.clip(tower + gallery + glass + cap, 0, 1)
lcol = lerp(tcol, hex2rgb('#2a2050'), gallery)
lcol = lerp(lcol, hex2rgb('#fff0b8'), glass)
lcol = lerp(lcol, hex2rgb('#3a2340'), cap)
house = poly_mask(S, Rp([(170, 482), (290, 480), (290, 436), (170, 436)]))
roof = poly_mask(S, Rp([(160, 440), (300, 440), (275, 402), (185, 402)]))
chim = poly_mask(S, Rp([(258, 412), (270, 412), (270, 392), (258, 392)]))
hcol = lerp(hex2rgb('#dcd2ea'), hex2rgb('#6d6aab'), smooth(170 * k, 300 * k, x) * 0.6)
win = np.zeros(S, np.float32)
for wx in (190, 222, 256):
    win = np.maximum(win, poly_mask(S, Rp([(wx, 452), (wx + 15, 452), (wx + 15, 470), (wx, 470)])))
hcol = lerp(hcol, hex2rgb('#ffc861'), win)
hcol = lerp(hcol, hex2rgb('#8a2f3c'), np.clip(roof + chim, 0, 1))
house = np.clip(house + chim, 0, 1)
build = np.clip(house + roof, 0, 1)
detail = lerp(lerp(scene, lcol, lh), hcol, build)

cv = Canvas(scene, seed=14)
head_ang = slope_angle(zh, 5 * k) * 0.25 + math.radians(82) * 0.75
cv.layer(head, head_ang, 90, 26, density=1.5, accents=ACC_ROCK, accent_p=0.18, thick=1.5, ragged=0.6, curve=0.2)
cv.layer(head * grass, math.radians(-75), 30, 6, density=1.6, thick=1.2, angle_jitter=0.3, ragged=0.4, sample_blur=2)
cv.layer(head, head_ang, 46, 13, density=0.9, accents=ACC_ROCK, accent_p=0.12, thick=1.6, ragged=0.6, sample_blur=2)
cv.target = detail
cv.inlay(np.clip(lh + build, 0, 1), thick=1.3)
cv.layer(tower, math.radians(90), 18, 6, density=2.0, thick=1.2, sample_blur=0.8, angle_jitter=0.05)
cv.layer(build, 0.0, 16, 5, density=1.4, thick=1.2, sample_blur=0.8)
cv.inlay(np.clip(win + glass, 0, 1), thick=1.6)
head_img = cv.finish()
heada = np.clip(head + lh + build, 0, 1)
print('head', flush=True)

fr_pts = [(1600, 1000), (1600, 880), (1540, 866), (1480, 890), (1420, 930), (1360, 970), (1320, 1000)]
fr = poly_mask(S, [(px * k, py * k) for px, py in fr_pts])
fl, _ = shade_terrain(120 * k * fbm(S, 52, scale=120 * k), (0.8, -0.5, 0.4), blur=2 * k)
cv = Canvas(lerp(scene, lerp(hex2rgb('#0e0b2b'), hex2rgb('#4a2f6e'), fl), fr), seed=15)
cv.layer(fr, math.radians(40), 70, 22, density=1.6, accents=ACC_ROCK, accent_p=0.15, thick=1.6, ragged=0.6)
rocks_img = cv.finish()
print('rocks', flush=True)

# Distance from each shore, over the water, for the surf.
d_head = cv2.distanceTransform(np.uint8(head < 0.5), cv2.DIST_L2, 5) / k
d_rock = cv2.distanceTransform(np.uint8(fr < 0.5), cv2.DIST_L2, 5) / k

np.savez_compressed('out/lighthouse_layers.npz', sky=np.float16(sky_img), bars=np.float16(bars_img[y0b:y1b]),
                    barsa=np.float16(np.clip(barm[y0b:y1b] * 1.2, 0, 1)), band=np.int32([y0b, y1b]),
                    sea=np.float16(sea_img), head=np.float16(head_img), heada=np.float16(heada),
                    rocks=np.float16(rocks_img), rocksa=np.float16(fr), dhead=np.float16(np.minimum(d_head, 300)),
                    drock=np.float16(np.minimum(d_rock, 300)), win=np.float16(win), glass=np.float16(glass),
                    lantern=np.float32([LX, LY]), hz=np.float32([HZ]), k=np.float32([k]))
print('done')
