#!/usr/bin/env python3
"""Deskew the card ROI and separate its ink from the printed rules.

The text sits at roughly -12 deg, so an unwarped row projection smears the
lines together. Rotating until the row histogram is sharpest recovers the
baseline angle; after that the ruled lines are horizontal, long, and removable
by run length alone.
"""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = str(ROOT / "assets" / "source" / "original.jpg")

# ROI measured from the card's quad, in image pixels
ROI = (311, 241, 421, 245)

INK_LUM = 130      # below this is ink, not card stock
RULE_MIN_RUN = 90  # a horizontal ink run this long is a printed rule


def ink_from(gray):
    """Ink mask from a grayscale crop, ignoring paper tone variation."""
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, mask = cv2.threshold(blur, INK_LUM, 255, cv2.THRESH_BINARY_INV)
    return mask


def find_angle(ink, w, h):
    """Rotation that makes the text rows sharpest, in degrees.

    Sweeps the angle range the card plausibly sits at and keeps the one whose
    row projection has the most variance -- a pile-up of ink into few rows
    means the baselines are horizontal.
    """
    best, best_score = 0.0, -1.0
    for deg in np.arange(-20.0, 20.01, 0.1):
        m = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
        rot = cv2.warpAffine(ink, m, (w, h), flags=cv2.INTER_NEAREST)
        rows = rot.sum(1, dtype=np.float64)
        score = float(rows.var())
        if score > best_score:
            best, best_score = float(deg), score
    return best


def remove_rules(ink):
    """Strip the card's printed rules, returning (ink, rules).

    The rules are long horizontal runs of solid ink. Opening with a wide
    horizontal kernel keeps only those, and subtracting them leaves the
    lettering behind.
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (RULE_MIN_RUN, 1))
    rules = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel)
    rules = cv2.dilate(rules, np.ones((3, 3), np.uint8))
    return cv2.bitwise_and(ink, cv2.bitwise_not(rules)), rules
