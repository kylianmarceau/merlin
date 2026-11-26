"""Heather Moor, painted as layers for the film.

  sky      sky, halo and sun (no clouds)
  clouds   the cloud banks, on a wide canvas so they can drift
  ridge0-3 the ridges, far to near, each with alpha (the film lays the mist)
  tree     the hawthorn, with alpha, so it can sway
  fg       the heather and the wall, with alpha

    python moor_layers.py 1800 dawn|morning
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
TONE = sys.argv[2] if len(sys.argv) > 2 else 'dawn'
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)
D = TONE == 'dawn'
EXTRA = int(320 * k)
WW = W + EXTRA

P = dict(
    dawn=dict(sky=[(0, '#5d5fb8'), (0.22, '#8e86cf'), (0.42, '#d9a3c3'), (0.55, '#f6b8a0'), (0.62, '#fdd9a3')],
              sun=(1010, 540, 40), sun_col='#fff0c8', halo='#ffd29a',
              far='#b29ad0', near='#4f3f7e', mist='#fbd6c4', mist_amt=1.0,
              heather=('#7d3f8e', '#a84a86', '#6f6a3a', '#9a5838'), heather_lit='#e08a8a',
              wall='#3f3560', wall_lit='#d9a8a0', tree='#2a2140', cloud='#f7c9b8'),
    morning=dict(sky=[(0, '#5f8fda'), (0.25, '#86aee6'), (0.45, '#b7cff0'), (0.6, '#e2ecf6')],
                 sun=(1180, 150, 40), sun_col='#ffeaa8', halo='#fff0bc',
                 far='#9fb6d6', near='#4f6a3a', mist='#f2f4f6', mist_amt=0.45,
                 heather=('#8a4a9e', '#b85a96', '#7a8a3a', '#a8703e'), heather_lit='#f0b0d0',
                 wall='#5a5850', wall_lit='#cfc8b4', tree='#2f3a24', cloud='#ffffff'),
)[TONE]
ACC_SKY = [hex2rgb(c) for c in (('#c79ad8', '#f3b6a8', '#9aa2e6', '#ffd4a8') if D else ('#a8c4ee', '#ffffff', '#8fb0e6'))]
ACC_HEATH = [hex2rgb(c) for c in P['heather']]

sky = gradient_v(S, P['sky'])
SX, SY, SR = (v * k for v in P['sun'])
sd = radial(S, SX, SY, SR)
sky = lerp(sky, hex2rgb(P['halo']), np.exp(-((sd - 1).clip(0) / 4.0)) * 0.55)
disc = np.clip((1 - sd) * SR * 0.7, 0, 1)
skym = (y < 760 * k).astype(np.float32)
cv = Canvas(lerp(sky, hex2rgb(P['sun_col']), disc), seed=81)
cv.layer(skym, math.radians(-8), 180, 34, density=1.2, accents=ACC_SKY, accent_p=0.14, clip=skym,
         thick=0.8, curve=0.35, angle_jitter=0.08)
cv.inlay(disc, thick=1.3)
sky_img = cv.finish(relief=0.5)
sky_img = np.clip(sky_img + np.exp(-((sd - 1).clip(0) / 3.0))[..., None] * hex2rgb(P['halo']) * 0.12, 0, 1)
print('sky', flush=True)

yw, xw = np.mgrid[:H, :WW].astype(np.float32)
cl = fbm((H, WW), 11, scale=180 * k, octaves=4, aspect=3.5)
band = smooth(80 * k, 200 * k, yw) * smooth(520 * k, 330 * k, yw)
clouds = smooth(0.58, 0.75, cl) * band
ccol = np.broadcast_to(hex2rgb(P['cloud']), (H, WW, 3)).astype(np.float32)
if not D:
    shade_c = smooth(0.6, 0.85, fbm((H, WW), 12, scale=60 * k, octaves=3, aspect=2.5))
    ccol = lerp(ccol, hex2rgb('#c8d4e8'), shade_c * 0.6)
sky_w = np.pad(sky_img, ((0, 0), (0, EXTRA), (0, 0)), mode='edge')
cv = Canvas(lerp(sky_w, ccol, clouds * (0.75 if D else 0.9)), seed=82)
cv.k = k
cmask = np.clip(clouds * 2, 0, 1)
cv.layer(cmask, math.radians(-6), 90, 20, density=1.4, accents=ACC_SKY, accent_p=0.1, clip=np.clip(cmask * 1.5, 0, 1),
         thick=0.9, curve=0.6, angle_jitter=0.15, sample_blur=2)
clouds_img = cv.finish(relief=0.5)
cy0, cy1 = int(60 * k), int(540 * k)
print('clouds', flush=True)

ridges = [(575, 26, 600, 61), (612, 36, 520, 62), (660, 44, 460, 63), (735, 60, 520, 64)]
out = {}
lines = []
base = sky_img
for i, (b, amp, scale, seed) in enumerate(ridges):
    line = hills(W, k, b, amp, scale, seed)
    m = below(S, line)
    t = i / (len(ridges) - 1)
    col = lerp(hex2rgb(P['far']), hex2rgb(P['near']), t ** 1.4)
    z = -(y - line[None, :]) * 0.4 + 40 * k * fbm(S, seed + 10, scale=220 * k, octaves=3)
    lit, _ = shade_terrain(z, (0.6, -0.6, 0.6) if D else (0.5, -0.7, 0.6), blur=4 * k)
    col = lerp(col * 0.85, col * 1.18, lit)
    if i == 2:
        col = lerp(col, lerp(hex2rgb(P['heather'][0]), hex2rgb(P['heather'][2]),
                             smooth(0.4, 0.7, fbm(S, 70, scale=90 * k, octaves=3))), 0.45)
    cv = Canvas(lerp(base, col, m), seed=83 + i)
    ang = slope_angle(z, 6 * k) * 0.25
    cv.layer(m, ang, 130 - 15 * i, 26 - 2 * i, density=1.3, thick=0.9 + 0.1 * i, curve=0.3, angle_jitter=0.08,
             accents=ACC_HEATH if i >= 2 else None, accent_p=0.08)
    img = cv.finish(relief=0.5)
    out[f'ridge{i}'] = img
    out[f'ridgea{i}'] = m
    lines.append(line)
    base = lerp(base, img, m)
    print('ridge', i, flush=True)

TX = 470 * k
TY = float(np.interp(TX, X, lines[3])) + 10 * k
trunk = poly_mask(S, [(TX - 6 * k, TY), (TX + 6 * k, TY), (TX + 26 * k, TY - 60 * k), (TX + 50 * k, TY - 78 * k),
                      (TX + 40 * k, TY - 82 * k), (TX + 16 * k, TY - 64 * k)])
crown = np.zeros(S, np.float32)
rng = np.random.default_rng(75)
for _ in range(40):
    u_ = rng.random()
    cx = TX + (10 + 120 * u_ + rng.normal(0, 8)) * k
    cy = TY - (92 - 26 * u_ ** 1.5 + rng.normal(0, 7)) * k
    r = (24 - 12 * u_) * rng.uniform(0.7, 1.1) * k
    crown = np.maximum(crown, np.clip((1 - radial(S, cx, cy, r * 1.5, 0.55)) * 4, 0, 1))
tree = np.clip(trunk + crown, 0, 1)
tcol = lerp(hex2rgb(P['tree']), hex2rgb(P['heather_lit'] if D else '#6f8a4a'), smooth(TX + 60 * k, TX - 10 * k, x) * crown * 0.35)
cv = Canvas(lerp(base, tcol, tree), seed=88)
cv.inlay(tree, thick=1.1)
cv.layer(crown, math.radians(-10), 16, 7, density=1.6, thick=1.4, angle_jitter=0.6, sample_blur=1, ragged=0.6)
out['tree'] = cv.finish(relief=0.5)
out['treea'] = tree
out['treebase'] = np.float32([TX, TY])
print('tree', flush=True)

fg_line = hills(W, k, 820, 70, 900, 66)
fg_line -= 70 * k * np.exp(-((X - 1350 * k) / (350 * k)) ** 2)
fg = below(S, fg_line)
pa = fbm(S, 71, scale=70 * k, octaves=4, aspect=1.8)
pb = fbm(S, 72, scale=40 * k, octaves=3)
h0, h1, h2, h3 = (hex2rgb(c) for c in P['heather'])
heather = lerp(h0, h1, smooth(0.45, 0.7, pb))
heather = lerp(heather, h2, smooth(0.6, 0.8, pa))
heather = lerp(heather, h3, smooth(0.72, 0.88, pb) * (1 - smooth(0.6, 0.8, pa)))
zf = 50 * k * fbm(S, 73, scale=120 * k, octaves=4) - (y - fg_line[None, :]) * 0.2
hl, _ = shade_terrain(zf, (0.7, -0.5, 0.5), blur=3 * k)
heather = heather * (0.7 + 0.5 * hl[..., None])
crest = smooth(fg_line[None, :] + 40 * k, fg_line[None, :], y)
heather = lerp(heather, hex2rgb(P['heather_lit']), crest * 0.45 * (1 if D else 0.6))
wall_pts = [(-20, 965), (200, 900), (420, 842), (640, 800), (820, 772), (980, 752), (1100, 742)]
wall = np.zeros(S, np.float32)
pts = np.array(scaled(wall_pts, k))
for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
    thick = np.interp((x0 + x1) / 2, [0, 1100 * k], [30 * k, 6 * k])
    cv2.line(wall, (int(x0 * 4), int(y0 * 4)), (int(x1 * 4), int(y1 * 4)), 1.0, max(1, int(thick)), cv2.LINE_AA, shift=2)
wall *= fg * smooth(1100 * k, 850 * k, x)
stones = smooth(0.4, 0.6, fbm(S, 74, scale=6 * k, octaves=2))
wcol = lerp(hex2rgb(P['wall']), hex2rgb(P['wall_lit']), stones * 0.6)
wall_top = np.clip(wall - np.roll(wall, int(3 * k) + 1, axis=0), 0, 1)
wcol = lerp(wcol, hex2rgb(P['wall_lit']), wall_top * 0.7)
base_fg = lerp(lerp(base, out['tree'], tree), heather, fg)
cv = Canvas(base_fg, seed=89)
cv.layer(fg, math.radians(-78), 30, 10, density=1.8, accents=ACC_HEATH, accent_p=0.25, thick=1.4, angle_jitter=0.4,
         ragged=0.6, curve=0.4, sample_blur=1.5)
cv.layer(fg * smooth(fg_line[None, :] + 60 * k, H, y), math.radians(-80), 46, 13, density=1.0, accents=ACC_HEATH,
         accent_p=0.3, thick=1.6, angle_jitter=0.45, ragged=0.7, curve=0.5, sample_blur=1.5)
cv.target = lerp(base_fg, wcol, wall)
cv.inlay(wall, thick=1.4)
cv.layer(wall, math.radians(-14), 12, 5, density=2.0, thick=1.5, sample_blur=0.6, ragged=0.6)
fg_img = cv.finish(relief=0.5)
out['fg'] = fg_img
out['fga'] = np.clip(fg, 0, 1)
out['wall'] = wall
print('fg', flush=True)

save_d = {kk: np.float16(v) if v.ndim >= 2 else v for kk, v in out.items()}
np.savez_compressed(f'out/moor_{TONE}_layers.npz', sky=np.float16(sky_img), clouds=np.float16(clouds_img[cy0:cy1]),
                    cloudsa=np.float16(np.clip(clouds[cy0:cy1] * 1.3, 0, 1)), cband=np.int32([cy0, cy1]),
                    lines=np.float32(lines), fgline=np.float32(fg_line), sun=np.float32([SX, SY, SR]),
                    k=np.float32([k]), **save_d)
print('done')
