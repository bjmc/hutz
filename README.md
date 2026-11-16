# Hutz

Hutz is a single-serve site that lets users make edits of this meme. It's accessible at https://hutz.craxz.com

![](./original.jpg)

## Dev notes

Tools:

- [Bun](https://bun.sh/), for JS runtime
- [Just](https://github.com/casey/just), for orchestration.
- Python, used only for bootstraping scripts, scraping assets out of the original screencap.

Developing:

```shell
just check # lint + typecheck
just test
just compare # Compares text formatting against original.jpg (needs Python)
just dev # Runs a test server on http://localhost:5173
just build # Outputs single static file dist/index.html
```

