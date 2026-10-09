#!/usr/bin/env node
// Deterministic raster fixtures, drawn with bitmap glyphs: no fonts or network.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const directory = resolve(
  process.argv[2] ?? "src/__tests__/fixtures/image-rotation",
);
mkdirSync(directory, { recursive: true });
const glyphs = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [15, 16, 16, 16, 16, 16, 15],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [15, 16, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  U: [17, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31],
  3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2],
};
function raster(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  const put = (x, y, color) => {
    if (x >= 0 && y >= 0 && x < width && y < height)
      pixels.set(color, (y * width + x) * 3);
  };
  const rect = (x, y, w, h, color) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) put(xx, yy, color);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const quadrant = (x >= width / 2 ? 1 : 0) + (y >= height / 2 ? 2 : 0);
      put(
        x,
        y,
        [
          [180, 30, 40],
          [20, 140, 65],
          [35, 65, 180],
          [200, 170, 20],
        ][quadrant],
      );
    }
  function text(value, x, y, scale = 5) {
    rect(
      x - 4,
      y - 4,
      value.length * 6 * scale + 8,
      7 * scale + 8,
      [255, 255, 255],
    );
    for (const letter of value) {
      glyphs[letter].forEach((row, yy) => {
        for (let xx = 0; xx < 5; xx++)
          if (row & (1 << (4 - xx)))
            rect(x + xx * scale, y + yy * scale, scale, scale, [0, 0, 0]);
      });
      x += 6 * scale;
    }
  }
  function corners(left, top, w, h, letters, scale) {
    text(letters[0] + "1", left + 12, top + 12, scale);
    text(letters[1] + "2", left + w - 12 - 12 * scale, top + 12, scale);
    text(letters[2] + "3", left + 12, top + h - 12 - 7 * scale, scale);
    text(
      letters[3] + "4",
      left + w - 12 - 12 * scale,
      top + h - 12 - 7 * scale,
      scale,
    );
    const markers = [
      [left + 32, top + 72],
      [left + w - 32, top + 72],
      [left + 32, top + h - 72],
      [left + w - 32, top + h - 72],
    ];
    for (const [x, y] of markers) rect(x - 8, y - 8, 16, 16, [255, 255, 255]);
    return markers;
  }
  const markers = corners(0, 0, width, height, "ABCD", 5);
  // An asymmetric arrow and UP text make handedness/quarter turns obvious.
  const cx = Math.round(width * 0.72),
    cy = Math.round(height * 0.68);
  rect(cx, cy, 16, 80, [255, 255, 255]);
  for (let row = 0; row < 28; row++)
    rect(cx - row, cy + row, 16 + row * 2, 1, [255, 255, 255]);
  rect(cx + 16, cy + 60, 25, 12, [255, 255, 255]);
  text("UP", cx + 45, cy + 35, 4);
  return { width, height, pixels, corners, markers };
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const name = Buffer.from(type),
    head = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  tail.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([head, name, body, tail]);
}
function png({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scan = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    pixels.copy(
      scan,
      y * (width * 3 + 1) + 1,
      y * width * 3,
      (y + 1) * width * 3,
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scan, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const landscape = raster(1200, 600);
const crop = { left: 274, top: 120, width: 286, height: 429 };
const selectedMarkers = landscape.corners(
  crop.left,
  crop.top,
  crop.width,
  crop.height,
  "EFGH",
  3,
);
const selected = Buffer.alloc(crop.width * crop.height * 3);
for (let y = 0; y < crop.height; y++)
  landscape.pixels.copy(
    selected,
    y * crop.width * 3,
    ((y + crop.top) * landscape.width + crop.left) * 3,
    ((y + crop.top) * landscape.width + crop.left + crop.width) * 3,
  );
const images = {
  "landscape.png": landscape,
  "portrait.png": raster(600, 1200),
  "legacy.png": raster(560, 420),
  "saved-crop.png": {
    ...crop,
    pixels: selected,
    markers: selectedMarkers.map(([x, y]) => [x - crop.left, y - crop.top]),
  },
};
const manifest = {
  crop: { x: 30, y: 70, zoom: 140 },
  aspect: 2 / 3,
  region: crop,
  pendingMarkers: selectedMarkers,
  images: {},
};
for (const [name, image] of Object.entries(images)) {
  const bytes = png(image);
  writeFileSync(resolve(directory, name), bytes);
  manifest.images[name] = {
    width: image.width,
    height: image.height,
    markers: image.markers,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
writeFileSync(
  resolve(directory, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
