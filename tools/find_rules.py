#!/usr/bin/env python3
"""Locate the card's printed rules in deskewed card space."""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "card" / "plate.png"

# src/config.ts, Canvas order (a, b, c, d, e, f)
DESKEW = [0.978509, 0.206204, -0.206204, 0.978509, 29.783871, -40.773332]
ROI = (311.0, 241.0)

X0, Y0, W, H = -140, -60, 700, 340


def canvas_inverse(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det,
            (c * f - d * e) / det, (b * e - a * f) / det]


def card_matrix():
    """photo -> card space, i.e. deskew applied about the ROI origin."""
    a, b, c, d, e, f = DESKEW
    ox, oy = ROI
    return np.array(
        [[a, c, e - a * ox - c * oy],
         [b, d, f - b * ox - d * oy]],
        dtype=np.float64,
    )


def warp():
    m = card_matrix()
    shift = np.array([[1.0, 0.0, -X0], [0.0, 1.0, -Y0], [0.0, 0.0, 1.0]])
    full = np.vstack([m, [0.0, 0.0, 1.0]])
    plate = cv2.imread(str(SRC))
    return cv2.warpAffine(plate, (shift @ full)[:2], (W, H),
                          flags=cv2.INTER_CUBIC, borderValue=(0, 0, 0))


def runs(mask_1d, min_len):
    out, start = [], None
    for i, v in enumerate(mask_1d):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i - 1))
            start = None
    if start is not None and len(mask_1d) - start >= min_len:
        out.append((start, len(mask_1d) - 1))
    return out


def main():
    img = warp()
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # rows that are inside the card body (skip the photo background)
    paper = lum > 110
    coverage = paper.mean(1)
    body = [i for i in range(H) if coverage[i] > 0.35]
    r0, r1 = body[0], body[-1]
    print(f"card rows in view: {r0 + Y0} .. {r1 + Y0}")

    dark = lum < 110
    frac = dark[r0:r1 + 1].mean(0)

    for threshold in (0.55, 0.4):
        cols = [i + X0 for i in range(W) if frac[i] > threshold]
        print(f"columns >{threshold:.0%} dark: {runs([frac[i] > threshold for i in range(W)], 1)}")
        print("  absolute:", cols[:20], "...", cols[-20:] if len(cols) > 20 else "")

    print("\nvertical-rule profile near the left edge:")
    print([(i + X0, round(float(frac[i]), 2)) for i in range(0, 90)])
    print("\nvertical-rule profile near the right edge:")
    print([(i + X0, round(float(frac[i]), 2)) for i in range(390, W)])


if __name__ == "__main__":
    main()
