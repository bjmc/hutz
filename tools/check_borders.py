#!/usr/bin/env python3
"""Draw candidate card borders on the photo for visual confirmation."""
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "preview" / "cleaned-body.png"
OUT = ROOT / "preview" / "borders_check.png"

# border lines as fitted: horizontal y = m*x + b, vertical x = m*y + b
LEFT = (0.0412, 237.1)
RIGHT = (0.0517, 761.8)
TOP = (-0.2050, 318.0)
BOTTOM = (-0.2150, 725.0)

# the second line of each double rule, for reference
TOP_ALT = (-0.2113, 308.1)
BOTTOM_ALT = (-0.2314, 723.2)

# the user's hand-drawn borders, for comparison
USER = {
    "top": ((1, 227), (959, 33)),
    "bottom": ((27, 713), (959, 519)),
    "left": ((238, 0), (269, 719)),
    "right": ((758, 0), (798, 719)),
}


def inter_vh(v, h):
    mv, bv = v
    mh, bh = h
    y = (mh * bv + bh) / (1 - mh * mv)
    return (mv * y + bv, y)


def draw_line(img, m, b, colour, width=1, vertical=False):
    h, w = img.shape[:2]
    if vertical:
        cv2.line(img, (int(m * 0 + b), 0), (int(m * h + b), h), colour, width)
    else:
        cv2.line(img, (0, int(b)), (w, int(m * w + b)), colour, width)


def main():
    img = cv2.imread(str(SRC))

    # user's reference borders in green
    for p, q in USER.values():
        cv2.line(img, p, q, (0, 200, 0), 1, cv2.LINE_AA)

    # the second line of each double rule, thin magenta
    draw_line(img, TOP_ALT[0], TOP_ALT[1], (200, 0, 200), 1)
    draw_line(img, BOTTOM_ALT[0], BOTTOM_ALT[1], (200, 0, 200), 1)

    # the fitted borders in red
    draw_line(img, LEFT[0], LEFT[1], (0, 0, 255), 1, vertical=True)
    draw_line(img, RIGHT[0], RIGHT[1], (0, 0, 255), 1, vertical=True)
    draw_line(img, TOP[0], TOP[1], (0, 0, 255), 1)
    draw_line(img, BOTTOM[0], BOTTOM[1], (0, 0, 255), 1)

    corners = {
        "TL": inter_vh(LEFT, TOP), "TR": inter_vh(RIGHT, TOP),
        "BR": inter_vh(RIGHT, BOTTOM), "BL": inter_vh(LEFT, BOTTOM),
    }
    for name, p in corners.items():
        cv2.circle(img, (int(p[0]), int(p[1])), 6, (255, 0, 0), 2)
        cv2.putText(img, name, (int(p[0]) + 9, int(p[1]) - 7),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 0, 0), 2, cv2.LINE_AA)
        print(f"{name} ({p[0]:.1f}, {p[1]:.1f})")

    def d(p, q):
        return float(np.hypot(q[0] - p[0], q[1] - p[1]))

    wt, wb = d(corners["TL"], corners["TR"]), d(corners["BL"], corners["BR"])
    hl, hr = d(corners["TL"], corners["BL"]), d(corners["TR"], corners["BR"])
    print(f"width  top {wt:.1f}  bottom {wb:.1f}")
    print(f"height left {hl:.1f}  right {hr:.1f}")
    print(f"aspect {((wt + wb) / 2) / ((hl + hr) / 2):.4f}")

    h, w = img.shape[:2]
    pad, lw = 10, 210
    cv2.rectangle(img, (pad, pad), (pad + lw, pad + 86), (255, 255, 255), -1)
    cv2.rectangle(img, (pad, pad), (pad + lw, pad + 86), (0, 0, 0), 1)
    for i, (label, colour) in enumerate([
        ("red = fitted borders", (0, 0, 255)),
        ("green = your borders", (0, 160, 0)),
        ("magenta = 2nd rule of pair", (200, 0, 200)),
    ]):
        y = pad + 22 + i * 22
        cv2.line(img, (pad + 8, y - 4), (pad + 38, y - 4), colour, 2)
        cv2.putText(img, label, (pad + 44, y + 2), cv2.FONT_HERSHEY_SIMPLEX,
                    0.42, (0, 0, 0), 1, cv2.LINE_AA)

    cv2.imwrite(str(OUT), img)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
