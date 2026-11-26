"""Scene A: Eyrie at Moonrise.

A merlin keeps watch from a snowy crag above a sea of cloud. The moon rises
between the far peaks and lays a path of light across the cloud tops. The day
version keeps every shape in register and puts the sun where the moon was,
so the two can cross-fade.

    python eyrie.py 1600 night|day
"""
import sys
import math
import numpy as np
import cv2
from impasto import *

W = int(sys.argv[1]) if len(sys.argv) > 1 else 800
TONE = sys.argv[2] if len(sys.argv) > 2 else 'night'
NIGHT = TONE == 'night'
H = W * 10 // 16
k = W / 1600
S = (H, W)
y, x = np.mgrid[:H, :W].astype(np.float32)
X = np.arange(W, dtype=np.float32)

MOON = (640 * k, 330 * k, 66 * k)

C = dict(
    night=dict(sky=[(0, '#0e0b45'), (0.22, '#211d82'), (0.45, '#3940b4'), (0.58, '#4d6fc6'), (0.66, '#6aa2cf')],
               glow='#8c86de', glow2='#d9d0f2', veil_a='#5a2f9e', veil_b='#1c2f9a', orb_a='#fff4da', orb_b='#ead8c2',
               rock_a='#1b1d66', rock_b='#3a3596', snow_a='#8a8fd8', snow_b='#eae4f6', warm='#f3c9b4', haze='#5c63c0',
               rows=[('#5357b8', '#c9c3f1'), ('#4245a8', '#bdb4ee'), ('#33339a', '#ada2e8'), ('#26257e', '#9a8cdc')],
               path='#f6e8cf', path2='#dcd2f5',
               crag_a='#110e30', crag_b='#2f2774', crag_c='#4b2f7f', ledge_a='#7f84d6', ledge_b='#e8eaf9', crag_rim='#cfc6f2',
               left_a='#0f0d2e', left_b='#2c2870', left_snow='#c4c7f3',
               bird='#1d1a3c', chest_a='#5d5384', chest_b='#3a3160', wing_a='#2e3466', wing_b='#46508a',
               tache='#110f24', bird_rim='#f6dfc2', bird_acc=('#3b2e6e', '#251c4a'),
               acc_sky=('#5b2fa3', '#2f43c0', '#3a7fb5', '#6f45b0'), acc_rock=('#4a2f8f', '#2e5f9e', '#6b4fa8', '#9a5f8a'),
               acc_cloud=('#6a5fc8', '#4a74c4', '#a99be8')),
    day=dict(sky=[(0, '#2a5fc0'), (0.22, '#3f7fd6'), (0.45, '#6fa6e4'), (0.58, '#a6caee'), (0.66, '#dfeaf4')],
             glow='#dceaf6', glow2='#fff7e2', veil_a='#7fb2ec', veil_b='#2f62bf', orb_a='#fffef4', orb_b='#fff1c4',
             rock_a='#4a5aa6', rock_b='#7d8fcc', snow_a='#c6d6f2', snow_b='#ffffff', warm='#fff1d8', haze='#b6cae8',
             rows=[('#98aee2', '#ffffff'), ('#8298d6', '#f8faff'), ('#6c82c6', '#eef2fc'), ('#5a6eb8', '#e4eafa')],
             path='#fffaf0', path2='#f6f8fd',
             crag_a='#2e2a48', crag_b='#6a6088', crag_c='#8a6a86', ledge_a='#b8c6ec', ledge_b='#ffffff', crag_rim='#fff2de',
             left_a='#2a2644', left_b='#625a88', left_snow='#eef2fb',
             bird='#34344f', chest_a='#b89a8a', chest_b='#6a4a48', wing_a='#46557e', wing_b='#7384b0',
             tache='#262236', bird_rim='#fff4e2', bird_acc=('#4a5a86', '#3a3a5a'),
             acc_sky=('#4f8fe0', '#2f6fc8', '#8fc0ee', '#6f9ee6'), acc_rock=('#6a6aa8', '#4a7ab8', '#8a7ab8', '#b88a9a'),
             acc_cloud=('#c8d4f0', '#a8bce8', '#ffffff')),
)['night' if NIGHT else 'day']

# ---------------------------------------------------------------- underpainting
sky = gradient_v(S, C['sky'])
mr = radial(S, MOON[0], MOON[1], MOON[2])
glow = np.exp(-(mr - 1).clip(0) / 3.0)
sky = lerp(sky, hex2rgb(C['glow']), glow * 0.5)
sky = lerp(sky, hex2rgb(C['glow2']), np.exp(-(mr - 1).clip(0) / 0.8) * 0.55)
veil = fbm(S, 3, scale=320 * k, octaves=3, aspect=3.0)
veil = cv2.warpAffine(veil, cv2.getRotationMatrix2D((W / 2, H / 2), 20, 1.0), (W, H), borderMode=cv2.BORDER_REFLECT)
sky = lerp(sky, hex2rgb(C['veil_a']), smooth(0.6, 0.9, veil) * 0.6 * (1 - glow))
sky = lerp(sky, hex2rgb(C['veil_b']), smooth(0.45, 0.15, veil) * 0.45)
moon_disc = np.clip((1 - mr) * MOON[2] * 0.7, 0, 1)
moon_tex = fbm(S, 9, scale=40 * k, octaves=2)
moon_col = lerp(hex2rgb(C['orb_a']), hex2rgb(C['orb_b']), smooth(0.55, 0.85, moon_tex))
target = lerp(sky, moon_col, moon_disc)
if not NIGHT:
    # Sunlight: the sky pales and warms as it nears the sun. The disc is a
    # white-hot core that turns pale gold towards its limb.
    sky = lerp(sky, hex2rgb('#e4effa'), np.exp(-(mr - 1).clip(0) / 4.0) * 0.4)
    sky = lerp(sky, hex2rgb('#fbf1d8'), np.exp(-(mr - 1).clip(0) / 0.9) * 0.5)
    sun_col = lerp(hex2rgb('#fffdf0'), hex2rgb('#ffe89a'), smooth(0.3, 1.0, mr) ** 1.4)
    target = lerp(sky, sun_col, moon_disc)

# Far range, half drowned in cloud, opening into a saddle under the moon.
far_line = ridge_line(W, 23, 600 * k, 170 * k, scale=600 * k, octaves=5)
far_line += 120 * k * np.exp(-((X - MOON[0]) / (210 * k)) ** 2)
far_line = np.clip(far_line, 300 * k, 900 * k)
far = below(S, far_line)
zf = -(y - far_line[None, :]) * 0.8 + 110 * k * fbm(S, 22, scale=240 * k, octaves=3)
lit, _ = shade_terrain(zf, (-0.85, -0.25, 0.5), blur=3 * k)
snow = smooth(0.42, 0.55, lit)
rock = lerp(hex2rgb(C['rock_a']), hex2rgb(C['rock_b']), lit)
far_col = lerp(rock, lerp(hex2rgb(C['snow_a']), hex2rgb(C['snow_b']), smooth(0.6, 0.95, lit)), snow)
far_col = lerp(far_col, hex2rgb(C['warm']), smooth(0.85, 1.0, lit) * np.exp(-((x - MOON[0]) / (300 * k)) ** 2) * 0.5)
haze = smooth(500 * k, 680 * k, y)
far_col = lerp(far_col, hex2rgb(C['haze']), haze * 0.35)
target = lerp(target, far_col, far)

# Sea of cloud: rows of scalloped banks, smaller and paler with distance.
clouds = np.zeros(S, np.float32)
cloud = target.copy()
rows = [(b, a, p) + C['rows'][i] for i, (b, a, p) in enumerate([(650, 30, 150), (720, 46, 230), (820, 64, 330), (950, 90, 460)])]
for i, (base, amp, period, shadow, light) in enumerate(rows):
    base, amp, period = base * k, amp * k, period * k
    ph = noise1d(W, 80 + i, step=period * 0.7) * period
    scallop = np.abs(np.sin((X + ph) * math.pi / period)) ** 0.55
    top = base - amp * scallop - 10 * k * noise1d(W, 90 + i, step=20 * k)
    m = smooth(-1.5, 1.5, y - top[None, :])
    # Each billow is lit on its crown and falls into shadow beneath.
    into = np.clip((y - top[None, :]) / (amp * 1.6 + 30 * k), 0, 1)
    col = lerp(hex2rgb(light), hex2rgb(shadow), smooth(0.0, 0.9, into))
    path = np.exp(-((x - MOON[0]) / (70 * k + 0.55 * (base - 600 * k))) ** 2)
    col = lerp(col, hex2rgb(C['path']), path * smooth(0.5, 0.0, into) * 0.95)
    col = lerp(col, hex2rgb(C['path2']), path * 0.25)
    cloud = lerp(cloud, col, m)
    clouds = np.maximum(clouds, m)
target = lerp(target, cloud, clouds)

# Foreground crag on the right, dark against the cloud, rim lit by the moon.
crag_pts = [(1600, 1000), (900, 1000), (960, 940), (1030, 880), (1080, 800), (1130, 730), (1165, 660),
            (1190, 610), (1215, 588), (1300, 584), (1336, 560), (1360, 520), (1395, 506), (1430, 470),
            (1470, 452), (1520, 410), (1570, 395), (1600, 380)]
crag = poly_mask(S, [(px * k, py * k) for px, py in crag_pts])
zr = 160 * k * fbm(S, 62, scale=200 * k, octaves=4) + x * 0.3
rl, _ = shade_terrain(zr, (-0.85, -0.35, 0.4), blur=3 * k)
rock = lerp(hex2rgb(C['crag_a']), hex2rgb(C['crag_b']), rl)
rock = lerp(rock, hex2rgb(C['crag_c']), smooth(0.55, 0.85, fbm(S, 63, scale=120 * k)) * 0.45)
ledges = smooth(0.72, 0.84, rl) * smooth(0.5, 0.7, fbm(S, 64, scale=90 * k, octaves=3))
rock = lerp(rock, lerp(hex2rgb(C['ledge_a']), hex2rgb(C['ledge_b']), smooth(0.7, 1, rl)), ledges)
rim = np.clip(crag - cv2.erode(crag, np.ones((int(7 * k) + 2, int(7 * k) + 2), np.uint8)), 0, 1)
rock = lerp(rock, hex2rgb(C['crag_rim']), rim * 0.8)
target = lerp(target, rock, crag)

# Left foreground shoulder.
left_pts = [(0, 1000), (0, 760), (70, 770), (150, 810), (230, 860), (320, 920), (400, 975), (430, 1000)]
left = poly_mask(S, [(px * k, py * k) for px, py in left_pts])
zl = 110 * k * fbm(S, 71, scale=160 * k, octaves=4) - x * 0.25
ll, _ = shade_terrain(zl, (-0.8, -0.5, 0.4), blur=3 * k)
lcol = lerp(hex2rgb(C['left_a']), hex2rgb(C['left_b']), ll)
lcol = lerp(lcol, hex2rgb(C['left_snow']), smooth(0.65, 0.85, ll) * smooth(0.5, 0.7, fbm(S, 72, scale=70 * k)) * 0.8)
target = lerp(target, lcol, left)

# The merlin, perched on the ledge and facing the moon.
FX, FY, FS = 1252 * k, 587 * k, 1.8 * k
LEAN = math.radians(13)


def P(pts):
    c, sn = math.cos(LEAN), math.sin(LEAN)
    return [(FX + (px * c + py * sn) * FS, FY + (-px * sn + py * c) * FS) for px, py in pts]


bird_pts = [(-1, -100), (-8, -98), (-12, -95), (-15, -93), (-20, -91), (-22, -88), (-21.5, -85), (-19.5, -85.5),
            (-15, -86), (-11, -83), (-14, -76), (-17, -64), (-18, -50), (-16, -36), (-12, -24), (-7, -14),
            (-6, -6), (-10, -1), (-2, 0), (5, -3), (8, 0), (11, 14), (14, 30), (16, 48), (21, 49), (21, 32),
            (20, 16), (22, 10), (24, 0), (27, -18), (27, -38), (24, -56), (17, -70), (10, -80), (6, -88), (3, -96)]
bird = poly_mask(S, P(bird_pts))
lit_side = smooth(FX + 0 * FS, FX - 30 * FS, x)
bird_rim = np.clip(bird - cv2.erode(bird, np.ones((int(4 * k) + 2, int(4 * k) + 2), np.uint8)), 0, 1)
bird_col = np.broadcast_to(hex2rgb(C['bird']), S + (3,)).astype(np.float32)
chest = poly_mask(S, P([(-11, -83), (-14, -76), (-17, -64), (-18, -50), (-16, -36), (-12, -24), (-7, -14),
                        (-1, -16), (1, -36), (-1, -60), (-4, -78)]))
streaks = smooth(0.5, 0.75, fbm(S, 66, scale=5 * FS, octaves=2, aspect=0.35))
bird_col = lerp(bird_col, lerp(hex2rgb(C['chest_a']), hex2rgb(C['chest_b']), streaks), chest * 0.85)
wing = poly_mask(S, P([(8, -82), (15, -70), (22, -54), (25, -34), (25, -12), (23, 4), (22, 10), (16, -8), (9, -38), (3, -64)]))
coverts = smooth(0.45, 0.7, fbm(S, 67, scale=8 * FS, octaves=2, aspect=0.6))
bird_col = lerp(bird_col, lerp(hex2rgb(C['wing_a']), hex2rgb(C['wing_b']), coverts), wing)
tache = poly_mask(S, P([(-10, -90), (-6, -90), (-7, -80), (-10, -79)]))
bird_col = lerp(bird_col, hex2rgb(C['tache']), tache)
beak = poly_mask(S, P([(-15, -93), (-20, -91), (-22, -88), (-21.5, -85), (-19.5, -85.5), (-15, -87)]))
bird_col = lerp(bird_col, hex2rgb('#6b6f8e'), beak)
cere = poly_mask(S, P([(-13, -94), (-16, -93.5), (-16, -89), (-13, -89)]))
bird_col = lerp(bird_col, hex2rgb('#d9a83a'), cere * 0.8)
bird_col = lerp(bird_col, hex2rgb(C['bird_rim']), bird_rim * lit_side * 0.95)
ex, ey = P([(-8, -92)])[0]
eye_r = np.hypot(x - ex, y - ey) / FS
bird_col = lerp(bird_col, hex2rgb('#e0b040'), smooth(2.4, 1.9, eye_r))
bird_col = lerp(bird_col, hex2rgb('#0b0a14'), smooth(1.5, 1.0, eye_r))
gx_, gy_ = P([(-8.6, -92.6)])[0]
bird_col = lerp(bird_col, hex2rgb('#ffffff'), smooth(0.6, 0.2, np.hypot(x - gx_, y - gy_) / FS))
cap = np.zeros(S, np.float32)
no_bird = target.copy()
target = lerp(target, bird_col, bird)

# ---------------------------------------------------------------- strokes
if NIGHT:
    cv = Canvas(no_bird, seed=5)
else:
    # Sky strokes drag a little wet paint from the sun; let that be cream light, not yellow disc.
    cv = Canvas(lerp(no_bird, hex2rgb(C['glow2']), moon_disc), seed=5)
    cv.target = no_bird
ACC_SKY = [hex2rgb(c) for c in C['acc_sky']]
ACC_ROCK = [hex2rgb(c) for c in C['acc_rock']]
ACC_CLOUD = [hex2rgb(c) for c in C['acc_cloud']]

skym = np.clip(1 - far - clouds - crag - left, 0, 1)
sky_clip = cv2.dilate(skym, np.ones((int(14 * k), int(14 * k)), np.uint8))
sky_angle = math.radians(-22)
if not NIGHT:
    # The sky pass sees cream light where the sun is, so no stroke carries disc yellow into the sky.
    cv.target = lerp(no_bird, hex2rgb(C['glow2']), np.clip((1.15 - mr) * 6, 0, 1))
cv.layer(skym, sky_angle, 260, 46, density=1.2, accents=ACC_SKY, accent_p=0.16, clip=sky_clip, thick=1.0, curve=0.25, angle_jitter=0.08)
cv.layer(skym, sky_angle, 150, 28, density=0.6, accents=ACC_SKY, accent_p=0.12, clip=sky_clip, thick=0.9, curve=0.25, angle_jitter=0.08)
disc = np.clip(1.12 - mr, 0, 1)
moon_ang = np.arctan2(y - MOON[1], x - MOON[0]) + math.pi / 2
halo = np.exp(-(mr - 1.05).clip(0) / 0.6) * (mr > 1.03)
if NIGHT:
    cv.layer(halo, sky_angle, 90, 20, density=0.7, clip=sky_clip * (mr > 1.0), thick=0.8)
else:
    # Thick cream dabs laid round the sun, the way a painter builds a glow.
    rays = np.exp(-(mr - 1.02).clip(0) / 0.9) * (mr > 1.02)
    cv.layer(rays, moon_ang, 56, 14, density=1.0, clip=sky_clip * (mr > 1.0), thick=1.0, sample_blur=3, curve=0.4,
             angle_jitter=0.35, size_jitter=0.5)
cv.target = no_bird
cv.inlay(np.clip((1 - mr) * MOON[2], 0, 1), thick=1.0)
cv.layer(disc, moon_ang, 40, 14, density=1.6, clip=np.clip((1.0 - mr) * MOON[2] * 0.5, 0, 1), thick=1.4, sample_blur=2)

far_ang = slope_angle(zf, 5 * k)
cv.layer(far, far_ang, 70, 22, density=1.5, accents=ACC_ROCK, accent_p=0.14, thick=1.3, curve=0.15, ragged=0.5)
cv.layer(far, far_ang, 38, 12, density=1.0, accents=ACC_ROCK, accent_p=0.1, thick=1.4, ragged=0.5, sample_blur=2)

cv.layer(clouds, 0.0, 150, 34, density=1.4, accents=ACC_CLOUD, accent_p=0.1, thick=1.1, curve=0.5, angle_jitter=0.07)
cv.layer(clouds, 0.0, 80, 18, density=0.9, accents=ACC_CLOUD, accent_p=0.06, thick=1.2, curve=0.6, sample_blur=2, angle_jitter=0.07)

crag_ang = slope_angle(zr, 5 * k) * 0.4 + math.radians(65) * 0.6
cv.layer(crag, crag_ang, 90, 28, density=1.5, accents=ACC_ROCK, accent_p=0.18, thick=1.5, ragged=0.6, curve=0.2)
cv.layer(crag, crag_ang, 46, 14, density=1.0, accents=ACC_ROCK, accent_p=0.12, thick=1.6, ragged=0.6, sample_blur=2)
left_ang = slope_angle(zl, 5 * k)
cv.layer(left, left_ang, 80, 24, density=1.5, accents=ACC_ROCK, accent_p=0.15, thick=1.5, ragged=0.6)
cv.target = target
bare = (cv.color.copy(), cv.height.copy())   # the scene before the bird is painted in
cv.inlay(bird, thick=1.2)
cv.layer(bird * (1 - bird_rim) * (1 - smooth(3.5, 2.5, eye_r)) * (1 - cap), math.radians(84), 14 * FS / k, 3.5 * FS / k, density=1.4, thick=1.3, sample_blur=0.6,
         angle_jitter=0.12, curve=0.2, accents=[hex2rgb(c) for c in C['bird_acc']], accent_p=0.1, accent_mix=0.25)
cv.inlay(bird_rim * lit_side, thick=1.5)

def light(canvas):
    out = canvas.finish()
    if not NIGHT:
        # A soft bloom that starts just inside the limb, so the sun shines rather than sits on the sky.
        bloom = np.exp(-(mr - 1).clip(0) / 0.9) * smooth(0.99, 1.06, mr)
        out = np.clip(out + bloom[..., None] * hex2rgb('#fff2d0') * 0.14, 0, 1)
    return out


img = light(cv)
save(img, f'out/eyrie_{TONE}_{W}.jpg')
if '--plates' in sys.argv:
    # Layers for the film: the painting, the same painting without the perched
    # bird, and the masks the animation needs.
    cv.color, cv.height = bare
    np.savez_compressed(f'out/eyrie_{TONE}_plates.npz', painting=np.float16(img), bare=np.float16(light(cv)),
                        sky=np.float16(skym), clouds=np.float16(clouds), far=np.float16(far),
                        crag=np.float16(np.clip(crag + left, 0, 1)), bird=np.float16(bird),
                        moon=np.float32([MOON[0], MOON[1], MOON[2]]), perch=np.float32([FX, FY, FS]))
print('done')
