#!/usr/bin/env python3
"""Fetch candidate handwriting fonts for the font bake-off.

Downloads TTFs into .cache/fonts so nothing is vendored until a winner is
chosen.
"""
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / ".cache" / "fonts"
BASE = "https://raw.githubusercontent.com/google/fonts/main"

CANDIDATES = {
    "PermanentMarker": "apache/permanentmarker/PermanentMarker-Regular.ttf",
    "RockSalt": "apache/rocksalt/RockSalt-Regular.ttf",
    "ArchitectsDaughter": "ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf",
    "PatrickHand": "ofl/patrickhand/PatrickHand-Regular.ttf",
    "Caveat": "ofl/caveat/Caveat%5Bwght%5D.ttf",
    "Kalam": "ofl/kalam/Kalam-Regular.ttf",
    "GochiHand": "ofl/gochihand/GochiHand-Regular.ttf",
    "Handlee": "ofl/handlee/Handlee-Regular.ttf",
    "ComingSoon": "ofl/comingsoon/ComingSoon-Regular.ttf",
    "Schoolbell": "apache/schoolbell/Schoolbell-Regular.ttf",
    "JustAnotherHand": "apache/justanotherhand/JustAnotherHand-Regular.ttf",
    "NothingYouCouldDo": "ofl/nothingyoucoulddo/NothingYouCouldDo.ttf",
    "ShadowsIntoLight": "ofl/shadowsintolight/ShadowsIntoLight-Regular.ttf",
    "ReenieBeanie": "ofl/reeniebeanie/ReenieBeanie.ttf",
    "Bangers": "ofl/bangers/Bangers-Regular.ttf",
    "DidactGothic": "ofl/didactgothic/DidactGothic-Regular.ttf",
}


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    ok, fail = 0, []
    for name, rel in CANDIDATES.items():
        out = DEST / f"{name}.ttf"
        if out.exists() and out.stat().st_size > 2000:
            ok += 1
            continue
        try:
            req = urllib.request.Request(f"{BASE}/{rel}",
                                         headers={"User-Agent": "hutz/1.0"})
            with urllib.request.urlopen(req, timeout=25) as r:
                out.write_bytes(r.read())
            ok += 1
        except (urllib.error.URLError, OSError) as e:
            fail.append((name, str(e)[:60]))
    print(f"{ok}/{len(CANDIDATES)} available in {DEST}")
    for n, e in fail:
        print(f"  fail {n}: {e}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
