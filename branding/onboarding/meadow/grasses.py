"""Rooted grass and flower animation for the painted coast, in film coordinates."""

import math

import cv2
import numpy as np


# Art direction points in the 1100 x 688 study. Each pair follows an actual
# brushstroke from its root to its tip. The width is measured across the stroke.
STROKES = [
    (358, 545, 378, 517, 7),
    (398, 548, 432, 511, 9),
    (421, 550, 453, 518, 6),
    (468, 552, 508, 515, 11),
    (620, 555, 645, 523, 6),
    (652, 555, 679, 519, 7),
    (805, 557, 838, 505, 7),
    (833, 570, 869, 493, 10),
    (860, 552, 908, 501, 8),
    (898, 539, 948, 491, 7),
    (1026, 545, 1074, 486, 7),
    (1047, 541, 1090, 487, 8),
]
# Petal centres and picking radii keep neighbours on their own stems. The
# matte selects paint by hue inside each area, retaining the broken dry edges.
CORAL = [
    (31, 524, 20, 24),
    (116, 523, 27, 22),
    (148, 547, 24, 20),
    (823, 630, 20, 23),
    (867, 597, 24, 26),
    (894, 584, 28, 24),
    (910, 614, 25, 24),
    (958, 570, 31, 21),
    (961, 608, 32, 24),
    (998, 622, 22, 20),
    (1050, 614, 12, 21),
]
VIOLET = [
    (48, 571, 20, 24),
    (67, 599, 30, 27),
    (94, 575, 23, 24),
    (103, 636, 25, 23),
    (158, 598, 26, 22),
    (194, 613, 20, 22),
    (218, 631, 22, 21),
    (250, 568, 29, 15),
    (304, 601, 15, 14),
    (648, 660, 17, 17),
    (681, 631, 23, 21),
    (720, 621, 18, 19),
    (1020, 572, 23, 29),
    (1052, 543, 16, 20),
    (1067, 582, 22, 19),
]
# Pigment for additional leaves comes from broad ochre, green and straw marks
# in the same painting. Sample along the grain from base to tip.
PIGMENTS = [
    (363, 661, 408, 613, 9),
    (451, 668, 487, 619, 8),
    (306, 625, 346, 578, 8),
    (563, 674, 608, 619, 10),
    (466, 626, 509, 593, 8),
    (375, 680, 422, 632, 10),
    (572, 633, 614, 593, 6),
    (326, 668, 369, 612, 9),
]
JOINTS = np.linspace(0, 1, 12, dtype=np.float32)
MID = (JOINTS[1:] + JOINTS[:-1]) * 0.5


def pigment_strip(art, stroke, scale, rng):
    x, y, tx, ty, width = np.asarray(stroke) * scale
    s, cross = np.mgrid[0:1:64j, -1:1:25j].astype("float32")
    rgb = cv2.remap(
        art,
        (x + (tx - x) * s + cross * width / 2).astype("float32"),
        (y + (ty - y) * s).astype("float32"),
        cv2.INTER_LINEAR,
    )
    # Bristles run the full length of the blade. A fixed dry edge and a raised
    # streak travel with this pigment through every pose.
    grain = rng.normal(0, 5, (1, 25)) + rng.normal(0, 2, (64, 25))
    rgb = np.clip(rgb + grain[..., None], 0, 255)
    half = (0.86 + 0.13 * np.sin(3 * s)) * np.maximum(0, 1 - s**1.8) ** 0.74
    alpha = np.clip((half - abs(cross + 0.045 * np.sin(9 * s))) * 8, 0, 1)
    # Embed the root in the underlying paint. Only the free length has a
    # distinct silhouette; the clump should have no horizontal cut at its foot.
    embedded = np.clip(s / 0.27, 0, 1)
    alpha *= embedded**2 * (3 - 2 * embedded)
    return np.dstack((rgb, alpha * 255)).astype("uint8")


def paint_patch(image, sprite, left, top):
    h, w = image.shape[:2]
    bottom, right = min(h, top + sprite.shape[0]), min(w, left + sprite.shape[1])
    x, y = max(0, left), max(0, top)
    if x >= right or y >= bottom:
        return
    patch = sprite[y - top : bottom - top, x - left : right - left]
    alpha = patch[..., 3:4].astype("float32") / 255
    dest = image[y:bottom, x:right]
    dest[:] = dest + (patch[..., :3].astype("float32") - dest) * alpha


class Stem:
    def __init__(self, root, length, lean, width, material, rng, head=None):
        self.x, self.y = root
        self.length, self.lean, self.width = length, lean, width
        self.material, self.head = material, head
        self.curl = rng.uniform(-0.12, 0.15)
        self.phase = rng.uniform(0, 2 * math.pi)
        self.compliance = rng.uniform(0.80, 1.15) * (0.74 if head is not None else 1)

    def pose(self, t):
        # Two wind scales shared by adjacent plants, followed by a small
        # independent tremor. The force travels across and up the slope.
        time = t - self.x / 460 - self.y / 1060
        gust = 0.27 * math.sin(2.22 * time) + 0.14 * math.sin(3.64 * time + 0.8)
        lag = 0.53 if self.head is not None else 0.30
        bend = gust + 0.18 * np.sin(2.22 * time - lag * MID)
        flutter = 0.053 * np.sin(6.4 * t + self.phase - 1.05 * MID)
        angles = (
            self.lean
            + self.curl * (2 * MID - 1)
            + self.compliance * (bend * MID + flutter * MID**2)
        )
        angles = np.clip(angles, -1.30, 1.30)
        segment = self.length / len(MID)
        xs = self.x + np.r_[0.0, np.cumsum(np.sin(angles) * segment)]
        ys = self.y - np.r_[0.0, np.cumsum(np.cos(angles) * segment)]
        return xs, ys, angles[-1]

    def draw(self, image, t):
        xs, ys, angle = self.pose(t)
        # Scan-convert the spine by height. Its segment lengths stay constant
        # as it bends. Project the width onto the scanline to keep the ribbon
        # from thinning as it leans.
        top = math.floor(ys[-1])
        rows = np.arange(top, math.ceil(self.y), dtype=np.float32)
        if not len(rows):
            return
        along = np.interp(rows, ys[::-1], JOINTS[::-1])
        center = np.interp(rows, ys[::-1], xs[::-1])
        cosines = -np.diff(ys) / (self.length / len(MID))
        radius = self.width * 0.5 / np.interp(along, MID, cosines)
        left = math.floor(np.min(center - radius))
        cols = np.arange(left, math.ceil(np.max(center + radius)) + 1, dtype=np.float32)
        tex = self.material
        map_x = ((cols - center[:, None]) / radius[:, None] + 1) * ((tex.shape[1] - 1) / 2)
        map_y = np.broadcast_to((along * (tex.shape[0] - 1))[:, None], map_x.shape)
        sprite = cv2.remap(
            tex,
            map_x.astype("float32"),
            map_y.astype("float32"),
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        sprite[..., 3] *= (map_x >= 0) & (map_x <= tex.shape[1] - 1)
        paint_patch(image, sprite, left, top)
        if self.head is not None:
            sprite, ax, ay = self.head
            # Petals turn together about their attachment point, with the
            # modest nod of a loaded stem rather than stretching like rubber.
            turn = -0.60 * math.degrees(angle - self.lean)
            matrix = cv2.getRotationMatrix2D((ax, ay), turn, 1.0)
            rotated = cv2.warpAffine(
                sprite, matrix, (sprite.shape[1], sprite.shape[0]), flags=cv2.INTER_LINEAR
            )
            paint_patch(image, rotated, round(xs[-1] - ax), round(ys[-1] - ay))


class Meadow:
    def __init__(self, art):
        height, width = art.shape[:2]
        scale = width / 1100
        rng = np.random.default_rng(8216)
        self.stems = []
        removed = np.zeros((height, width), np.uint8)
        hsv = cv2.cvtColor(art, cv2.COLOR_RGB2HSV)
        hue, sat, value = cv2.split(hsv)
        materials = [pigment_strip(art, stroke, scale, rng) for stroke in PIGMENTS]
        # Isolate the pre-existing long strokes that already break the skyline.
        # Their original pixels become flexible leaves above a clean plate.
        for x, y, tx, ty, brush in np.array(STROKES) * scale:
            half = brush * 0.85
            length = math.hypot(tx - x, ty - y)
            s, cross = np.mgrid[0:1:96j, -1:1:31j].astype("float32")
            sx = (x + (tx - x) * s + cross * half).astype("float32")
            sy = (y + (ty - y) * s + np.zeros_like(cross)).astype("float32")
            leaf = cv2.remap(art, sx, sy, cv2.INTER_LINEAR)
            leaf_hsv = cv2.cvtColor(leaf, cv2.COLOR_RGB2HSV)
            coverage = np.clip((63.0 - leaf_hsv[..., 0]) / 12, 0, 1)
            coverage *= np.clip((0.97 - abs(cross)) * 7, 0, 1) * np.clip((1 - s) * 12, 0, 1)
            material = np.dstack((leaf, coverage * 255)).astype("uint8")
            px, py = np.rint(sx).astype(int), np.rint(sy).astype(int)
            removed[py[coverage > 0.18], px[coverage > 0.18]] = 255
            lean = math.atan2(tx - x, y - ty)
            stem = Stem((x, y), length, lean, half * 2 * math.cos(lean), material, rng)
            stem.curl = 0
            self.stems.append(stem)

        for spots, colour in [
            (CORAL, ((hue < 12) | (hue > 167)) & (sat > 56) & (value > 105)),
            (VIOLET, (hue >= 122) & (hue <= 166) & (sat > 48)),
        ]:
            # Where heads overlap, assign each dab of paint to the nearest
            # centre once. A petal cannot move with two neighbouring stems.
            owner = np.full((height, width), -1, np.int16)
            distance = np.ones((height, width), np.float32)
            for i, (x, y, rx, ry) in enumerate(np.array(spots) * scale):
                a, b = max(0, int(x - rx)), max(0, int(y - ry))
                yy, xx = np.ogrid[
                    b : min(height, math.ceil(y + ry) + 1), a : min(width, math.ceil(x + rx) + 1)
                ]
                d = ((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2
                region = np.s_[b : b + d.shape[0], a : a + d.shape[1]]
                closer = d < distance[region]
                owner[region][closer] = i
                distance[region][closer] = d[closer]
            for i, (x, y, rx, ry) in enumerate(np.array(spots) * scale):
                pad = math.ceil(max(rx, ry) * 1.45)
                a, b = round(x) - pad, round(y) - pad
                if min(a, b) < 0 or a + 2 * pad >= width or b + 2 * pad >= height:
                    continue
                region = np.s_[b : b + 2 * pad + 1, a : a + 2 * pad + 1]
                mask = (colour[region] & (owner[region] == i)).astype("uint8") * 255
                mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
                removed[region] |= mask
                alpha = cv2.GaussianBlur(mask, (3, 3), 0.62)
                head = (np.dstack((art[region], alpha)), float(pad), float(pad))
                length = rng.uniform(52, 87) * scale
                lean = rng.uniform(0.18, 0.43)
                root = (x - length * math.sin(lean), y + length * math.cos(lean))
                stem = Stem(
                    root, length, lean, rng.uniform(3.7, 5.5) * scale, materials[3], rng, head
                )
                stem.curl = 0
                self.stems.append(stem)

        # Fill newly revealed slivers with nearby field colour and real bristle
        # texture. Pixels outside the lifted silhouettes are copied verbatim.
        removed = cv2.dilate(removed, np.ones((3, 3), np.uint8))
        self.plate = cv2.inpaint(art, removed, 5, cv2.INPAINT_TELEA)
        grain = art.astype("float32") - cv2.GaussianBlur(art, (0, 0), 3).astype("float32")
        cut = removed != 0
        self.plate[cut] = np.clip(self.plate[cut] + np.roll(grain, 87, axis=1)[cut] * 0.8, 0, 255)

        # Plant in uneven tufts following the painted headland. Front stalks
        # can occlude the blossoms while distant plants have shorter travel.
        for _ in range(83):
            x = rng.uniform(-20, 1120)
            edge = np.interp(
                x, [0, 180, 355, 560, 760, 900, 1100], [498, 526, 544, 556, 550, 535, 521]
            )
            y = rng.uniform(edge + 10, 740)
            depth = np.clip((y - edge) / 155, 0, 1)
            size = rng.uniform(0.73, 1.29) * (19 + 58 * depth)
            lean = rng.uniform(0.18, 0.76)
            for _ in range(rng.integers(3, 8)):
                root = ((x + rng.normal(0, 5 + 4 * depth)) * scale, (y + rng.normal(0, 3)) * scale)
                stem = Stem(
                    root,
                    size * rng.uniform(0.62, 1.3) * scale,
                    lean + rng.uniform(-0.40, 0.32),
                    rng.uniform(2.4, 6.8) * (1 + 0.58 * depth) * scale,
                    materials[rng.integers(len(materials))],
                    rng,
                )
                self.stems.append(stem)
        self.stems.sort(key=lambda stem: stem.y)

    def draw(self, image, t):
        for stem in self.stems:
            stem.draw(image, t)
