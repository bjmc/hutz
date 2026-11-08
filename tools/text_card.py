#!/usr/bin/env python3
"""Export the printed lettering in card space, for typeface identification.

The card is photographed with perspective, so the text is skewed and slanted in
photo space. This warps the photo onto the card plane with the same homography
the app renders through, giving upright, uniformly sized lettering.

Three files are written:

- `text-card.png`    the card plane, cropped to the lettering
- `text-lines.png`   the three body lines, scaled up and thresholded
- `text-header.png`  the printed name on its own, then the same
"""
from pathlib import Path

import cv2
import numpy as np

from gen_config import CARD_H, CARD_W, MEASURED, MEASURED_HEADER, QUAD

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source" / "original.jpg"
OUT = ROOT / "preview"

SCALE = 4          # card pixels are small; WhatTheFont likes big type
PAD = 6


def to_card(img):
    src = np.array([QUAD[k] for k in ("TL", "TR", "BR", "BL")], np.float32)
    dst = np.array([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]],
                   np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (CARD_W, CARD_H),
                               flags=cv2.INTER_LANCZOS4)


def isolate(card, box):
    """Crop one measured band and render it as black on white, upscaled."""
    x0, x1 = box["x0"], box["x1"]
    cap, baseline = box["cap"], box["baseline"]
    y0 = max(0, baseline - cap - PAD)
    y1 = min(card.shape[0], baseline + PAD)
    crop = card[y0:y1, max(0, x0 - PAD):min(card.shape[1], x1 + PAD)]

    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    big = cv2.resize(grey, None, fx=SCALE, fy=SCALE,
                     interpolation=cv2.INTER_LANCZOS4)
    # paper is mottled mid-grey; a flat cut cleanly separates ink from stock
    _t, ink = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return 255 - ink


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    card = to_card(cv2.imread(str(SRC)))

    cv2.imwrite(str(OUT / "text-card.png"),
                cv2.resize(card, None, fx=SCALE, fy=SCALE,
                           interpolation=cv2.INTER_LANCZOS4))

    header = isolate(card, MEASURED_HEADER)
    cv2.imwrite(str(OUT / "text-header.png"), header)

    strips = [isolate(card, MEASURED[b]) for b in "ABC"]
    gap = 24
    width = max(s.shape[1] for s in strips)
    height = sum(s.shape[0] for s in strips) + gap * (len(strips) - 1)
    sheet = np.full((height, width), 255, np.uint8)
    y = 0
    for s in strips:
        sheet[y:y + s.shape[0], :s.shape[1]] = s
        y += s.shape[0] + gap
    cv2.imwrite(str(OUT / "text-lines.png"), sheet)

    for name, img in (("header", header), ("lines", sheet)):
        print(f"text-{name}.png  {img.shape[1]}x{img.shape[0]}")


if __name__ == "__main__":
    main()
