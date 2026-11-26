"""Scene A, round two: Eyrie.

The merlin on its crag above a sea of cloud, repainted in the calmer
round-two manner: a big open sky, soft cloud banks with mist between them,
fewer and gentler peaks. Night has the moon rising in the saddle; dawn has
the sun coming up in the same place.

    python eyrie2.py 1600 night|dawn
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
X1 = X / k
N = TONE == 'night'

P = dict(
    night=dict(sky=[(0, '#100d4a'), (0.25, '#211f86'), (0.45, '#3a42ae'), (0.56, '#5878c4'), (0.62, '#7ea6d2')],
               veil='#4a2a9a', orb=(560, 395, 58), orb_col='#fff3d8', halo='#a9a2e6',
               peak_sh='#24267a', peak_lit='#c9cdf0', peak_glow='#f0d8c8',
               cloud_sh='#3a3c9c', cloud_lit='#b9b4ec', crown='#f6e8d0', mist='#8d90d8',
               rock_sh='#120f30', rock_lit='#3a2f78', rock_snow='#c9cff2', rim='#efe0c8'),
    dawn=dict(sky=[(0, '#5f6cc4'), (0.25, '#8f8fd8'), (0.42, '#d6a4cc'), (0.53, '#f6b6a2'), (0.6, '#fdd8a8')],
              veil='#b28ad8', orb=(560, 470, 46), orb_col='#ffe9a8', halo='#ffb98a',
              peak_sh='#6a5fae', peak_lit='#ffd6c4', peak_glow='#ffc2a0',
              cloud_sh='#8a82c8', cloud_lit='#f4c6c8', crown='#fff0d8', mist='#f0c8cc',
              rock_sh='#2c1f48', rock_lit='#7a4f86', rock_snow='#f6d6d0', rim='#ffd0a0'),
)[TONE]

OX, OY, OR = (v * k for v in P['orb'])

# ---------------------------------------------------------------- sky
sky = gradient_v(S, P['sky'])
veil = fbm(S, 3, scale=340 * k, octaves=3, aspect=3.2)
veil = cv2.warpAffine(veil, cv2.getRotationMatrix2D((W / 2, H / 2), 14, 1.0), (W, H), borderMode=cv2.BORDER_REFLECT)
sky = lerp(sky, hex2rgb(P['veil']), smooth(0.62, 0.9, veil) * 0.35)
orb_r = radial(S, OX, OY, OR)
halo = np.exp(-((orb_r - 1).clip(0) / 3.4))
sky = lerp(sky, hex2rgb(P['halo']), halo * 0.55)
sky = lerp(sky, hex2rgb(P['orb_col']), np.exp(-((orb_r - 1).clip(0) / 0.7)) * 0.45)
disc = np.clip((1 - orb_r) * OR * 0.7, 0, 1)
target = sky.copy()

# ---------------------------------------------------------------- far peaks, sunk in cloud
def atri(c, wl, wr, p=1.3):
    d = np.where(X1 < c, (c - X1) / wl, (X1 - c) / wr)
    return np.clip(1 - d, 0, 1) ** p


# Lopsided summits with shoulders, so no peak reads as a pyramid.
peaks = 700 - np.maximum.reduce([
    330 * atri(240, 190, 330, 1.5), 250 * atri(330, 120, 160, 1.1), 210 * atri(470, 150, 240, 1.4),
    290 * atri(930, 300, 200, 1.6), 220 * atri(1010, 120, 150, 1.0), 180 * atri(1120, 160, 260, 1.3),
    140 * atri(1480, 260, 200, 1.2)])
peaks += (noise1d(W, 21, step=12 * k) - 0.5) * 34 * np.clip((700 - peaks) / 200, 0, 1)
peaks += (noise1d(W, 24, step=4 * k) - 0.5) * 10 * np.clip((700 - peaks) / 200, 0, 1)
pk_line = peaks * k
far = below(S, pk_line)
fold = np.sin((X1[None, :] - 900) / 34 + 3 * fbm(S, 22, scale=110 * k, octaves=2)) * 18 * k
zf = -(y - pk_line[None, :]) * 0.9 + fold + 60 * k * fbm(S, 23, scale=160 * k, octaves=3)
lit, _ = shade_terrain(zf, (-0.8, -0.3, 0.5), blur=4 * k)
lit = 0.6 * lit + 0.4 * np.round(lit * 4) / 4
pcol = lerp(hex2rgb(P['peak_sh']), hex2rgb(P['peak_lit']), smooth(0.25, 0.85, lit))
toward = np.exp(-((x - OX) / (420 * k)) ** 2)
pcol = lerp(pcol, hex2rgb(P['peak_glow']), smooth(0.7, 1, lit) * toward * 0.6)
pcol = lerp(pcol, sky, smooth(420 * k, 640 * k, y) * 0.35)
target = lerp(target, pcol, far)

# ---------------------------------------------------------------- sea of cloud
clouds = np.zeros(S, np.float32)
rows = [(620, 22, 210), (680, 34, 300), (770, 46, 420), (890, 60, 560)]
for i, (base, amp, period) in enumerate(rows):
    base, amp, period = base * k, amp * k, period * k
    ph = noise1d(W, 80 + i, step=period * 0.8) * period * 1.5
    billow = np.abs(np.sin((X + ph) * math.pi / period)) ** 0.8
    top = base - amp * billow - 14 * k * (noise1d(W, 90 + i, step=60 * k) - 0.5)
    m = smooth(-2 * k, 2 * k, y - top[None, :])
    into = np.clip((y - top[None, :]) / (amp * 2.2 + 40 * k), 0, 1)
    col = lerp(hex2rgb(P['cloud_lit']), hex2rgb(P['cloud_sh']), smooth(0.0, 1.0, into))
    path = np.exp(-((x - OX) / (90 * k + 0.5 * (base - 600 * k))) ** 2)
    col = lerp(col, hex2rgb(P['crown']), (path * 0.9 + 0.25) * smooth(0.45, 0.0, into))
    # Each bank fades into the mist rising from the one in front.
    col = lerp(col, hex2rgb(P['mist']), smooth(0.5, 1.0, into) * 0.5)
    target = lerp(target, col, m)
    clouds = np.maximum(clouds, m)
mistband = np.zeros(S, np.float32)
for i, (base, amp, period) in enumerate(rows[1:], 1):
    yb = (base - amp * 0.4) * k
    mistband = np.maximum(mistband, np.exp(-((y - yb) / (26 * k)) ** 2) * (0.5 + 0.5 * fbm(S, 95 + i, scale=200 * k, octaves=3, aspect=5)))
target = lerp(target, hex2rgb(P['mist']), mistband * 0.35 * clouds)

# ---------------------------------------------------------------- crag
crag_pts = [(1600, 1000), (1010, 1000), (1050, 950), (1090, 880), (1130, 800), (1165, 730), (1190, 680),
            (1214, 656), (1300, 652), (1330, 630), (1362, 598), (1410, 584), (1460, 552), (1530, 528), (1600, 512)]
crag = poly_mask(S, scaled(crag_pts, k))
zr = 140 * k * fbm(S, 62, scale=220 * k, octaves=3) + x * 0.3
rl, _ = shade_terrain(zr, (-0.85, -0.35, 0.4), blur=4 * k)
rl = 0.6 * rl + 0.4 * np.round(rl * 4) / 4
rock = lerp(hex2rgb(P['rock_sh']), hex2rgb(P['rock_lit']), rl)
ledges = smooth(0.74, 0.86, rl) * smooth(0.5, 0.68, fbm(S, 64, scale=110 * k, octaves=3))
rock = lerp(rock, hex2rgb(P['rock_snow']), ledges * 0.85)
rim = np.clip(crag - cv2.erode(crag, np.ones((int(7 * k) + 2, int(7 * k) + 2), np.uint8)), 0, 1)
rock = lerp(rock, hex2rgb(P['rim']), rim * 0.75 * smooth(1600 * k, 1100 * k, x))
target = lerp(target, rock, crag)

# ---------------------------------------------------------------- the merlin
FX, FY, FS = 1255 * k, 653 * k, 1.75 * k
LEAN = math.radians(13)


def B(pts):
    c, sn = math.cos(LEAN), math.sin(LEAN)
    return [(FX + (px * c + py * sn) * FS, FY + (-px * sn + py * c) * FS) for px, py in pts]


bird_pts = [(-1, -100), (-8, -98), (-12, -95), (-15, -93), (-20, -91), (-22, -88), (-21.5, -85), (-19.5, -85.5),
            (-15, -86), (-11, -83), (-14, -76), (-17, -64), (-18, -50), (-16, -36), (-12, -24), (-7, -14),
            (-6, -6), (-10, -1), (-2, 0), (5, -3), (8, 0), (11, 14), (14, 30), (16, 48), (21, 49), (21, 32),
            (20, 16), (22, 10), (24, 0), (27, -18), (27, -38), (24, -56), (17, -70), (10, -80), (6, -88), (3, -96)]
bird = poly_mask(S, B(bird_pts))
lit_side = smooth(FX, FX - 30 * FS, x)
bird_rim = np.clip(bird - cv2.erode(bird, np.ones((int(4 * k) + 2, int(4 * k) + 2), np.uint8)), 0, 1)
body = '#1d1a3c' if N else '#2c2140'
bird_col = np.broadcast_to(hex2rgb(body), S + (3,)).astype(np.float32)
chest = poly_mask(S, B([(-11, -83), (-14, -76), (-17, -64), (-18, -50), (-16, -36), (-12, -24), (-7, -14),
                        (-1, -16), (1, -36), (-1, -60), (-4, -78)]))
streaks = smooth(0.5, 0.75, fbm(S, 66, scale=5 * FS, octaves=2, aspect=0.35))
chest_col = lerp(hex2rgb('#5d5384' if N else '#8a5a6a'), hex2rgb('#3a3160' if N else '#4a3048'), streaks)
bird_col = lerp(bird_col, chest_col, chest * 0.85)
wing = poly_mask(S, B([(8, -82), (15, -70), (22, -54), (25, -34), (25, -12), (23, 4), (22, 10), (16, -8), (9, -38), (3, -64)]))
coverts = smooth(0.45, 0.7, fbm(S, 67, scale=8 * FS, octaves=2, aspect=0.6))
bird_col = lerp(bird_col, lerp(hex2rgb('#2e3466' if N else '#3e3560'), hex2rgb('#46508a' if N else '#5f5888'), coverts), wing)
tache = poly_mask(S, B([(-10, -90), (-6, -90), (-7, -80), (-10, -79)]))
bird_col = lerp(bird_col, hex2rgb('#110f24'), tache)
beak = poly_mask(S, B([(-15, -93), (-20, -91), (-22, -88), (-21.5, -85), (-19.5, -85.5), (-15, -87)]))
bird_col = lerp(bird_col, hex2rgb('#6b6f8e'), beak)
cere = poly_mask(S, B([(-13, -94), (-16, -93.5), (-16, -89), (-13, -89)]))
bird_col = lerp(bird_col, hex2rgb('#d9a83a'), cere * 0.8)
bird_col = lerp(bird_col, hex2rgb(P['rim']), bird_rim * lit_side * 0.95)
ex, ey = B([(-8, -92)])[0]
eye_r = np.hypot(x - ex, y - ey) / FS
bird_col = lerp(bird_col, hex2rgb('#e0b040'), smooth(2.4, 1.9, eye_r))
bird_col = lerp(bird_col, hex2rgb('#0b0a14'), smooth(1.5, 1.0, eye_r))
gx_, gy_ = B([(-8.6, -92.6)])[0]
bird_col = lerp(bird_col, hex2rgb('#ffffff'), smooth(0.6, 0.2, np.hypot(x - gx_, y - gy_) / FS))
no_bird = target.copy()
target = lerp(target, bird_col, bird)

# ---------------------------------------------------------------- strokes
cv = Canvas(no_bird, seed=7)
ACC_SKY = [hex2rgb(c) for c in (('#4a2a9a', '#2f43c0', '#3a7fb5') if N else ('#c7a6e6', '#f3c1b8', '#a7b4ec', '#ffd8b0'))]
ACC_PK = [hex2rgb(c) for c in (('#3a3a9e', '#6a6fd0', '#2a5f9e') if N else ('#f6b8a8', '#a898e0', '#ffd8c0'))]
ACC_CL = [hex2rgb(c) for c in (('#6a5fc8', '#8a9ae0', '#c8c0f0') if N else ('#f6c8c0', '#c8b0e8', '#ffe0c8'))]
ACC_RK = [hex2rgb(c) for c in (('#2f2470', '#4a2f8a', '#1f2f6a') if N else ('#5a3a6e', '#8a4f7a', '#3a2a5a'))]

skym = np.clip(1 - far - clouds - crag, 0, 1)
sky_clip = cv2.dilate(skym, np.ones((int(12 * k), int(12 * k)), np.uint8)) * (orb_r > 1.0)
cv.layer(skym, math.radians(-14), 190, 34, density=1.2, accents=ACC_SKY, accent_p=0.14, clip=sky_clip,
         thick=0.8, curve=0.3, angle_jitter=0.08)
cv.layer(skym, math.radians(-12), 90, 18, density=0.7, accents=ACC_SKY, accent_p=0.1, clip=sky_clip,
         thick=0.8, curve=0.3, angle_jitter=0.1, sample_blur=2)
cv.inlay(np.clip((1 - orb_r) * OR, 0, 1) * (1 - far), thick=1.0)
orb_ang = np.arctan2(y - OY, x - OX) + math.pi / 2
cv.layer(disc * (1 - far), orb_ang, 34, 16, density=0.6, clip=np.clip((1 - orb_r) * OR * 0.5, 0, 1) * (1 - far),
         thick=0.9, sample_blur=4, streak=0.015)
p_ang = slope_angle(zf, 6 * k)
cv.layer(far, p_ang, 64, 18, density=1.4, accents=ACC_PK, accent_p=0.1, thick=1.1, ragged=0.5, curve=0.15)
cv.layer(far, p_ang, 32, 9, density=0.8, accents=ACC_PK, accent_p=0.08, thick=1.2, ragged=0.5, sample_blur=2)
cv.layer(clouds, 0.0, 170, 30, density=1.3, accents=ACC_CL, accent_p=0.1, thick=0.9, curve=0.5, angle_jitter=0.05)
cv.layer(clouds, 0.0, 90, 16, density=0.9, accents=ACC_CL, accent_p=0.08, thick=1.0, curve=0.6, angle_jitter=0.06,
         sample_blur=2)
crag_ang = slope_angle(zr, 6 * k) * 0.4 + math.radians(65) * 0.6
cv.layer(crag, crag_ang, 80, 24, density=1.4, accents=ACC_RK, accent_p=0.14, thick=1.3, ragged=0.6, curve=0.2)
cv.layer(crag, crag_ang, 40, 12, density=0.9, accents=ACC_RK, accent_p=0.1, thick=1.4, ragged=0.6, sample_blur=2)
cv.target = target
cv.inlay(bird, thick=1.2)
cv.layer(bird * (1 - bird_rim) * (1 - smooth(3.5, 2.5, eye_r)), math.radians(84), 14 * FS / k, 3.5 * FS / k,
         density=1.4, thick=1.3, sample_blur=0.6, angle_jitter=0.12, curve=0.2)
cv.inlay(bird_rim * lit_side, thick=1.5)
img = cv.finish(relief=0.5)
img = np.clip(img + halo[..., None] * hex2rgb(P['halo']) * (0.1 if N else 0.2), 0, 1)
img = lerp(img, hex2rgb(P['orb_col']), np.clip((1 - orb_r) * OR * 0.6, 0, 1) * (1 - far) * (0.55 if N else 0.9))
if N:
    sprinkle_stars(img, skym * (orb_r > 4), k, 220, 9, top=0.55)
img = paper(img, k, 7, 0.04)
save(img, f'out/eyrie2_{TONE}_{W}.jpg')
print('done')
