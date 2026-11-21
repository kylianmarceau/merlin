"""Rippled water, hanging falls and a small Norwegian fishing cutter.

The art-direction coordinates follow the 900-pixel-wide study. The viewpoint
and shoreline stay registered to both the polar-night and dawn paintings.
"""

import math

import cv2
import numpy as np
from PIL import Image, ImageDraw


RIDGE = [
    (0, -8),
    (103, -8),
    (116, 31),
    (136, 44),
    (151, 40),
    (168, 67),
    (181, 90),
    (194, 83),
    (207, 99),
    (221, 138),
    (241, 165),
    (262, 159),
    (278, 170),
    (308, 157),
    (329, 151),
    (342, 194),
    (363, 246),
    (383, 254),
    (419, 249),
    (433, 263),
    (447, 260),
    (466, 285),
    (483, 285),
    (505, 297),
    (527, 319),
    (558, 306),
    (570, 305),
    (588, 281),
    (605, 273),
    (628, 249),
    (645, 250),
    (657, 239),
    (673, 245),
    (684, 209),
    (698, 156),
    (718, 118),
    (747, 99),
    (777, 83),
    (801, 50),
    (825, -3),
    (900, -8),
]
BANK = [
    (0, 381),
    (58, 379),
    (103, 377),
    (145, 374),
    (173, 368),
    (217, 367),
    (247, 361),
    (254, 355),
    (385, 352),
    (532, 350),
    (617, 351),
    (621, 356),
    (760, 357),
    (789, 358),
    (900, 359),
]


def skyline(base):
    h, w = base.shape[:2]
    k = w / 900
    y, x = np.ogrid[:h, :w]
    a, b = np.array(RIDGE).T
    delta = np.interp(x[0] / k, a, b) * k - y
    # Within a narrow band, segment snow and rock from sky by pigment.
    # Hard seeds above and below prevent the segmentation crossing the fjord.
    labels = np.where(delta > 0, cv2.GC_PR_FGD, cv2.GC_PR_BGD).astype("uint8")
    labels[delta > 11 * k] = cv2.GC_FGD
    labels[delta < -11 * k] = cv2.GC_BGD
    bg, fg = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.setRNGSeed(325)
    cv2.grabCut(base, labels, None, bg, fg, 2, cv2.GC_INIT_WITH_MASK)
    return cv2.GaussianBlur((labels % 2).astype("float32"), (3, 3), 0.66)


def cutter():
    # A half-decked wooden hull, with foremast, wheelhouse and an open stern.
    # Draw at double resolution for the slender rigging and broken paint edge.
    k = 2
    sheet = Image.new("RGBA", (120 * k, 70 * k))
    pen = ImageDraw.Draw(sheet)

    def poly(points, colour):
        pen.polygon([(x * k, y * k) for x, y in points], fill=colour)

    def line(points, colour, width=1):
        pen.line([(x * k, y * k) for x, y in points], fill=colour, width=round(width * k))

    line([(14, 48), (39, 9), (47, 45)], "#91a4ad", 0.65)
    line([(40, 9), (90, 48)], "#84939a", 0.68)
    line([(39, 45), (39, 7)], "#a38568", 1.6)
    poly([(39, 8), (50, 10), (44, 13), (40, 12)], "#cb795a")
    poly([(40, 28), (53, 28), (51, 31), (40, 30)], "#436375")
    poly([(45, 48), (48, 33), (64, 31), (71, 34), (73, 48)], "#c8b9a4")
    poly([(44, 33), (49, 30), (64, 29), (72, 32), (70, 35), (49, 34)], "#42545d")
    poly([(48, 36), (54, 35), (53, 41), (47, 42)], "#d8a15a")
    poly([(56, 35), (63, 35), (64, 41), (56, 41)], "#f4c97c")
    poly([(66, 35), (70, 36), (71, 41), (66, 41)], "#496475")
    poly([(60, 30), (60, 24), (64, 24), (65, 30)], "#454b52")
    line([(82, 47), (83, 35), (99, 38), (99, 48)], "#747d78", 1.2)
    poly(
        [
            (5, 45),
            (24, 49),
            (46, 49),
            (78, 47),
            (108, 45),
            (105, 52),
            (86, 57),
            (37, 59),
            (21, 56),
            (11, 51),
        ],
        "#302f3b",
    )
    poly(
        [(6, 45), (28, 48), (62, 48), (108, 44), (106, 48), (85, 52), (28, 54), (13, 51)], "#a34f40"
    )
    line([(7, 45), (27, 48), (54, 48), (79, 46), (106, 44)], "#dbbca0", 1.3)
    line([(24, 54), (48, 56), (85, 53)], "#615460", 1)
    line([(48, 44), (62, 43)], "#eee2ba", 1)
    # Dry flecks of grain stay attached to the timber as the hull pitches.
    rgba = np.asarray(sheet).copy()
    rng = np.random.default_rng(821)
    grain = rng.normal(0, 5, rgba.shape[:2])
    rgba[:, :, :3] = np.clip(rgba[:, :, :3] + grain[:, :, None], 0, 255)
    return cv2.resize(rgba, (120, 70), interpolation=cv2.INTER_AREA)


class Fjord:
    def __init__(self, base):
        h, w = base.shape[:2]
        self.k = k = w / 900
        self.horizon = 349 * k
        self.top = int(self.horizon)
        self.y, self.x = np.mgrid[self.top : h, :w].astype("float32")
        a, b = np.array(BANK).T
        shore = np.interp(self.x[0] / k, a, b) * k
        self.mask = np.clip((self.y - shore) / 2, 0, 1).astype("float32")
        self.clearance = np.clip((self.y - shore) / 16, 0, 1).astype("float32")
        self.depth = np.maximum(0, (self.y - self.horizon) / (h - self.horizon))
        self.phase = (
            24 * np.log1p(4 * self.depth)
            + 0.004 * self.x
            + 0.65 * np.sin(0.009 * self.x + 0.011 * self.y)
        )
        self.sprite = cutter()
        self.fall_top = math.floor(132 * k)
        self.fall_left = math.floor(761 * k)
        self.fall_slice = np.s_[
            self.fall_top : math.ceil(361 * k), self.fall_left : math.ceil(835 * k)
        ]
        fy, fx = np.mgrid[self.fall_slice].astype("float32") / k
        self.fy, self.fx = fy, fx
        trace = [
            (132, 819),
            (146, 810),
            (171, 807),
            (217, 803),
            (252, 799),
            (268, 793),
            (292, 788),
            (324, 785),
            (348, 782),
            (356, 782),
        ]
        a, b = np.array(trace).T
        center = np.interp(fy[:, 0], a, b).astype("float32")[:, None]
        self.cross = fx - center
        field = base[self.fall_slice].astype("float32")
        value = cv2.cvtColor(field, cv2.COLOR_RGB2GRAY)
        # Clip streaks to the existing white brushwork, including its bends.
        self.fall_mask = (
            np.exp(-((self.cross / (3.3 + 0.025 * (fy - 132))) ** 4))
            * np.clip((value - 51) / 100, 0, 1)
            * np.clip((fy - 132) / 4, 0, 1)
            * np.clip((355 - fy) / 3, 0, 1)
        ).astype("float32")
        self.grain = cv2.cvtColor(base[self.top :], cv2.COLOR_RGB2GRAY).astype("float32")
        self.grain -= cv2.GaussianBlur(self.grain, (0, 0), 2)

    def waterfall(self, image, t):
        y, x = self.fy, self.fx
        z = np.maximum(0, (y - 132) / 221)
        # Increasing distance per unit phase accelerates a thread downhill.
        phase = 24 * np.sqrt(z + 0.018) - 4.5 * t
        veins = np.sin(phase * 2.8 + self.cross * 0.49) + 0.47 * np.sin(
            phase * 5.3 - self.cross * 0.74
        )
        region = image[self.fall_slice]
        region += (np.float32([202, 233, 240]) - region) * (self.fall_mask * (0.18 + 0.34 * veins))[
            ..., None
        ]
        gust = 0.5 + 0.5 * math.sin(3 * t)
        spray = np.exp(
            -(((x - 782 - 4 * gust) / (9 + 3 * gust)) ** 2) - ((y - 352) / (4 + 3 * gust)) ** 2
        )
        droplets = (
            0.66
            + 0.2 * np.sin(0.9 * x - 0.93 * y + 3.7 * t)
            + 0.14 * np.cos(0.44 * x + 0.8 * y + 2.5 * t)
        )
        region += (np.float32([197, 222, 230]) - region) * (spray * droplets * 0.69)[..., None]

    def water(self, image, light, t, night):
        d = self.depth
        a = self.phase - 2.8 * t
        b = 1.75 * self.phase - 0.013 * self.x - 4.1 * t + 0.57 * np.sin(0.019 * self.x + 0.7 * t)
        p, q = np.sin(a), np.sin(b)
        swell = (p + 0.38 * q) * self.clearance
        # Flow and highlight width grow towards the viewer. A second train
        # cuts obliquely through the longer swells and splits the reflections.
        dx = (2 + 8 * d) * swell
        dy = (0.55 + 3.7 * d) * (np.cos(a) + 0.29 * q) * self.clearance
        original = image[self.top :]
        wet = cv2.remap(
            original,
            self.x + dx,
            self.y - self.top + dy,
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        crest = np.maximum(0, 0.72 * p + 0.36 * q) ** 3
        face = np.maximum(0, -swell) * (0.043 + 0.078 * d)
        wet *= 1 - face[..., None]
        broken = np.clip(
            0.53
            + 0.28 * np.sin(0.027 * self.x + 0.35 * t)
            + 0.18 * np.cos(0.017 * self.y - 0.013 * self.x)
            + 0.021 * self.grain,
            0.12,
            1,
        )
        wet += (np.float32([108, 181, 188]) - wet) * (crest * broken * (0.14 + 0.39 * d))[..., None]
        # Sample the same masked aurora that illuminated the sky in this
        # frame. The two-dimensional surface normal bends its reflected rays.
        # Smaller capillary ripples break the mirrored light into lateral
        # brushstrokes within each swell. Their scale opens in perspective.
        micro = np.sin(
            5.7 * self.phase + 0.016 * self.x - 6.3 * t + 0.82 * np.sin(b)
        ) + 0.53 * np.sin(10.4 * self.phase - 0.021 * self.x - 8.7 * t)
        ray_x = self.x + (17 + 39 * d) * swell + (6 + 22 * d) * micro
        ray_y = (
            self.horizon
            - (self.y - self.horizon) * 1.23
            + (7 + 31 * d) * (p + 0.64 * q + 0.71 * micro)
        )
        reflection = cv2.remap(
            light, ray_x, ray_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )
        reflection = cv2.GaussianBlur(reflection, (13, 3), 3.8, 0.65)
        glints = 0.76 + 0.20 * np.tanh(2.4 * micro + 0.12 * self.grain)
        wet += reflection * (night * glints * (0.45 + 0.54 * broken + 0.34 * crest))[..., None]
        # The foot of the falls sends flattened rings out over the fjord.
        dist = np.hypot((self.x / self.k - 782) * 0.59, (self.y / self.k - 357) * 2.8)
        rings = np.maximum(0, np.cos(dist * 0.42 - t * 4)) ** 5 * np.exp(-dist / 23)
        wet += (np.float32([173, 209, 218]) - wet) * (rings * 0.52)[..., None]
        original += (wet - original) * self.mask[..., None]

    def boat(self, image, t, night):
        # A left-facing cutter steams towards the cabins. At this distance a
        # six-second crossing reads as a gentle run under power.
        k = self.k
        bx = (671 - 21 * t) * k
        by = (432 - 1.8 * t + 0.77 * math.sin(3.4 * t)) * k
        scale = 0.60 * k
        # A late section of the wake stays wider and outlives the stern.
        a, b = round(bx + 34 * scale), round(by - 15 * k)
        wake = image[b : b + round(33 * k), a : a + round(144 * k)]
        wy, wx = np.mgrid[: wake.shape[0], : wake.shape[1]].astype("float32") / k
        wy += (b - by) / k
        spread = 1.2 + wx * 0.09
        ridge = np.abs(wy - 0.035 * wx) - spread
        ripple = np.cos(0.45 * wx + 2.6 * t + 0.30 * wy)
        foam = np.exp(-((ridge / (1.0 + 0.014 * wx)) ** 2)) * (0.62 + 0.36 * ripple)
        churn = np.exp(-((wy / (2 + wx * 0.036)) ** 2)) * np.exp(-wx / 19)
        weight = (foam * 0.80 + churn * 0.57) * np.exp(-wx / 60) * np.clip(wx / 2, 0, 1)
        wake += (np.float32([174, 213, 210]) - wake) * weight[..., None]
        # Rotate about the waterline. Reuse the transformed cutout for the
        # broken reflection so cabin, rigging and hull stay in register.
        angle = 2.3 * math.sin(2.8 * t + 0.8) + 1.1 * math.sin(4.1 * t)
        matrix = cv2.getRotationMatrix2D((55, 56), angle, scale)
        radius = round(66 * scale)
        matrix[:, 2] += np.array([radius - 55, radius - 56])
        sprite = cv2.warpAffine(
            self.sprite, matrix, (2 * radius, 2 * radius), flags=cv2.INTER_LINEAR
        )
        cx, cy = round(bx), round(by)
        reflection = sprite[: radius + 1][::-1]
        refl = cv2.resize(
            reflection, (2 * radius, round(radius * 0.53)), interpolation=cv2.INTER_AREA
        )
        ry, rx = np.mgrid[: refl.shape[0], : refl.shape[1]].astype("float32")
        refl = cv2.remap(refl, rx + 2.8 * np.sin(ry * 0.65 - 3 * t), ry, cv2.INTER_LINEAR)
        region = image[cy : cy + refl.shape[0], cx - radius : cx + radius]
        opacity = refl[..., 3] / 255 * (0.17 + 0.22 * (0.5 + 0.5 * np.cos(ry * 0.92 - 3.1 * t)))
        region += (refl[..., :3] - region) * opacity[..., None]
        region = image[cy - radius : cy + radius, cx - radius : cx + radius]
        region += (sprite[..., :3] * (1 - 0.10 * night) - region) * (sprite[..., 3:4] / 255)
