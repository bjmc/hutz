#!/usr/bin/env python3
"""Convert the chosen handwriting font to the woff2 the app ships.

Full charset on purpose: the editor lets people type anything, so no subsetting.
"""
import pathlib
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / ".cache" / "fonts" / "LiberationMono-Italic.ttf"
OUT = ROOT / "assets" / "fonts" / "card-italic.woff2"


def main():
    if not SRC.exists():
        sys.exit(f"missing {SRC}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font = TTFont(str(SRC))
    font.flavor = "woff2"
    font.save(str(OUT))

    check = TTFont(str(OUT))
    cmap = check.getBestCmap()
    print(f"{OUT.relative_to(ROOT)}  {OUT.stat().st_size} B  "
          f"{len(cmap)} codepoints")
    print(f"  units/em {check['head'].unitsPerEm}  "
          f"cap {check['OS/2'].sCapHeight}  "
          f"x-height {check['OS/2'].sxHeight}")


if __name__ == "__main__":
    main()
