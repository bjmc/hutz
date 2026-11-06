#!/usr/bin/env python3
"""Render a font/reference comparison strip at matched cap height and width.

No candidate matches the card's wide, near-monospaced advance, so tracking is
applied until the line width matches. That isolates shape and weight, which are
what we are actually choosing on.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / ".cache" / "fonts"
DEBUG = ROOT / "preview"
CAP = 29
REF = {"A": "WORKS ON", "B": "CONTINGENCY", "C": "NO MONEY DOWN"}


def ref_strip(band):
    m = cv2.imread(str(DEBUG / f"text_{band}.png"), cv2.IMREAD_GRAYSCALE)
    return (m < 128).astype(np.float32)


def glyphs(ttf, text, size):
    """Render pre-advance word with explicit per-glyph advances."""
    f = ImageFont.truetype(str(ttf), size)
    out = []
    for ch in text:
        bbox = f.getbbox(ch)
        w = max(1, bbox[2] - bbox[0])
        img = Image.new("L", (w + 20, size * 3), 255)
        ImageDraw.Draw(img).text((10 - bbox[0], size - bbox[1]), ch, font=f, fill=0)
        a = 1.0 - np.asarray(img, np.float32) / 255.0
        ys, xs = np.nonzero(a > 0.5)
        if not len(ys):
            out.append((np.zeros((1, 1), np.float32), 0))
            continue
        glyph = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out.append((glyph, glyph.shape[1]))
    return out


def size_for_cap(ttf, cap):
    size = 40
    for _ in range(15):
        f = ImageFont.truetype(str(ttf), size)
        b = f.getbbox("H")
        h = b[3] - b[1]
        if h <= 0:
            break
        if h == cap:
            return size
        size = max(8, int(round(size * cap / h)))
    return size


def compose(ttf, text, target_w, cap=CAP):
    size = size_for_cap(ttf, cap)
    gl = [(g, w) for g, w in glyphs(ttf, text, size) if g.size > 1]
    if not gl:
        return None
    ink_w = sum(w for _g, w in gl)
    track = (target_w - ink_w) / max(1, len(text) - 1)
    cap_h = max(g.shape[0] for g, _w in gl)
    canvas = np.zeros((cap_h + 4, int(target_w) + 4), np.float32)
    x = 2.0
    for ch, (g, _w) in zip(text, gl, strict=False):
        if ch != " ":
            gg = cv2.resize(g, (g.shape[1], cap_h))
            x0 = int(round(x))
            canvas[2:2 + cap_h, x0:x0 + gg.shape[1]] = \
                np.maximum(canvas[2:2 + cap_h, x0:x0 + gg.shape[1]], gg)
        x += _w + track
    return canvas


def main():
    names = sys.argv[1:] or ["Kalam", "PermanentMarker", "GochiHand"]
    rows = []
    for band, text in REF.items():
        ref = ref_strip(band)
        rows.append(("reference", band, ref))
        for n in names:
            ttf = FONTS / f"{n}.ttf"
            if not ttf.exists():
                continue
            c = compose(ttf, text, ref.shape[1])
            rows.append((n, band, c))

    scale = 2
    tiles = []
    for label, band, img in rows:
        if img is None:
            continue
        a = (1 - np.clip(img, 0, 1))
        bgr = cv2.cvtColor((a * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        bgr = cv2.resize(bgr, (bgr.shape[1] * scale, bgr.shape[0] * scale),
                         interpolation=cv2.INTER_NEAREST)
        cv2.putText(bgr, f"{label} [{band}]", (4, 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 220), 1, cv2.LINE_AA)
        tiles.append(bgr)
    w = max(t.shape[1] for t in tiles)
    tiles = [cv2.copyMakeBorder(t, 0, 6, 0, w - t.shape[1],
                                cv2.BORDER_CONSTANT, value=(210, 210, 210))
             for t in tiles]
    sheet = np.vstack(tiles)
    out = DEBUG / "font_compare.png"
    cv2.imwrite(str(out), sheet)
    print(f"wrote {out} ({sheet.shape[1]}x{sheet.shape[0]})")


if __name__ == "__main__":
    main()
