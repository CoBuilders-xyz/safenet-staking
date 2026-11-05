"""Rasterize the original CoBuilders vector; see public/brand/README.md."""
from pathlib import Path
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET

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

# Safari requires a 16-unit canvas. Scale the path to preserve shape and padding.
ET.register_namespace("", "http://www.w3.org/2000/svg")
mask = ET.fromstring(source.read_text())
mask.set("width", "16")
mask.set("height", "16")
mask.set("viewBox", "0 0 16 16")
path = mask.find("{http://www.w3.org/2000/svg}path")
path.set("fill", "#000000")
path.set("transform", f"scale({16 / 346})")
(public / "safari-pinned-tab.svg").write_text(ET.tostring(mask, encoding="unicode") + "\n")
