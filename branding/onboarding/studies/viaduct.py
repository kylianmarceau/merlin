"""Scene D: The Night Train.

A lit train crosses a stone viaduct over a snowbound valley. Steam rolls back
along the carriages under a crescent moon; a village glows far below.
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


def R(pts):
    return [(px * k, py * k) for px, py in pts]


MOON = (1270 * k, 170 * k, 46 * k)
DECK = 540                       # top of the parapet, in 1600-wide units

# ---------------------------------------------------------------- sky and moon
sky = gradient_v(S, [(0, '#0d0b40'), (0.25, '#1d1a7a'), (0.45, '#302fa0'), (0.6, '#4a5cbc'), (0.7, '#6d7fc8')])
veil = fbm(S, 41, scale=300 * k, octaves=3, aspect=3.0)
sky = lerp(sky, hex2rgb('#4a2896'), smooth(0.6, 0.9, veil) * 0.45)
mr = radial(S, *MOON)
sky = lerp(sky, hex2rgb('#8d8ad8'), np.exp(-(mr - 1).clip(0) / 2.4) * 0.45)
inner = radial(S, MOON[0] - 20 * k, MOON[1] - 10 * k, MOON[2] * 0.92)
crescent = np.clip((1 - mr) * MOON[2] * 0.7, 0, 1) * np.clip((inner - 1) * MOON[2] * 0.7, 0, 1)
target = lerp(sky, hex2rgb('#fff1cf'), crescent)

# ---------------------------------------------------------------- far range
far_line = ridge_line(W, 91, 470 * k, 150 * k, scale=520 * k, octaves=5)
far_line = np.clip(far_line, 250 * k, 700 * k)
far = below(S, far_line)
zf = -(y - far_line[None, :]) * 0.8 + 110 * k * fbm(S, 92, scale=220 * k, octaves=3)
fl, _ = shade_terrain(zf, (0.8, -0.35, 0.5), blur=3 * k)
fl = 0.6 * fl + 0.4 * np.round(fl * 5) / 5
fcol = lerp(hex2rgb('#1a1c66'), hex2rgb('#383a9a'), fl)
fcol = lerp(fcol, lerp(hex2rgb('#8890d8'), hex2rgb('#eae6f6'), smooth(0.6, 1, fl)), smooth(0.4, 0.55, fl))
fcol = lerp(fcol, hex2rgb('#5a64bf'), smooth(420 * k, 640 * k, y) * 0.45)
target = lerp(target, fcol, far)

# ---------------------------------------------------------------- valley floor
valley_top = 660 * k + 30 * k * np.sin(X / (300 * k))
valley = below(S, valley_top)
vz = 60 * k * fbm(S, 93, scale=160 * k, octaves=4)
vl, _ = shade_terrain(vz - y * 0.1, (0.7, -0.5, 0.6), blur=3 * k)
vcol = lerp(hex2rgb('#161c5e'), hex2rgb('#4f5cb0'), vl)
vcol = lerp(vcol, hex2rgb('#2a2c80'), smooth(0.55, 0.8, fbm(S, 94, scale=50 * k, octaves=3)) * 0.6)
target = lerp(target, vcol, valley)
# Village: warm windows scattered in a hollow, lower left.
rng = np.random.default_rng(12)
lights = np.zeros(S, np.float32)
for _ in range(70):
    lx = rng.normal(820, 170) * k
    ly = rng.normal(870, 34) * k
    lights += np.exp(-(((x - lx) / (4.2 * k)) ** 2 + ((y - ly) / (3.4 * k)) ** 2)) * rng.uniform(0.7, 1.2)
lights = np.clip(lights, 0, 1)
target = lerp(target, hex2rgb('#ffbf5a'), lights)
village_glow = cv2.GaussianBlur(lights, (0, 0), 30 * k) * 14

# ---------------------------------------------------------------- side slopes the viaduct springs from
lslope = poly_mask(S, R([(0, 1000), (0, 520), (60, 530), (140, 560), (220, 610), (300, 690), (360, 760), (420, 860), (480, 1000)]))
rslope = poly_mask(S, R([(1600, 1000), (1600, 500), (1540, 512), (1460, 545), (1380, 600), (1300, 680), (1240, 780), (1200, 1000)]))
slopes = np.clip(lslope + rslope, 0, 1)
sz = 120 * k * fbm(S, 95, scale=140 * k, octaves=4) + np.where(x < W / 2, -x, x) * 0.4
sl, _ = shade_terrain(sz, (0.8, -0.5, 0.4), blur=3 * k)
scol = lerp(hex2rgb('#0f0f38'), hex2rgb('#2c3080'), sl)
scol = lerp(scol, lerp(hex2rgb('#5862b4'), hex2rgb('#aeb6e6'), smooth(0.7, 1, sl)), smooth(0.62, 0.8, sl) * 0.75)
target = lerp(target, scol, slopes)

# ---------------------------------------------------------------- viaduct
deck = poly_mask(S, R([(0, DECK), (1600, DECK - 10), (1600, DECK + 34), (0, DECK + 44)]))
piers = np.zeros(S, np.float32)
openings = np.zeros(S, np.float32)
span = 150
for i in range(-1, 12):
    cx = 80 + i * span
    top = DECK + 40
    bottom = 1000
    piers = np.maximum(piers, poly_mask(S, R([(cx - span / 2, top), (cx + span / 2, top), (cx + span / 2, bottom), (cx - span / 2, bottom)])))
    # The arch: a round head on straight legs.
    r = span * 0.36
    ox = cx
    oy = top + r + 18
    arch = np.clip((1 - radial(S, ox * k, oy * k, r * k)) * r * k, 0, 1)
    legs = poly_mask(S, R([(ox - r, oy), (ox + r, oy), (ox + r * 1.02, bottom), (ox - r * 1.02, bottom)]))
    openings = np.maximum(openings, np.maximum(arch, legs))
via = np.clip(deck + piers * (1 - openings), 0, 1)
via *= 1 - np.clip(slopes * (y > (DECK + 44) * k), 0, 1)   # piers disappear into the slopes
vz = 30 * k * fbm(S, 96, scale=26 * k, octaves=3)
stone_l, _ = shade_terrain(vz, (0.7, -0.4, 0.6), blur=1 * k)
course = (np.sin(y / (9 * k) * math.pi) > 0.82).astype(np.float32) * 0.25
stone = lerp(hex2rgb('#15123a'), hex2rgb('#3a3276'), stone_l * 0.8 + 0.2)
stone = lerp(stone, hex2rgb('#1d1a4a'), course)
# Moonlight from the right brightens the right edge of each pier.
pier_lit = np.zeros(S, np.float32)
for i in range(-1, 12):
    cx = (80 + i * span) * k
    pier_lit = np.maximum(pier_lit, smooth(cx + span * 0.36 * k, cx + span * 0.5 * k, x) * (x < cx + span * 0.5 * k))
stone = lerp(stone, hex2rgb('#b8b0e6'), pier_lit * 0.45)
deck_top = np.exp(-((y - (DECK - 10 * X[None, :] / W / k * k) * k) / (3 * k)) ** 2)
stone = lerp(stone, hex2rgb('#efe8fb'), deck_top * 0.7)  # snow on the parapet
target = lerp(target, stone, via)

# ---------------------------------------------------------------- train
def deck_y(px):
    return DECK - 10 * px / 1600


train = np.zeros(S, np.float32)
tcol = np.zeros(S + (3,), np.float32)
win = np.zeros(S, np.float32)
cars = [(340, 470, '#7a2a3a'), (478, 608, '#7a2a3a'), (616, 746, '#7a2a3a'), (754, 884, '#7a2a3a')]
for x0, x1, c in cars:
    b = deck_y((x0 + x1) / 2)
    body = poly_mask(S, R([(x0, b), (x1, b), (x1, b - 46), (x0, b - 46)]))
    roofm = poly_mask(S, R([(x0 + 2, b - 44), (x1 - 2, b - 44), (x1 - 10, b - 54), (x0 + 10, b - 54)]))
    w = np.zeros(S, np.float32)
    for wx in range(x0 + 12, x1 - 14, 20):
        w = np.maximum(w, poly_mask(S, R([(wx, b - 36), (wx + 12, b - 36), (wx + 12, b - 20), (wx, b - 20)])))
    m = np.clip(body + roofm, 0, 1)
    col = lerp(np.broadcast_to(hex2rgb(c), S + (3,)), hex2rgb('#d9d2f0'), roofm)
    col = lerp(col, hex2rgb('#3a1424'), smooth(x0 * k, x1 * k, x) * 0.3)
    tcol = lerp(tcol, col, m)
    train = np.maximum(train, m)
    win = np.maximum(win, w)
# Locomotive.
lx0, lx1 = 892, 1060
b = deck_y((lx0 + lx1) / 2)
loco = np.clip(poly_mask(S, R([(lx0, b), (lx1, b), (lx1 + 14, b - 6), (lx1, b - 40), (lx0 + 50, b - 40), (lx0 + 50, b - 64), (lx0, b - 64)]))
               + poly_mask(S, R([(lx1 - 40, b - 40), (lx1 - 26, b - 40), (lx1 - 24, b - 64), (lx1 - 42, b - 64)])), 0, 1)
lcol = lerp(np.broadcast_to(hex2rgb('#1c2a4a'), S + (3,)), hex2rgb('#8a9ad0'), smooth(b * k - 40 * k, b * k - 30 * k, y) * 0 + smooth(lx0 * k, lx1 * k, x) * 0.35)
cab_w = poly_mask(S, R([(lx0 + 12, b - 56), (lx0 + 34, b - 56), (lx0 + 34, b - 40), (lx0 + 12, b - 40)]))
tcol = lerp(tcol, lcol, loco)
train = np.maximum(train, loco)
win = np.maximum(win, cab_w)
tcol = lerp(tcol, hex2rgb('#ffc964'), win)
target = lerp(target, tcol, train)
# Headlamp and its beam ahead along the parapet.
HX, HY = (lx1 + 10) * k, (b - 22) * k
ha = np.arctan2(y - HY, x - HX)
hd = np.hypot(x - HX, y - HY)
headbeam = np.exp(-((ha - math.radians(-1)) / 0.07) ** 2) * (x > HX) * np.exp(-hd / (380 * k))
lamp = np.exp(-(hd / (14 * k)) ** 2)
target = lerp(target, hex2rgb('#fff2c8'), np.clip(headbeam * 0.55 + lamp, 0, 1))
win_glow = cv2.GaussianBlur(win, (0, 0), 10 * k) * 2.5

# Steam: a rolling plume from the chimney, trailing back over the carriages.
t = np.linspace(0, 1, 60)
plume = np.zeros(S, np.float32)
for i, tt in enumerate(t):
    px = (lx1 - 33) - tt * 620
    py = (b - 70) - 90 * tt ** 0.6 + 10 * math.sin(tt * 14)
    pr = 16 + 70 * tt
    plume = np.maximum(plume, np.clip(1.3 - radial(S, px * k, py * k, pr * k, 0.75), 0, 1) * (1 - 0.5 * tt))
plume = np.clip(plume * (0.55 + 0.6 * fbm(S, 97, scale=40 * k, octaves=3)), 0, 1)
pl, _ = shade_terrain(plume * 80 * k, (0.7, -0.6, 0.4), blur=4 * k)
pcol = lerp(hex2rgb('#6a68b8'), hex2rgb('#f1ebfb'), pl)
pcol = lerp(pcol, hex2rgb('#ffd8a6'), cv2.GaussianBlur(win, (0, 0), 30 * k) * 3 * 0.4)
no_fx = target.copy()
target = lerp(target, pcol, smooth(0.15, 0.6, plume))
steam = smooth(0.15, 0.6, plume)

# ---------------------------------------------------------------- foreground pines
def pine(cx, base, height, width, seed):
    rng = np.random.default_rng(seed)
    pts_l, pts_r = [], []
    tiers = int(height / 22) + 4
    for i in range(tiers + 1):
        tt = i / tiers
        yy = base - height * tt
        wv = width * (1 - tt) ** 1.1 * (0.7 + 0.3 * rng.random())
        pts_l += [(cx - wv, yy), (cx - wv * 0.45, yy - height / tiers * 0.45)]
        pts_r += [(cx + wv * (0.9 + 0.2 * rng.random()), yy), (cx + wv * 0.45, yy - height / tiers * 0.45)]
    pts = [(cx - 4, base + 30)] + pts_l + [(cx, base - height - 10)] + pts_r[::-1] + [(cx + 4, base + 30)]
    return poly_mask(S, R(pts))


trees = np.zeros(S, np.float32)
for i, (cx, bb, h, w) in enumerate([(60, 1010, 420, 80), (170, 1020, 300, 60), (1500, 1010, 460, 86),
                                    (1400, 1020, 300, 60), (1580, 1000, 260, 50)]):
    trees = np.maximum(trees, pine(cx, bb, h, w, 700 + i))
snowcap = np.clip(trees - np.roll(trees, int(4 * k) + 1, axis=0), 0, 1)
treecol = lerp(hex2rgb('#090a24'), hex2rgb('#1d2a52'), smooth(0.5, 0.9, fbm(S, 98, scale=40 * k, octaves=2)))
treecol = lerp(treecol, hex2rgb('#dfe2f7'), snowcap * 0.9)
pre_trees = target.copy()
target = lerp(target, treecol, trees)

# ---------------------------------------------------------------- strokes
cv = Canvas(no_fx, seed=31)
ACC_SKY = [hex2rgb(c) for c in ('#4a2896', '#1f2f9a', '#2a5f9a', '#5a3fa8')]
ACC_MTN = [hex2rgb(c) for c in ('#3a3a9e', '#2a5f9e', '#5a4fa8')]
ACC_SNOW = [hex2rgb(c) for c in ('#9aa4e6', '#c8b8ee', '#6f7fd0')]

skym = np.clip(1 - far - valley - slopes - via, 0, 1)
sky_clip = cv2.dilate(skym, np.ones((int(12 * k), int(12 * k)), np.uint8))
cv.layer(skym, math.radians(-16), 240, 42, density=1.2, accents=ACC_SKY, accent_p=0.14, clip=sky_clip,
         thick=0.9, curve=0.3, angle_jitter=0.08)
cv.inlay(crescent, thick=1.3)
f_ang = slope_angle(zf, 5 * k)
cv.layer(far, f_ang, 66, 20, density=1.5, accents=ACC_MTN, accent_p=0.12, thick=1.3, ragged=0.5, curve=0.15)
cv.layer(far, f_ang, 34, 10, density=0.9, accents=ACC_MTN, accent_p=0.1, thick=1.4, ragged=0.5, sample_blur=2)
cv.layer(valley, math.radians(4), 110, 22, density=1.4, accents=ACC_SNOW, accent_p=0.12, thick=1.2, curve=0.4,
         angle_jitter=0.1)
s_ang = slope_angle(sz, 5 * k)
cv.layer(slopes, s_ang, 56, 16, density=1.5, accents=ACC_MTN, accent_p=0.12, thick=1.4, ragged=0.5)
cv.inlay(via, thick=1.1)
cv.layer(via, 0.0, 22, 7, density=1.6, thick=1.3, angle_jitter=0.05, sample_blur=0.8, ragged=0.5)
cv.inlay(lights, thick=1.4)
cv.target = target
cv.inlay(train, thick=1.2)
cv.layer(train * (1 - win), 0.0, 18, 6, density=1.2, thick=1.2, sample_blur=0.8)
cv.inlay(win, thick=1.5)
cv.inlay(steam * 0.0, thick=0)
cv.target = target
cv.layer(steam, math.radians(-160), 46, 16, density=2.4, clip=True, thick=1.4, curve=0.9, angle_jitter=0.6,
         sample_blur=2, ragged=0.5)
cv.inlay(trees, thick=1.0)
cv.layer(trees, math.radians(-160), 24, 6, density=1.5, thick=1.4, angle_jitter=0.35, sample_blur=1, ragged=0.6)

img = cv.finish()
glow = np.clip(win_glow * 0.25 + village_glow * 0.12 + headbeam * 0.35 + lamp * 0.6, 0, 1)
img = np.clip(img + glow[..., None] * hex2rgb('#ffcf8a') * 0.55, 0, 1)
rng = np.random.default_rng(5)
for _ in range(200):
    sx, sy = int(rng.random() * W), int(rng.random() * 450 * k)
    if skym[sy, sx] > 0.9 and mr[sy, sx] > 1.6:
        r = max(1, int(rng.uniform(0.6, 1.8) * k + 0.5))
        bb = rng.uniform(0.4, 1.0)
        cv2.circle(img, (sx, sy), r, tuple(float(c) for c in (img[sy, sx] * (1 - bb) + np.array([0.92, 0.93, 1.0]) * bb)), -1, cv2.LINE_AA)
save(img, f'out/viaduct_{W}.jpg')
print('done')
