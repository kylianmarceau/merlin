"""A jointed falcon for the film, built in 3D and drawn as painted polygons.

Bird space: x forward, y up, z to the bird's right. One unit is the length
from beak to tail tip. Each wing has a shoulder, an arm out to the wrist and
a hand of primaries out to a pointed tip; the hand folds back at the wrist
on the upstroke, the way a falcon's does.
"""
import math

import cv2
import numpy as np


def rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.float32([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.float32([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.float32([[c, -s, 0], [s, c, 0], [0, 0, 1]])


# ---------------------------------------------------------------- the model

# Body stations: x, half height, half width, centre height.
BODY = [(0.465, 0.004, 0.004, -0.004), (0.445, 0.020, 0.016, 0.004), (0.415, 0.040, 0.032, 0.012),
        (0.375, 0.052, 0.044, 0.014), (0.335, 0.050, 0.044, 0.008), (0.29, 0.054, 0.048, 0.000),
        (0.22, 0.072, 0.060, -0.008), (0.13, 0.080, 0.066, -0.010), (0.04, 0.074, 0.062, -0.006),
        (-0.05, 0.060, 0.052, 0.000), (-0.13, 0.042, 0.040, 0.006), (-0.20, 0.028, 0.030, 0.010)]

ARM = 0.30          # shoulder to wrist
HAND = 0.50         # wrist to tip


def arm_outline():
    """Inner wing in (span, back) with back measured behind the leading edge at the shoulder."""
    le = [(0.0, -0.03), (0.06, -0.045), (0.14, -0.05), (0.22, -0.045), (ARM, -0.035)]
    te = [(ARM, 0.15), (0.24, 0.175), (0.16, 0.19), (0.08, 0.20), (0.0, 0.19)]
    return le + te


def hand_outline():
    """Hand of primaries relative to the wrist; the tip is long and pointed."""
    le = [(0.0, -0.035), (0.12, -0.03), (0.26, -0.01), (0.38, 0.03), (HAND, 0.11)]
    te = [(HAND - 0.02, 0.135), (0.42, 0.15), (0.40, 0.165), (0.32, 0.175), (0.30, 0.19),
          (0.22, 0.195), (0.20, 0.205), (0.12, 0.20), (0.06, 0.18), (0.0, 0.15)]
    return le + te


ARM_PTS = np.float32(arm_outline())
HAND_PTS = np.float32(hand_outline())


def pose_parts(flap=0.0, sweep=0.15, hand_flap=0.0, fold=0.2, tail_spread=0.2, tail_pitch=0.0,
               dihedral_twist=0.0, head=0.0):
    """Polygons in bird space: a list of (name, Nx3 points)."""
    parts = []
    for side in (1, -1):
        sh = np.float32([0.12, 0.035, 0.045 * side])
        # Arm: in its own frame span runs along +z, back along -x.
        loc = np.stack([-ARM_PTS[:, 1], np.zeros(len(ARM_PTS)), ARM_PTS[:, 0] * side], 1)
        R1 = rx(-flap * side) @ ry(-sweep * side)
        arm = loc @ R1.T + sh
        wrist_loc = np.float32([0.035, 0, ARM * side])
        wrist = wrist_loc @ R1.T + sh
        # Hand: a further fold back at the wrist and its own lift.
        hl = np.stack([-HAND_PTS[:, 1], np.zeros(len(HAND_PTS)), HAND_PTS[:, 0] * side], 1)
        R2 = R1 @ rx(-hand_flap * side) @ ry(-fold * side) @ rz(dihedral_twist)
        hand = hl @ R2.T + wrist
        parts.append(('arm', arm, side))
        parts.append(('hand', hand, side))
    # Tail: a fan behind the body.
    w = 0.05 + 0.07 * tail_spread
    tail = np.float32([(-0.16, 0, -0.028), (-0.42, 0, -w), (-0.47, 0, -w * 0.7), (-0.5, 0, -w * 0.3),
                       (-0.505, 0, 0), (-0.5, 0, w * 0.3), (-0.47, 0, w * 0.7), (-0.42, 0, w), (-0.16, 0, 0.028)])
    tail = (tail - [-0.16, 0, 0]) @ rz(tail_pitch).T + [-0.16, 0.012, 0]
    parts.append(('tail', tail, 0))
    # The tail has some depth too, so it never reads as a stick side on.
    prof = np.float32([(-0.16, 0.036, 0), (-0.46, 0.02, 0), (-0.505, 0.008, 0), (-0.505, -0.008, 0),
                       (-0.46, -0.016, 0), (-0.16, -0.036, 0)])
    prof = (prof - [-0.16, 0, 0]) @ rz(tail_pitch).T + [-0.16, 0.012, 0]
    parts.append(('tailside', prof, 0))
    return parts, head


def body_rings(head=0.0, n=14):
    rings = []
    th = np.linspace(0, 2 * math.pi, n, endpoint=False)
    for x, hy, hz, cy in BODY:
        ring = np.stack([np.full(n, x), cy + hy * np.sin(th), hz * np.cos(th)], 1).astype(np.float32)
        if x > 0.3 and head:
            ring = (ring - [0.3, 0, 0]) @ ry(head).T + [0.3, 0, 0]
        rings.append(ring)
    return rings


BEAK = np.float32([(0.44, 0.012, 0), (0.475, 0.0, 0), (0.482, -0.012, 0), (0.47, -0.026, 0),
                   (0.462, -0.012, 0), (0.44, -0.016, 0)])


# ---------------------------------------------------------------- drawing

def orientation(forward, up_hint=(0, 1, 0), bank=0.0):
    """Rotation whose columns are the bird's x, y, z in camera space."""
    f = np.float32(forward) / (np.linalg.norm(forward) + 1e-9)
    u = np.float32(up_hint)
    r = np.cross(f, u)
    if np.linalg.norm(r) < 1e-4:
        r = np.cross(f, np.float32([0, 0, 1]))
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    # Bank: roll about the forward axis.
    c, s = math.cos(bank), math.sin(bank)
    u, r = u * c + r * s, -u * s + r * c
    return np.stack([f, u, r], 1)


def project(pts, R, centre, scale):
    cam = pts @ R.T
    return np.stack([centre[0] + cam[:, 0] * scale, centre[1] - cam[:, 1] * scale], 1), cam[:, 2]


def polys(R, centre, scale, **pose):
    """Projected polygons with depth and shading terms, far to near."""
    parts, head = pose_parts(**pose)
    out = []
    light = np.float32([-0.45, 0.55, -0.7])
    light /= np.linalg.norm(light)
    for name, pts, side in parts:
        p2, z = project(pts, R, centre, scale)
        a, b = pts[1] - pts[0], pts[len(pts) // 2] - pts[0]
        n = np.cross(a, b) * (side if side else 1)
        n_cam = R @ (n / (np.linalg.norm(n) + 1e-9))
        if n_cam[1] < 0 and False:
            pass
        out.append((float(z.mean()), name, p2, n_cam, side))
    rings = body_rings(head)
    for i in range(len(rings) - 1):
        q = np.concatenate([rings[i], rings[i + 1]])
        p2, z = project(q, R, centre, scale)
        hull = cv2.convexHull(p2.astype(np.float32)).reshape(-1, 2)
        out.append((float(z.mean()), 'body', hull, None, i))
    p2, z = project(BEAK, R, centre, scale)
    out.append((float(z.mean()) + 0.02, 'beak', p2, None, 0))
    out.sort(key=lambda o: o[0])
    return out, light


def coverage(shape, polys_, ss=4):
    m = np.zeros((shape[0] * ss, shape[1] * ss), np.uint8)
    for _, _, p2, _, _ in polys_:
        cv2.fillPoly(m, [np.round(p2 * ss * 16).astype(np.int32)], 255, cv2.LINE_AA, shift=4)
    return cv2.resize(m, (shape[1], shape[0]), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def wingbeat(p, power=1.0):
    """Wing pose at phase p of a beat (0 = top of the stroke)."""
    c = math.cos(2 * math.pi * p)
    up = max(0.0, math.sin(2 * math.pi * (p - 0.5)))      # upstroke: wrist flexes
    return dict(flap=math.radians(10 + 50 * power * c),
                hand_flap=math.radians(26 * power * math.cos(2 * math.pi * p - 1.0)),
                fold=math.radians(16 + 58 * power * up),
                sweep=math.radians(6 + 20 * power * up))


GLIDE = dict(flap=math.radians(7), hand_flap=math.radians(-5), fold=math.radians(24), sweep=math.radians(10))


def mix(a, b, t):
    return {k: a[k] + (b[k] - a[k]) * t for k in a}
