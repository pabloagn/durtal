#!/usr/bin/env node
/** Measure decoded copies of the actual shipped Latin roman files, without a browser. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    ttfs: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.manifest || !values.ttfs || !values.output)
  throw new Error("Provide --manifest, --ttfs and --output");
const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const packageFile = resolve(
  dirname(require.resolve("@napi-rs/canvas")),
  "package.json",
);
const version = JSON.parse(readFileSync(packageFile, "utf8")).version;
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
const sample =
  "The quick brown fox jumps over the lazy dog. A quiet library holds books of every age, and each page invites another reader.";
const fonts = {};
const fontSizePx = 20;
// Every reading family the manifest ships, in manifest order.
const ids = [...new Set(manifest.files.map((face) => face.id))];
for (const id of ids) {
  const asset = manifest.files.find(
    (face) =>
      face.id === id && face.style === "roman" && face.subset === "latin",
  );
  if (!asset) throw new Error(`Missing shipped Latin roman face: ${id}`);
  const file = resolve(values.ttfs, `${id}.ttf`);
  if (!GlobalFonts.registerFromPath(file, asset.cssFamily))
    throw new Error(`The native canvas could not load ${file}`);
  const ctx = createCanvas(1, 1).getContext("2d");
  ctx.font = `normal 400 ${fontSizePx}px "${asset.cssFamily}"`;
  const widthPx = ctx.measureText(sample).width;
  if (!Number.isFinite(widthPx) || widthPx <= 0)
    throw new Error(`Invalid measured advance: ${id}`);
  fonts[id] = {
    assetPath: asset.path,
    assetSha256: asset.sha256,
    decodedTTFSha256: createHash("sha256")
      .update(readFileSync(file))
      .digest("hex"),
    widthPx,
    advanceEm: widthPx / [...sample].length / fontSizePx,
  };
}
const output = {
  sample,
  fontSizePx,
  fontWeight: 400,
  method:
    "Skia Canvas 2D measureText with HarfBuzz shaping; exact decoded shipped WOFF2",
  runtime: { node: process.versions.node, canvas: version },
  fonts,
};
writeFileSync(values.output, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));
