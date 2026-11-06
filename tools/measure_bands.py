#!/usr/bin/env python3
"""Measure the card's printed rules per text band, in deskewed card space."""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "card" / "plate.png"

# src/config.ts, Canvas order (a, b, c, d, e, f)
DESKEW = np.array(
    [[0.978509, -0.206204, 29.783871], [0.206204, 0.978509, -40.773332]]
)
ROI = np.array([311.0, 241.0])

# measured in the photo, centres of the green dots
CORNERS = {
    "TL": (251.6, 183.0),
    "TR": (758.5, 80.5),
    "BR": (780.3, 490.5),
    "BL": (268.5, 660.6),
}

BANDS = {"A": (29, 67), "B": (69, 110), "C": (155, 199)}
X0, Y0, W, H = -180, -120, 760, 520


def to_card(p):
    v = DESKEW @ np.array([p[0] - ROI[0], p[1] - ROI[1], 1.0])
    return np.array([v[0], v[1]])


def warp_plate():
    """photo -> card, rendered into a window offset by (X0, Y0)."""
    m = np.vstack([DESKEW, [0.0, 0.0, 1.0]])
    m[:, 2] -= np.array([DESKEW[0, :2] @ ROI, DESKEW[1, :2] @ ROI, 0.0])
    shift = np.array([[1.0, 0.0, -X0], [0.0, 1.0, -Y0], [0.0, 0.0, 1.0]])
    plate = cv2.imread(str(SRC))
    return cv2.warpAffine(plate, (shift @ m)[:2], (W, H),
                          flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0))


def edge_x(name, y):
    """x of a card edge at height y, interpolated from the labelled corners."""
    if name == "L":
        a, b = to_card(CORNERS["TL"]), to_card(CORNERS["BL"])
    else:
        a, b = to_card(CORNERS["TR"]), to_card(CORNERS["BR"])
    t = (y - a[1]) / (b[1] - a[1])
    return a[0] + t * (b[0] - a[0])


def main():
    img = warp_plate()
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    dark = lum < 140

    for name, (ya, yb) in BANDS.items():
        rows = slice(ya - Y0, yb - Y0)
        frac = dark[rows].mean(0)

        left_edge = edge_x("L", (ya + yb) / 2)
        right_edge = edge_x("R", (ya + yb) / 2)

        # the rule reads as a tall dark column; find the strongest inside the card
        lo = int(left_edge - X0) + 6
        hi = int(right_edge - X0) - 6
        seg = frac[max(lo, 0):min(hi, W)]
        best = np.argsort(seg)[::-1][:14]
        cols = sorted((int(b) + max(lo, 0) + X0, round(float(seg[b]), 2)) for b in best)

        print(f"band {name}  y {ya}..{yb}")
        print(f"  card edges   L {left_edge:7.1f}   R {right_edge:7.1f}")
        print(f"  darkest cols {cols}")


if __name__ == "__main__":
    main()
