# Asset build and site tasks for the Hutz meme card.
#
# The site itself needs no Python: every generated asset and src/config.ts are
# committed, and `just build` is enough. The recipes below re-derive those
# assets from assets/source/original.jpg, which is a one-off authoring task.

python := ".venv/bin/python"

# list the recipes
default:
    @just --list

# Re-derive every committed asset from the source photo, then build the site
pipeline: assets build

# Run the whole asset pipeline in order
assets: font plate header config

# Stage 0: vendor the card typeface as a static subsetted woff2
font:
    {{python}} tools/vendor_font.py

# Stage 1: trace punctuation and remove the handwriting from the source photo
plate:
    {{python}} tools/build_assets.py

# Stage 2: erase the printed name and cut the finger mask
header:
    {{python}} tools/make_header_assets.py

# Stage 3: emit src/config.ts from the measured geometry
config:
    {{python}} tools/gen_config.py

# Build the single-file site into dist/
build:
    bun run build

# Serve with rebuild-on-request on http://localhost:5173
dev:
    bun run dev

# Type-check the TypeScript
check:
    bun run typecheck

# Remove generated output; the committed plate assets are left alone
clean:
    rm -rf dist preview/*.png
    find tools -name __pycache__ -type d -prune -exec rm -rf {} +
