"""Rasterize the original CoBuilders vector; see public/brand/README.md."""
from pathlib import Path
import struct
import subprocess
import sys

public = Path(__file__).resolve().parents[1] / "public"
source = public / "brand/cobuilders-mark.svg"
# Pass an absolute path to an installed @resvg/resvg-js package.
renderer = str(Path(sys.argv[1]).resolve())
render_script = """
const { Resvg } = require(process.argv[1]);
const fs = require('node:fs');
const svg = fs.readFileSync(process.argv[2]);
const size = Number(process.argv[3]);
process.stdout.write(new Resvg(svg, {
  fitTo: { mode: 'width', value: size }, background: '#000000'
}).render().asPng());
"""
# Each size renders independently from the SVG. No raster resizing occurs.
frames = {
    size: subprocess.check_output(
        ["node", "-e", render_script, renderer, str(source), str(size)]
    )
    for size in (16, 32, 48, 180, 192, 512)
}
for name, size in (
    ("favicon-16x16.png", 16),
    ("favicon-32x32.png", 32),
    ("apple-touch-icon.png", 180),
    ("android-chrome-192x192.png", 192),
    ("android-chrome-512x512.png", 512),
):
    (public / name).write_bytes(frames[size])

# Package the independently rendered PNGs in an ICO directory, without resizing.
entries = []
offset = 6 + 16 * 3
for size in (16, 32, 48):
    data = frames[size]
    entries.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
ico = struct.pack("<HHH", 0, 1, 3) + b"".join(entries)
ico += b"".join(frames[size] for size in (16, 32, 48))
for name in ("favicon.ico", "favicon-dot.ico"):
    (public / name).write_bytes(ico)

# Preserve the original path and transparent canvas; change only the mark color.
(public / "safari-pinned-tab.svg").write_text(
    source.read_text().replace('fill="white"', 'fill="#000000"')
)
