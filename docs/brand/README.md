# Brand

Source for the Mim logo. The app does **not** depend on this folder at runtime —
the shipped assets live elsewhere (see below). This is the toolkit to regenerate
them if the mark, weight, or colour ever changes.

## The mark

- Wordmark `mim OS` and the `m` app mark are the **Satoshi** glyphs,
  outlined to vector paths — no font dependency in shipped SVG.
- `OS` is set at Satoshi's x/cap ratio (**0.6757**) so its caps land on the
  `mim` x-height, one contrast step lower (`#4C4C44` on light, `#B7B5AB` on dark).
- The app icon is a true superellipse (squircle, n=5) on the 824/1024 macOS grid.

Tuning constants (weight, tracking, OS contrast, squircle) live at the top of
`generate.py`.

## Regenerate

```bash
python3 docs/brand/generate.py     # needs fonttools  → writes docs/brand/assets/*.svg
bash   docs/brand/export.sh         # needs ImageMagick + iconutil → docs/brand/dist/*
```

`assets/` and `dist/` are generated and gitignored.

## Where the shipped assets live

| Asset | Path | Wired in |
|---|---|---|
| Favicon | `public/brand/favicon.svg` | `src/renderer/index.html` |
| Header wordmark | generated asset only | Not mounted in the current Workbench shell |
| macOS dev dock icon | `resources/icon.png` | `src/main/index.ts` |
| Packaged app icon | `docs/brand/dist/mim.icns` (regenerate) | electron-builder `build.mac.icon` (when set up) |

If the logo changes: rerun both scripts, then refresh `public/brand/favicon.svg`,
`resources/icon.png`, and the inlined path data in `App.vue` from the new output.
