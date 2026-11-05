# CoBuilders icon source

Original vector supplied by Augusto Collerone, 2026-11-05, transparent background.
`cobuilders-mark.svg` preserves the supplied SVG unchanged. It supersedes the
previous PNG source from cobuilders.xyz / cobuilders-presentation-website.

Regenerate from the repository root with Node.js and Python 3:

```sh
npm install --prefix /tmp/cob-677-vector-tools --no-audit --no-fund @resvg/resvg-js@2.6.2
python3 apps/web/scripts/generate-brand-icons.py /tmp/cob-677-vector-tools/node_modules/@resvg/resvg-js
```

Resvg 2.6.2 renders the vector independently at 16, 32, 48, 180, 192, and 512 pixels.
The SVG's existing padding stays intact. Raster icons have a solid black background.
The Python standard library packages the 16/32/48 PNG frames into both ICO files.
No raster resizing, upscaling, or tracing occurs.

The Safari mask copies the original SVG geometry and changes white fill to black.
Its background remains transparent.
