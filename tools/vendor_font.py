#!/usr/bin/env python3
"""Vendor the card typeface as a static, subsetted woff2.

The printed card's ink density matches EB Garamond at wght 500; the Bold the
app used to ship was about 17% heavier. The upstream variable font is
instantiated at that weight and cut down to the characters an editor can
produce, which takes the asset from ~141 kB to ~9 kB.

The charset is what a user can reasonably type -- printable ASCII, Latin-1 and
common typographic marks -- not just the glyphs the default meme happens to
use, because the fields accept arbitrary text.
"""
import pathlib
import sys
import urllib.request

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / ".cache" / "fonts" / "EBGaramond[wght].ttf"
OUT = ROOT / "assets" / "fonts" / "card-font.woff2"
URL = ("https://github.com/google/fonts/raw/main/ofl/ebgaramond/"
       "EBGaramond%5Bwght%5D.ttf")

WEIGHT = 500

# A fixed timestamp for head.modified, so rebuilding the font is reproducible.
# 2017-01-01T00:00:00Z, close to the font's own creation date.
SOURCE_DATE_EPOCH = 3786912000

# printable ASCII, Latin-1, hyphens/dashes, quotes, ellipsis, guillemets, euro
CHARS = (
    "".join(map(chr, range(0x20, 0x7F)))
    + "".join(map(chr, range(0xA0, 0x100)))
    + "".join(map(chr, [*range(0x2010, 0x2016), 0x2018, 0x2019, 0x201A,
                        0x201C, 0x201D, 0x2026, 0x2039, 0x203A, 0x20AC]))
)


def source() -> pathlib.Path:
    if SRC.exists():
        return SRC
    SRC.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {URL}")
    with urllib.request.urlopen(URL) as r, SRC.open("wb") as f:
        f.write(r.read())
    return SRC


def main() -> None:
    font = TTFont(str(source()))
    if "fvar" not in font:
        sys.exit(f"{SRC} is not the variable font")

    if WEIGHT is not None:
        font = instantiateVariableFont(font, {"wght": WEIGHT}, inplace=False)

    have = font.getBestCmap()
    text = "".join(sorted({c for c in CHARS if ord(c) in have}))
    missing = sorted({c for c in CHARS if ord(c) not in have})

    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.layout_features = ["kern", "liga", "calt"]
    subset = Subsetter(options=opts)
    subset.populate(text=text)
    subset.subset(font)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # fontTools stamps head.modified with the wall clock on save, which would
    # rewrite the file on every build even when nothing about the font changed.
    # Pin it so the vendored asset is byte-identical run to run.
    font.recalcTimestamp = False
    font["head"].modified = SOURCE_DATE_EPOCH
    font.flavor = "woff2"
    font.save(str(OUT))

    check = TTFont(str(OUT))
    cmap = check.getBestCmap()
    size = OUT.stat().st_size
    print(f"{OUT.relative_to(ROOT)}  {size} B ({size / 1024:.1f} KiB)  "
          f"{len(cmap)} codepoints  wght {WEIGHT}")
    print(f"  units/em {check['head'].unitsPerEm}  "
          f"cap {check['OS/2'].sCapHeight}  "
          f"x-height {check['OS/2'].sxHeight}")
    if missing:
        print(f"  not in the source font, skipped: {''.join(missing)}")


if __name__ == "__main__":
    main()
