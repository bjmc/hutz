# Asset build and site tasks for the Hutz meme card.
#
# `src/config.ts` is hand-maintained and every asset is committed, so the site
# needs only `just build`. The `plate` and `header` recipes re-derive the
# committed images from assets/source/original.jpg if that is ever needed.

python := ".venv/bin/python"

# list the recipes
default:
    @just --list

# Re-derive the committed assets from the source image, then build the site
pipeline: assets build

# Run the asset pipeline in order
assets: plate header

# Stage 1: trace punctuation and remove the handwriting from the source image
plate:
    {{python}} tools/build_assets.py

# Stage 2: erase the printed name and cut the finger mask
header:
    {{python}} tools/make_header_assets.py

# Build the single-file site into dist/
build:
    bun run build

# Measure a rendered card against assets/source/original.jpg
# usage: just compare [path/to/export.jpg]
compare path="preview/money-down.jpg":
    {{python}} tools/compare.py {{path}}

# Serve with rebuild-on-request on http://localhost:5173
dev:
    bun run dev

# Type-check the TypeScript
check:
    bun run typecheck

# Run the unit tests
test:
    bun test tests

# Remove generated output; the committed plate assets are left alone
clean:
    rm -rf dist preview/*.png
    find tools -name __pycache__ -type d -prune -exec rm -rf {} +
