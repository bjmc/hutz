#!/usr/bin/env python3
"""Overlay the drawing zones on the photo, using the app's own card transform."""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "card" / "plate.png"
OUT = ROOT / "preview" / "zones.png"

# exactly src/config.ts: Canvas order (a, b, c, d, e, f)
DESKEW = [0.978509, 0.206204, -0.206204, 0.978509, 29.783871, -40.773332]
ROI = (311.0, 241.0)

BANDS = [("A", 78, 310, 30, 59), ("B", 52, 341, 29, 102), ("C", 3, 379, 28, 187)]
MAX_X0, MAX_X1 = 10, 408


def canvas_inverse(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det,
            (c * f - d * e) / det, (b * e - a * f) / det]


def card_transform():
    """Same as Renderer.cardTransform: undo the deskew, then shift into the ROI."""
    a, b, c, d, e, f = canvas_inverse(DESKEW)
    return [a, b, c, d, e + ROI[0], f + ROI[1]]


def to_photo(pts):
    a, b, c, d, e, f = card_transform()
    return [(int(round(a * x + c * y + e)), int(round(b * x + d * y + f))) for x, y in pts]


def box(img, x0, y0, x1, y1, colour):
    quad = np.array(to_photo([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]), np.int32)
    cv2.polylines(img, [quad], True, colour, 1, cv2.LINE_AA)
    return quad


def main():
    img = cv2.imread(str(SRC))

    top = 59 - 30 - 4
    bottom = 187 + 8 + 4
    box(img, MAX_X0, top, MAX_X1, bottom, (30, 30, 230))       # max drawing area
    for _, x0, x1, cap, baseline in BANDS:                      # original bands
        box(img, x0, baseline - cap - 4, x1, baseline + 8, (30, 190, 30))

    corner = to_photo([(0, 0), (421, 0), (421, 245), (0, 245)])
    xs = [p[0] for p in corner]
    ys = [p[1] for p in corner]
    crop = img[max(min(ys) - 15, 0):min(max(ys) + 15, img.shape[0]),
               max(min(xs) - 15, 0):min(max(xs) + 15, img.shape[1])]
    scale = max(1, 1100 // max(crop.shape[1], 1))
    crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(OUT), crop)
    print("ROI quad on photo:", corner)
    print("wrote", OUT, crop.shape[1], "x", crop.shape[0], "scale", scale)


if __name__ == "__main__":
    main()
