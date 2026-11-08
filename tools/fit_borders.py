#!/usr/bin/env python3
"""Fit the card's printed border rules and derive a homography.

The card is photographed with perspective, so it is not a rectangle in the
image. Four border *lines* in general position still determine a full
homography -- even though the bottom-right corner is torn, the rules there
continue and can be intersected.

The hand-drawn borders in preview/manual-borders.jpg are used only to seed a
search band for each side; the fit itself comes from the dark rule pixels.
"""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "card" / "plate.png"
OUT = ROOT / "preview" / "borders_fit.png"

# seeds from preview/manual-borders.jpg, as (p, q) in photo pixels
SEEDS = {
    "left": ((238, 0), (269, 719)),
    "right": ((758, 0), (798, 719)),
    "top": ((1, 227), (959, 33)),
    "bottom": ((27, 713), (959, 519)),
}
BAND = 14        # px either side of the seed line to search
DARK = 150       # rule pixels are darker than the stock


def line_params(p, q):
    """Unit normal (a, b, c) with a*x + b*y + c = 0."""
    p, q = np.array(p, float), np.array(q, float)
    d = q - p
    n = np.array([-d[1], d[0]])
    n /= np.linalg.norm(n)
    return np.array([n[0], n[1], -n @ p])


def refine(gray, seed):
    """Collect dark pixels near the seed line and fit a line by PCA."""
    a, b, c = line_params(*seed)
    h, w = gray.shape
    ys, xs = np.nonzero(gray < DARK)
    dist = np.abs(a * xs + b * ys + c)
    keep = dist <= BAND
    xs, ys = xs[keep], ys[keep]
    if len(xs) < 40:
        return None, 0
    # drop the tails: the rules fade out near the card's edge
    pts = np.stack([xs, ys], 1).astype(np.float64)
    mean = pts.mean(0)
    u, s, vt = np.linalg.svd(pts - mean, full_matrices=False)
    direction = vt[0]
    # keep only points within 2.5 sigma along the line, then refit
    t = (pts - mean) @ direction
    sel = np.abs(t - t.mean()) < 2.5 * t.std()
    pts = pts[sel]
    mean = pts.mean(0)
    u, s, vt = np.linalg.svd(pts - mean, full_matrices=False)
    direction = vt[0]
    normal = np.array([-direction[1], direction[0]])
    return np.array([normal[0], normal[1], -normal @ mean]), len(pts)


def intersect(l1, l2):
    a1, b1, c1 = l1
    a2, b2, c2 = l2
    d = a1 * b2 - a2 * b1
    if abs(d) < 1e-12:
        return None
    return ((b1 * c2 - b2 * c1) / d, (c1 * a2 - c2 * a1) / d)


def point_on(l, y):
    a, b, c = l
    return (-c - b * y) / a if abs(a) > 1e-9 else None


def draw(img, lines, corners):
    out = img.copy()
    h, w = img.shape[:2]
    for name, l in lines.items():
        if l is None:
            continue
        a, b, c = l
        if abs(b) > abs(a):                       # more horizontal: param by x
            y0, y1 = int((-c - a * 0) / b), int((-c - a * w) / b)
            cv2.line(out, (0, y0), (w, y1), (0, 255, 0), 2)
        else:                                     # more vertical: param by y
            x0 = int(point_on(l, 0))
            x1 = int(point_on(l, h))
            cv2.line(out, (x0, 0), (x1, h), (0, 255, 0), 2)
    for name, p in corners.items():
        cv2.circle(out, (int(p[0]), int(p[1])), 12, (0, 0, 255), 2)
        cv2.putText(out, name, (int(p[0]) + 14, int(p[1]) - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2, cv2.LINE_AA)
    return out


def main():
    img = cv2.imread(str(SRC))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    lines = {}
    print("fitted border lines (a*x + b*y + c = 0):")
    for name, seed in SEEDS.items():
        l, n = refine(gray, seed)
        lines[name] = l
        if l is None:
            print(f"  {name:7s} FAILED")
            continue
        a, b, c = l
        if abs(a) < 1e-9:
            ang, kind = 90.0, "vertical"
        else:
            ang = np.degrees(np.arctan2(-a, b))
            kind = "vertical" if abs(ang) > 45 else "horizontal"
        print(f"  {name:7s} {a:+.4f} {b:+.4f} {c:+9.2f}   {ang:+7.2f} deg "
              f"({kind}, {n} px)")

    corners = {
        "TL": intersect(lines["top"], lines["left"]),
        "TR": intersect(lines["top"], lines["right"]),
        "BR": intersect(lines["bottom"], lines["right"]),
        "BL": intersect(lines["bottom"], lines["left"]),
    }
    print("\ncorner intersections:")
    for k, v in corners.items():
        print(f"  {k}: ({v[0]:8.2f}, {v[1]:8.2f})")

    quad = np.array([corners["TL"], corners["TR"], corners["BR"], corners["BL"]],
                    np.float32)
    side = lambda p, q: float(np.linalg.norm(np.array(p) - np.array(q)))
    top_w = side(corners["TL"], corners["TR"])
    bot_w = side(corners["BL"], corners["BR"])
    left_h = side(corners["TL"], corners["BL"])
    right_h = side(corners["TR"], corners["BR"])
    print(f"\nwidth  top {top_w:6.1f}  bottom {bot_w:6.1f}")
    print(f"height left {left_h:6.1f}  right {right_h:6.1f}")
    print(f"aspect (mean w/h) {((top_w+bot_w)/2) / ((left_h+right_h)/2):.4f}")

    out = draw(img, lines, corners)
    cv2.imwrite(str(OUT), out)
    print(f"\nwrote {OUT}")
    np.save("/tmp/card_quad.npy", quad)


if __name__ == "__main__":
    main()
