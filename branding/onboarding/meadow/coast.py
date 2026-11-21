"""Moving paint layers for the sky, open water and breaking surf."""

import math

import cv2
import numpy as np


# The study is 1100 pixels wide. Trace the waterline behind the sea stacks
# and the meadow in front of it so foam disappears against the right edges.
WATER_EDGE = [
    (1100, 398),
    (607, 400),
    (561, 406),
    (496, 409),
    (431, 413),
    (360, 416),
    (346, 418),
    (353, 432),
    (364, 424),
    (373, 428),
    (386, 441),
    (397, 442),
    (407, 437),
    (426, 441),
    (441, 447),
    (421, 450),
    (390, 447),
    (368, 451),
    (343, 453),
    (329, 457),
    (307, 455),
    (292, 462),
    (273, 464),
    (260, 469),
    (237, 470),
    (226, 478),
    (257, 485),
    (279, 498),
    (303, 504),
    (353, 515),
    (426, 524),
    (491, 535),
    (566, 539),
    (641, 539),
    (710, 533),
    (776, 536),
    (857, 519),
    (936, 509),
    (1004, 521),
    (1100, 488),
]


def wet_paint(area, colour, amount):
    """Mix pigment into an RGB float canvas using a two-dimensional matte."""
    area += (colour - area) * amount[..., None]


class Coast:
    def __init__(self, base):
        h, w = base.shape[:2]
        self.scale = s = w / 1100
        rng = np.random.default_rng(5137)

        # Separate the peach/lilac cloud pigment from a reconstruction of the
        # cooler ground underneath. Moving residual paint reconstructs exactly
        # the original sky at rest and never drags the cliff silhouette.
        self.sky_end = int(400 * s)
        sky = base[: self.sky_end].astype("float32")
        y, x = np.mgrid[: self.sky_end, :w].astype("float32") / s
        skyline = np.interp(
            x[0],
            [0, 82, 166, 240, 320, 410, 520, 610, 1100],
            [327, 327, 340, 324, 352, 366, 383, 395, 393],
        )
        self.sky_mask = np.clip((skyline - y) / 17, 0, 1).astype("float32")
        warmth = sky[..., 0] - sky[..., 2]
        # The unpainted patches in a coarse sky study supply the local blue
        # underneath each cloud bank, including the warmer air at the horizon.
        small = cv2.resize(sky, None, fx=0.125, fy=0.125, interpolation=cv2.INTER_AREA)
        small = cv2.erode(small, np.ones((5, 9), np.uint8))
        ground = cv2.resize(cv2.GaussianBlur(small, (0, 0), 1.8), (w, self.sky_end))
        alpha = np.clip((warmth + 65) / 59, 0, 1) * self.sky_mask
        residual = (sky - ground) * alpha[..., None]
        high = np.clip((200 - y + 0.065 * x) / 110, 0, 1)[..., None]
        self.clouds = (residual * high, residual * (1 - high))
        self.clear_sky = sky - residual

        self.top, self.bottom = int(396 * s), math.ceil(549 * s)
        sea = base[self.top : self.bottom]
        self.y, self.x = np.mgrid[self.top : self.bottom, :w].astype("float32") / s
        matte = np.zeros((h, w), np.uint8)
        cv2.fillPoly(matte, [np.rint(np.array(WATER_EDGE) * s).astype("int32")], 255, cv2.LINE_AA)
        # Preserve small blades and ochre rock faces which cross the outline.
        hsv = cv2.cvtColor(sea, cv2.COLOR_RGB2HSV)
        water_colour = np.clip((hsv[..., 0].astype("float32") - 49) / 14, 0, 1)
        water_colour = np.maximum(water_colour, np.clip((50.0 - hsv[..., 1]) / 33, 0, 1))
        self.water = (
            cv2.GaussianBlur(matte[self.top : self.bottom], (3, 3), 0.75) / 255 * water_colour
        ).astype("float32")
        clearance = cv2.distanceTransform((self.water > 0.65).astype("uint8"), cv2.DIST_L2, 3)
        self.clearance = np.clip(clearance / (9 * s), 0, 1)
        self.depth = np.clip((self.y - 399) / 137, 0, 1.1)
        self.grain = cv2.cvtColor(sea, cv2.COLOR_RGB2GRAY).astype("float32")
        self.grain -= cv2.GaussianBlur(self.grain, (0, 0), 2)
        self.sea_paint = sea.astype("float32")
        # Small, repeatable fans of droplets leave each rock on impact.
        self.droplets = rng.uniform(0, 1, (3, 47, 5))
        self.swells = []
        for _ in range(72):
            depth = rng.uniform(0.02, 1)
            self.swells.append(
                (
                    rng.uniform(0.23, 1.07) * 1100,
                    400 + depth * 131,
                    rng.uniform(14, 43) * (0.5 + depth),
                    rng.uniform(0, 2 * math.pi),
                    rng.uniform(2.6, 4.9),
                    rng.uniform(0.65, 1.3),
                )
            )

    def sky(self, image, t):
        sky = self.clear_sky.copy()
        for layer, speed, lift in zip(self.clouds, (9.2, 4.6), (-1.6, -0.45)):
            h, w = layer.shape[:2]
            matrix = np.float32([[1, 0, speed * t * self.scale], [0, 1, lift * t * self.scale]])
            sky += cv2.warpAffine(layer, matrix, (w, h), borderMode=cv2.BORDER_REFLECT_101)
        region = image[: self.sky_end]
        region[:] = np.clip(region + (sky - region) * self.sky_mask[..., None], 0, 255)

    def sea(self, image, t, rise):
        x, y, d = self.x, self.y, self.depth
        # Perspective compresses the distance between swells towards the
        # horizon. The crest advances shoreward, and its shaded face follows.
        phase = (
            28 * np.log1p(d * 2.8)
            - 0.008 * x
            - 2.48 * t
            + 0.72 * np.sin(0.019 * x + 0.015 * y)
            + 0.44 * np.sin(0.009 * x - 0.042 * y)
        )
        lift = np.sin(phase)
        # Carry only marine pigment as the surface lifts; land, foreground
        # stems, and the horizon are composited separately.
        dx = (2 + 4 * d) * np.cos(phase) + 1.7 * d * np.sin(phase * 0.65)
        dy = (0.45 + 1.95 * d) * lift
        s = self.scale
        sea = cv2.remap(
            self.sea_paint,
            (x + dx * self.clearance) * s,
            (y + dy * self.clearance) * s - self.top,
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        patches = (
            0.47
            + 0.24 * np.sin(0.023 * x + 0.051 * y + 0.28 * t)
            + 0.17 * np.sin(0.054 * x - 0.037 * y)
        )
        crest = np.clip((lift - 0.26) / 0.74, 0, 1) ** 2 * patches
        wet_paint(sea, np.float32([161, 218, 202]), crest * (0.08 + 0.47 * d))
        wet_paint(sea, np.float32([20, 99, 135]), np.maximum(0, -lift) ** 2 * (0.055 + 0.15 * d))

        # Sunshine catches the rising face. Its reflection breaks up in the
        # same crests that carry the foam and widens towards the viewer.
        solar_x = 1100 * (0.76 - 0.048 * rise)
        path = np.exp(-(((x - solar_x - 3 * np.sin(0.12 * y)) / (12 + 62 * d)) ** 2))
        glint = np.maximum(0, np.sin(phase + 0.12 * self.grain)) ** 8
        wet_paint(sea, np.float32([255, 229, 161]), path * glint * rise * (0.34 + 0.53 * patches))

        # Short, tapered palette-knife marks ride selected waves. Each crests,
        # fans out, and dissolves into broken foam before the next set arrives.
        for cx, cy, reach, seed, period, strength in self.swells:
            age = (t / period + seed / (2 * math.pi)) % 1
            depth = (cy - 399) / 137
            spread = math.sin(math.pi * age) ** 1.35
            cx += (0.5 - age) * (12 + 30 * depth)
            cy += (age - 0.5) * (7 + 20 * depth)
            half = reach * (0.42 + 0.69 * spread)
            thick = 0.55 + 2.45 * depth
            x0, x1 = max(0, int((cx - half - 2) * s)), min(
                sea.shape[1], math.ceil((cx + half + 2) * s)
            )
            y0, y1 = max(0, int((cy - 6 * thick) * s) - self.top), min(
                sea.shape[0], math.ceil((cy + 6 * thick) * s) - self.top
            )
            if x0 >= x1 or y0 >= y1:
                continue
            region = np.s_[y0:y1, x0:x1]
            along = (x[region] - cx) / half
            taper = np.maximum(0, 1 - along**2)
            line = cy - thick * (
                1.2 * taper + 0.52 * np.sin(3.4 * along + seed) + 0.18 * np.sin(10 * along + seed)
            )
            cross = (y[region] - line) / thick
            edge = np.exp(-1.65 * cross**2)
            broken = np.clip(
                0.61
                + 0.53 * np.sin(10 * along + seed)
                + 0.21 * np.cos(26 * along - seed)
                + self.grain[region] * 0.041,
                0.12,
                1,
            )
            foam = (spread * strength * taper * edge * broken).clip(0, 1)
            wet_paint(sea[region], np.float32([236, 239, 210]), foam * 0.90)
        target = image[self.top : self.bottom]
        target[:] = np.clip(
            target.astype("float32") + (sea - target) * self.water[..., None], 0, 255
        )

    def breakers(self, image, t):
        # Approaching arcs converge on these three visible rock faces. At
        # contact a fan lifts, falls back, then spreads laterally as wash.
        for i, (x, y, period, offset) in enumerate(
            [(387, 445, 3.45, 0.29), (327, 457, 3.9, 0.78), (269, 469, 3.05, 0.56)]
        ):
            age = (t / period + offset) % 1
            s = self.scale
            left, top = int((x - 30) * s), int((y - 24) * s)
            region = image[top : math.ceil((y + 10) * s), left : math.ceil((x + 65) * s)]
            yy, xx = np.mgrid[: region.shape[0], : region.shape[1]].astype("float32") / s
            xx += left / s - x
            yy += top / s - y
            pigment = region.astype("float32")
            if age < 0.45:
                u = age / 0.45
                distance = (1 - u) * 43
                crest = yy - (0.10 * xx - 2.2 * np.cos((xx - distance) * 0.094))
                amount = math.sin(math.pi * u * 0.85) ** 0.8 * np.exp(
                    -(((xx - distance - 7) / 17) ** 2) - (crest / 1.55) ** 2
                )
                sea_mask = self.water[
                    top - self.top : top - self.top + region.shape[0], left : left + region.shape[1]
                ]
                wet_paint(pigment, np.float32([236, 244, 221]), amount * sea_mask * 0.96)
            else:
                u = (age - 0.45) / 0.55
                surge = math.sin(math.pi * min(u / 0.79, 1)) ** 0.82
                plume_height = (15 + 2 * i) * surge
                reach = np.clip(-yy / (plume_height + 0.1), 0, 1)
                width = 4 + 7 * reach + 5 * u
                seam = xx - 3 * reach
                fan = np.exp(-((seam / width) ** 2)) * np.clip(1.1 - reach**2, 0, 1)
                fan *= np.clip((plume_height + yy) / (2 + s), 0, 1) * np.clip((4 - yy) / 4, 0, 1)
                dry_edge = (
                    0.65
                    + 0.16 * np.sin(1.1 * xx + 0.32 * yy)
                    + 0.13 * np.cos(0.62 * xx - 0.55 * yy)
                )
                wet_paint(pigment, np.float32([220, 234, 220]), fan * surge * dry_edge)
                mist = np.zeros(region.shape[:2], np.uint8)
                for a, b, c, d, e in self.droplets[i]:
                    flight = np.clip((u - 0.12 * d) / (0.58 + 0.22 * e), 0, 1)
                    if not 0 < flight < 1:
                        continue
                    px = (-xx[0, 0] + (a - 0.41) * (5 + 27 * flight) + 4 * flight) * s
                    py = (-yy[0, 0] - (6 + 15 * b) * 4 * flight * (1 - flight) + 2.6 * flight) * s
                    radius = (0.25 + 0.84 * c) * (1 - 0.57 * flight) * s
                    opacity = 160 * math.sin(math.pi * flight) ** 0.65 * (0.65 + 0.35 * c)
                    cv2.ellipse(
                        mist,
                        (round(px * 16), round(py * 16)),
                        (round(radius * 18), round(radius * 13)),
                        -21,
                        0,
                        360,
                        round(opacity),
                        -1,
                        cv2.LINE_AA,
                        4,
                    )
                wet_paint(pigment, np.float32([229, 238, 223]), mist.astype("float32") / 255)
                spread = 9 + 24 * u
                swash = np.exp(
                    -(((xx - 5) / spread) ** 2)
                    - ((yy - 2 - 0.6 * np.sin(0.39 * xx)) / (1.3 + 1.7 * u)) ** 2
                )
                wet_paint(pigment, np.float32([226, 238, 221]), swash * (1 - u) ** 0.78 * 0.88)
            region[:] = np.clip(pigment, 0, 255)

    def gulls(self, image, t):
        # A loose pair coasts off the headland. The near gull takes two
        # strokes and banks while its companion glides on a shallower arc.
        for n, (start, height, span, speed) in enumerate([(80, 274, 12, 37), (45, 263, 8, 33)]):
            x = start + speed * t
            y = height + 9 * math.sin(0.79 * t + n) - 3.7 * t
            bank = 0.56 + 0.30 * math.sin(0.93 * t + n)
            beat = 0.48 * math.sin(8.4 * t + n) * max(0, math.cos(1.7 * t + n)) ** 2
            near = np.array(
                [
                    [-0.08, 0],
                    [-0.42, -0.31 - beat],
                    [-1, -0.19 - beat * 1.4],
                    [-0.52, -0.13 - beat * 0.66],
                    [-0.19, 0.12],
                    [0.19, 0.065],
                    [0.32, -0.015],
                    [0.16, -0.065],
                ]
            )
            far = np.array(
                [
                    [0, 0.02],
                    [0.28, -0.28 + beat * 0.30],
                    [0.69, -0.47 + beat * 0.80],
                    [0.37, -0.15 + beat * 0.39],
                    [0.08, 0.09],
                ]
            )
            for wing, colour in [(far, (123, 132, 146)), (near, (75, 91, 108))]:
                points = wing.copy()
                points[:, 1] *= bank
                points = ((points * span + [x, y]) * self.scale * 16).round().astype("int32")
                cv2.fillPoly(image, [points], colour, lineType=cv2.LINE_AA, shift=4)

    def paint(self, background, t, rise):
        image = background.copy()
        self.sky(image, t)
        self.sea(image, t, rise)
        self.breakers(image, t)
        self.gulls(image, t)
        return image
