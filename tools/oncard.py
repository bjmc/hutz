#!/usr/bin/env python3
"""Render candidate text onto the real card, at the measured geometry.

This is the honest test: the glyphs have to sit on the card's baseline, at its
cap height, with its word spacing, under its perspective skew.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_assets import BANDS, ROI, handwriting_mask, segmentation  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / ".cache" / "fonts"
DEBUG = ROOT / "preview"
CAP = 30                   # measured cap heights: A 30, B 29, C 28
WORD_SPACE = 0.83          # multiples of cap height, measured from the card
LINE_TEXT = {
    "A": "WORKS ON",
    "B": "CONTINGENCY",
    "C": "NO MONEY DOWN",
}
# measured dark-ink extents in deskewed space: x0, x1 (exclusive), baseline
LINE_BOX = {
    "A": (78, 310, 59),
    "B": (52, 341, 102),
    "C": (3, 379, 187),
}


def size_for_cap(ttf, cap):
    size = 40
    for _ in range(18):
        f = ImageFont.truetype(str(ttf), size)
        b = f.getbbox("H")
        h = b[3] - b[1]
        if h <= 0:
            break
        if h == cap:
            return size
        size = max(8, int(round(size * cap / h)))
    return size


def render_line(ttf, text, target_w, cap=CAP):
    """Render one line on a shared baseline, tracking to hit `target_w`.

    Glyphs keep their natural proportions -- only their horizontal advance is
    adjusted -- so overshoot and stroke weight stay as the font intended.
    """
    size = size_for_cap(ttf, cap)
    f = ImageFont.truetype(str(ttf), size)
    asc, desc = f.getmetrics()
    base = asc + 4
    pad = 32

    glyphs = []
    for ch in text:
        if ch == " ":
            glyphs.append((None, int(round(cap * WORD_SPACE)), 0))
            continue
        bbox = f.getbbox(ch)
        img = Image.new("L", (max(1, bbox[2] - bbox[0]) + 2 * pad,
                              asc + desc + 8), 255)
        ImageDraw.Draw(img).text((pad, base), ch, font=f, fill=0,
                                 anchor="ls")
        a = 1.0 - np.asarray(img, np.float32) / 255.0
        ys, xs = np.nonzero(a > 0.5)
        if not len(ys):
            glyphs.append((None, int(round(cap * 0.5)), 0))
            continue
        g = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        glyphs.append((g, g.shape[1], int(ys.min())))

    tops = [t for g, _w, t in glyphs if g is not None]
    top = min(tops)
    bot = max(t + g.shape[0] for g, _w, t in glyphs if g is not None)
    ch_h = bot - top

    ink_w = sum(w for g, w, _t in glyphs if g is not None)
    n_gaps = max(1, len(glyphs) - 1)
    track = (target_w - ink_w) / n_gaps

    canvas = np.zeros((ch_h, max(1, int(round(target_w))), 3), np.float32)
    x = 0.0
    for g, w, t in glyphs:
        if g is not None:
            y0 = t - top
            x0 = int(round(x))
            x1 = min(canvas.shape[1], x0 + g.shape[1])
            if x0 < canvas.shape[1] and x1 > x0:
                sl = canvas[y0:y0 + g.shape[0], x0:x1]
                canvas[y0:y0 + g.shape[0], x0:x1] = np.maximum(
                    sl, g[:, :x1 - x0, None])
        x += w + track
    return canvas, base - top


def main():
    names = sys.argv[1:] or ["LiberationMono-Italic", "NimbusMonoPS-Italic",
                             "Kalam"]
    img, _roi, colour, ink, angle, _M = segmentation()
    _ = handwriting_mask(ink, colour)  # keep segmentation order identical

    for name in names:
        ttf = FONTS / f"{name}.ttf"
        if not ttf.exists():
            ttf = FONTS / f"{name}.otf"
        if not ttf.exists():
            print(f"skip {name}")
            continue

        frame = colour.copy()
        ink_rgb = np.array([38, 39, 52], np.float32) / 255.0  # BGR of card ink
        for band, _y0, _y1, _f, _t, _below in BANDS:
            x0, x1, baseline = LINE_BOX[band]
            strip, up = render_line(ttf, LINE_TEXT[band], x1 - x0)
            h, w = strip.shape[:2]
            top = baseline - up
            x1 = min(frame.shape[1], x0 + w)
            for c in range(3):
                dst = frame[top:top + h, x0:x1, c].astype(np.float32)
                a = np.clip(strip[:, :x1 - x0, c], 0.0, 1.0)
                frame[top:top + h, x0:x1, c] = \
                    (dst * (1 - a) + ink_rgb[c] * 255.0 * a).astype(np.uint8)

        # warp the card back into the photo's own ROI space
        inv = cv2.invertAffineTransform(_M)
        x, y, w, h = ROI
        back = cv2.warpAffine(frame, inv, (w, h))
        out = img.copy()
        out[y:y + h, x:x + w] = back
        path = DEBUG / f"oncard_{name}.png"
        cv2.imwrite(str(path), out)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
