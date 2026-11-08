# Asset build and site tasks for the Hutz meme card.
#
# The asset pipeline runs in order, each stage consuming the last one's output:
#   original.jpg -> cleaned-body.png -> plate.jpg + fingers.png -> config.ts

python := ".venv/bin/python"

# list the recipes
default:
    @just --list

# Build everything: assets from the source photo, then the site bundle
build: assets site

# Run the whole asset pipeline in order
assets: plate header config

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
site:
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
