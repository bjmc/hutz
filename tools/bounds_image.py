#!/usr/bin/env python3
"""Draw the original and maximum typesetting boxes on the photo."""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "card" / "plate.png"
OUT = ROOT / "preview" / "bounds.png"

# src/config.ts, Canvas order (a, b, c, d, e, f)
DESKEW = [0.978509, 0.206204, -0.206204, 0.978509, 29.783871, -40.773332]
ROI = (311.0, 241.0)

FIELDS = {
    "top": dict(center=196.5, half=144.5, min_x=-36.7, max_x=463.5, y0=25, y1=110),
    "bottom": dict(center=191.0, half=188.0, min_x=-51.6, max_x=443.4, y0=155, y1=195),
}

ORIGINAL = (60, 180, 75)
MAXIMUM = (40, 40, 235)
INK = (30, 30, 30)


def card_transform():
    a, b, c, d, e, f = DESKEW
    det = a * d - b * c
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    ie = (c * f - d * e) / det
    iff = (b * e - a * f) / det
    return ia, ib, ic, id_, ie + ROI[0], iff + ROI[1]


def to_photo(pts):
    a, b, c, d, e, f = card_transform()
    return [(int(round(a * x + c * y + e)), int(round(b * x + d * y + f))) for x, y in pts]


def quad(img, x0, x1, y0, y1, colour, width=1):
    pts = to_photo([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    cv2.polylines(img, [np.array(pts, np.int32)], True, colour, width, cv2.LINE_AA)
    return pts


def main():
    img = cv2.imread(str(SRC))

    for name, g in FIELDS.items():
        orig_lo, orig_hi = g["center"] - g["half"], g["center"] + g["half"]
        max_lo, max_hi = g["min_x"], g["max_x"]

        quad(img, orig_lo, orig_hi, g["y0"], g["y1"], ORIGINAL, 1)
        quad(img, max_lo, max_hi, g["y0"], g["y1"], MAXIMUM, 1)

        label = f"{name.upper()}  original {orig_lo:.0f}..{orig_hi:.0f}"
        spot = to_photo([(orig_lo, g["y0"] - 6)])[0]
        cv2.putText(img, label, (spot[0], spot[1] - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, ORIGINAL, 1, cv2.LINE_AA)
        spot = to_photo([(max_lo, g["y1"] + 13)])[0]
        cv2.putText(img, f"max {max_lo:.0f}..{max_hi:.0f}", (spot[0], spot[1] + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, MAXIMUM, 1, cv2.LINE_AA)

    crop = to_photo([(-70, 10), (460, 10), (460, 215), (-70, 215)])
    xs = [p[0] for p in crop]
    ys = [p[1] for p in crop]
    out = img[max(min(ys), 0):min(max(ys), img.shape[0]),
              max(min(xs), 0):min(max(xs), img.shape[1])]
    out = cv2.resize(out, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)

    # legend
    pad = 14
    cv2.rectangle(out, (8, 8), (300, 60), (245, 245, 245), -1)
    cv2.rectangle(out, (8, 8), (300, 60), INK, 1)
    cv2.line(out, (18, 24), (48, 24), ORIGINAL, 2)
    cv2.putText(out, "original box", (56, 29), cv2.FONT_HERSHEY_SIMPLEX, 0.42, INK, 1, cv2.LINE_AA)
    cv2.line(out, (18, 45), (48, 45), MAXIMUM, 2)
    cv2.putText(out, "maximum box (card edge)", (56, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.42, INK, 1, cv2.LINE_AA)

    cv2.imwrite(str(OUT), out)
    print(f"wrote {OUT} {out.shape[1]}x{out.shape[0]}")


if __name__ == "__main__":
    main()
