"""Scene B: Lighthouse Point.

Blue hour on a rocky headland. The last band of rose light sits on the sea,
the keeper's windows are lit, and the lantern has just begun to turn.
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
HZ = 575 * k                       # horizon
LX, LY = 360 * k, 262 * k          # lantern
BEAM = math.radians(-8)            # beam heading (towards the right, a touch up)

# ---------------------------------------------------------------- sky
sky = gradient_v(S, [(0, '#120f4c'), (0.2, '#221f86'), (0.38, '#3b37a8'), (0.5, '#6a4fb4'), (0.56, '#c27aa6'),
                     (0.6, '#f0a58e')])
# The afterglow lies to the right of the headland.
warm = np.exp(-((x - 1250 * k) / (600 * k)) ** 2) * smooth(330 * k, HZ, y)
sky = lerp(sky, hex2rgb('#f6b98f'), warm * 0.55)
sky = lerp(sky, hex2rgb('#ffd7a3'), warm * smooth(520 * k, HZ, y) * 0.6)
veil = fbm(S, 31, scale=300 * k, octaves=3, aspect=3.5)
sky = lerp(sky, hex2rgb('#4a2a95'), smooth(0.62, 0.9, veil) * 0.5 * smooth(450 * k, 100 * k, y))
# Long cloud bars lit from below.
bars = fbm(S, 32, scale=60 * k, octaves=3, aspect=8.0)
barm = smooth(0.62, 0.75, bars) * smooth(260 * k, 380 * k, y) * smooth(560 * k, 470 * k, y)
sky = lerp(sky, lerp(hex2rgb('#7b4f9c'), hex2rgb('#ffb48f'), warm), barm * 0.8)

# The lantern's beam: a soft cone of light, brightest near the glass.
ang = np.arctan2(y - LY, x - LX)
dist = np.hypot(x - LX, y - LY)
cone = np.exp(-((ang - BEAM) / (0.05 + 0.00004 * dist / k)) ** 2) * (x > LX)
back = np.exp(-((ang - (BEAM + math.pi - 2 * math.pi)) / (0.06)) ** 2) * (x < LX)
beam = cone * np.exp(-dist / (1300 * k)) * smooth(0, 30 * k, dist)
lamp = np.exp(-(dist / (60 * k)) ** 2)
target = lerp(sky, hex2rgb('#fff0c4'), np.clip(beam * 0.75 + lamp * 0.25, 0, 1))

# ---------------------------------------------------------------- far coast
far_line = ridge_line(W, 41, HZ - 30 * k, 40 * k, scale=420 * k, octaves=4, sharp=False)
far_line = np.where(X > 1050 * k, far_line + (X - 1050 * k) * -0.05, HZ + 5)
far = below(S, far_line) * (y < HZ + 2 * k)
target = lerp(target, lerp(hex2rgb('#5a3f93'), hex2rgb('#8b5ea8'), smooth(1600 * k, 1100 * k, x)), far)

# ---------------------------------------------------------------- sea
depth = np.clip((y - HZ) / (H - HZ), 0, 1)
sea = gradient_v(S, [(0, '#2b2a86'), (0.57, '#2a2f92'), (0.66, '#1f3596'), (0.85, '#172a80'), (1, '#0f1a5a')])
# A mirror of the sky, broken into horizontal slabs.
mir_y = np.clip(2 * HZ - y, 0, H - 1)
wob = (fbm(S, 33, scale=40 * k, octaves=3, aspect=6) - 0.5) * (6 + 30 * depth) * k
refl = cv2.remap(target, x + wob * 3, mir_y + wob, cv2.INTER_LINEAR)
sea = lerp(sea, refl, 0.42 - 0.32 * depth)
glint = smooth(0.55, 0.8, fbm(S, 34, scale=30 * k, octaves=3, aspect=7))
sea = lerp(sea, hex2rgb('#ffc89a'), glint * warm[::-1] * 0 + glint * np.exp(-((x - 1250 * k) / (380 * k)) ** 2) * smooth(HZ + 260 * k, HZ, y) * 0.6)
sea = lerp(sea, hex2rgb('#2a8fae'), smooth(0.55, 0.85, fbm(S, 35, scale=80 * k, octaves=3, aspect=5)) * (0.3 + depth) * 0.55)
column = np.exp(-((x - 1200 * k) / (90 * k + 200 * k * depth)) ** 2) * smooth(HZ + 330 * k, HZ, y)
sea = lerp(sea, hex2rgb('#ffbf94'), column * smooth(0.45, 0.75, fbm(S, 36, scale=24 * k, octaves=2, aspect=8)) * 0.85)
water = smooth(HZ - 1, HZ + 1, y)
target = lerp(target, sea, water)

# ---------------------------------------------------------------- headland
head_pts = [(0, 1000), (0, 500), (60, 494), (140, 486), (220, 482), (300, 478), (380, 476), (450, 480),
            (500, 492), (540, 520), (575, 560), (610, 610), (650, 680), (700, 760), (740, 850), (730, 930), (690, 1000)]
head = poly_mask(S, [(px * k, py * k) for px, py in head_pts])
zh = 150 * k * fbm(S, 51, scale=300 * k, octaves=3) - x * 0.45 + y * 0.1
hl, _ = shade_terrain(zh, (0.85, -0.45, 0.35), blur=3 * k)
# Facets: quantise the light so the cliff breaks into knife-cut planes.
hl = 0.55 * hl + 0.45 * np.round(hl * 5) / 5
# Vertical strata catch the afterglow on the seaward face.
strata = smooth(0.5, 0.8, fbm(S, 54, scale=90 * k, octaves=3, aspect=0.25))
hl = np.clip(hl + 0.25 * strata * smooth(380 * k, 650 * k, x), 0, 1)
rock = lerp(hex2rgb('#0f0b2e'), hex2rgb('#2f2266'), hl)
rock = lerp(rock, hex2rgb('#7f4f96'), smooth(0.65, 0.95, hl) * 0.6)
rock = lerp(rock, hex2rgb('#e79a8e'), smooth(0.9, 1.0, hl) * 0.45)
# A cap of dark winter grass along the top.
top = np.interp(X, [p[0] * k for p in head_pts[1:11]], [p[1] * k for p in head_pts[1:11]])
grass = smooth(top[None, :] + 50 * k, top[None, :] + 20 * k, y) * (x < 560 * k)
rock = lerp(rock, lerp(hex2rgb('#1d2c5e'), hex2rgb('#4f5a8f'), smooth(0.4, 0.8, hl)), grass * 0.85)
target = lerp(target, rock, head)

# ---------------------------------------------------------------- lighthouse and cottage
def R(pts):
    return [(px * k, py * k) for px, py in pts]
TB, TT = 478, 300                   # base and top of the tower
ground = target.copy()
tower = poly_mask(S, R([(330, TB), (390, TB), (378, TT), (342, TT)]))
tshade = smooth(LX - 26 * k, LX + 26 * k, x)
tcol = lerp(hex2rgb('#f3ecf6'), hex2rgb('#7b77b8'), tshade)
band = (((y > 345 * k) & (y < 372 * k)) | ((y > 410 * k) & (y < 437 * k))).astype(np.float32)
tcol = lerp(tcol, lerp(hex2rgb('#d4543f'), hex2rgb('#7a2b48'), tshade), band)
door = poly_mask(S, R([(352, TB), (368, TB), (368, 452), (352, 452)]))
tcol = lerp(tcol, hex2rgb('#3a2a5a'), door)
gallery = poly_mask(S, R([(334, 304), (386, 304), (386, 294), (334, 294)]))
glass = poly_mask(S, R([(345, 294), (375, 294), (375, 256), (345, 256)]))
cap = poly_mask(S, R([(340, 258), (380, 258), (360, 232)]))
lh = np.clip(tower + gallery + glass + cap, 0, 1)
lcol = lerp(tcol, hex2rgb('#2a2050'), gallery)
lcol = lerp(lcol, hex2rgb('#fff0b8'), glass)
lcol = lerp(lcol, hex2rgb('#3a2340'), cap)
target = lerp(target, lcol, lh)

house = poly_mask(S, R([(170, 482), (290, 480), (290, 436), (170, 436)]))
roof = poly_mask(S, R([(160, 440), (300, 440), (275, 402), (185, 402)]))
chim = poly_mask(S, R([(258, 412), (270, 412), (270, 392), (258, 392)]))
hcol = lerp(hex2rgb('#dcd2ea'), hex2rgb('#6d6aab'), smooth(170 * k, 300 * k, x) * 0.6)
win = np.zeros(S, np.float32)
for wx in (190, 222, 256):
    win = np.maximum(win, poly_mask(S, R([(wx, 452), (wx + 15, 452), (wx + 15, 470), (wx, 470)])))
hcol = lerp(hcol, hex2rgb('#ffc861'), win)
hcol = lerp(hcol, hex2rgb('#8a2f3c'), np.clip(roof + chim, 0, 1))
house = np.clip(house + chim, 0, 1)
target = lerp(target, hcol, np.clip(house + roof, 0, 1))
lit_glow = np.exp(-radial(S, 230 * k, 462 * k, 80 * k, 0.4) ** 2) * (1 - house - roof).clip(0, 1)

# ---------------------------------------------------------------- foreground rocks and surf
fr_pts = [(1600, 1000), (1600, 880), (1540, 866), (1480, 890), (1420, 930), (1360, 970), (1320, 1000)]
fr = poly_mask(S, [(px * k, py * k) for px, py in fr_pts])
fl, _ = shade_terrain(120 * k * fbm(S, 52, scale=120 * k), (0.8, -0.5, 0.4), blur=2 * k)
target = lerp(target, lerp(hex2rgb('#0e0b2b'), hex2rgb('#4a2f6e'), fl), fr)
# Surf where the sea meets the base of the headland and the rocks.
edge = np.clip(cv2.dilate(head, np.ones((int(28 * k), int(28 * k)), np.uint8)) - head, 0, 1) * water
edge += np.clip(cv2.dilate(fr, np.ones((int(24 * k), int(24 * k)), np.uint8)) - fr, 0, 1)
foam = edge * smooth(0.55, 0.75, fbm(S, 53, scale=60 * k, octaves=3, aspect=3)) * smooth(HZ + 120 * k, HZ + 260 * k, y)
target = lerp(target, hex2rgb('#e9e3f7'), np.clip(foam, 0, 1) * 0.85)

# ---------------------------------------------------------------- strokes
no_details = target.copy()
cv = Canvas(ground, seed=11)
ACC_SKY = [hex2rgb(c) for c in ('#5b2fa3', '#2f43c0', '#8a4fa8', '#3b6fb5')]
ACC_WARM = [hex2rgb(c) for c in ('#f6a98a', '#e48aa0', '#ffd09a', '#b07ab8')]
ACC_SEA = [hex2rgb(c) for c in ('#2a6fae', '#3f3aa6', '#2d9bb0', '#5a3fa0')]
ACC_ROCK = [hex2rgb(c) for c in ('#4a2f8f', '#6b3f8a', '#2e4f8e', '#a3567f')]

skym = np.clip(1 - water - head - far, 0, 1)
sky_clip = cv2.dilate(skym, np.ones((int(12 * k), int(12 * k)), np.uint8))
cv.layer(skym * (1 - warm * 0.6), math.radians(-12), 260, 44, density=1.2, accents=ACC_SKY, accent_p=0.15,
         clip=sky_clip, thick=1.0, curve=0.25, angle_jitter=0.07)
cv.layer(skym * warm, math.radians(-4), 220, 30, density=1.4, accents=ACC_WARM, accent_p=0.2, clip=sky_clip,
         thick=1.0, curve=0.2, angle_jitter=0.05)
cv.layer(skym * barm, math.radians(-3), 150, 16, density=1.2, accents=ACC_WARM, accent_p=0.15, clip=sky_clip,
         thick=1.1, angle_jitter=0.04)
# Rays of the beam, laid radially from the lantern.
ray = ang + 0.0
cv.layer(np.clip(beam * 1.4, 0, 1) * skym * smooth(60 * k, 140 * k, dist), ray, 200, 22, density=1.3, clip=sky_clip, thick=1.0, curve=0.05,
         angle_jitter=0.015, pickup=0.3)
cv.layer(far, 0.0, 90, 14, density=1.5, thick=1.0, angle_jitter=0.03)
cv.layer(water, 0.0, 170, 22, density=1.3, accents=ACC_SEA, accent_p=0.16, thick=1.0, curve=0.15,
         angle_jitter=0.03)
cv.layer(water * (0.4 + depth), 0.0, 110, 14, density=1.0, accents=ACC_SEA, accent_p=0.12, thick=1.1,
         curve=0.15, angle_jitter=0.03, sample_blur=2)
head_ang = slope_angle(zh, 5 * k) * 0.25 + math.radians(82) * 0.75
cv.layer(head, head_ang, 90, 26, density=1.5, accents=ACC_ROCK, accent_p=0.18, thick=1.5, ragged=0.6, curve=0.2)
cv.layer(head * grass, math.radians(-75), 30, 6, density=1.6, thick=1.2, angle_jitter=0.3, ragged=0.4,
         sample_blur=2)
cv.layer(head, head_ang, 46, 13, density=0.9, accents=ACC_ROCK, accent_p=0.12, thick=1.6, ragged=0.6, sample_blur=2)
cv.layer(fr, math.radians(40), 70, 22, density=1.6, accents=ACC_ROCK, accent_p=0.15, thick=1.6, ragged=0.6)
cv.layer(np.clip(foam * 2, 0, 1), 0.0, 70, 14, density=0.55, clip=False, thick=1.8, angle_jitter=0.25,
         sample_blur=1, opacity=0.8, curve=0.7, size_jitter=0.6)
cv.target = target
cv.inlay(np.clip(lh + house + roof, 0, 1), thick=1.3)
cv.layer(tower, math.radians(90), 18, 6, density=2.0, thick=1.2, sample_blur=0.8, angle_jitter=0.05)
cv.layer(house + roof, 0.0, 16, 5, density=1.4, thick=1.2, sample_blur=0.8)
cv.inlay(np.clip(win + glass, 0, 1), thick=1.6)

img = cv.finish()
# Lamplight blooms over the paint.
bloom = np.clip(lamp * 0.6 + beam * 0.18 + lit_glow * 0.3, 0, 1)[..., None]
img = np.clip(img + bloom * hex2rgb('#ffdca0') * 0.6, 0, 1)
save(img, f'out/lighthouse_{W}.jpg')
print('done')
