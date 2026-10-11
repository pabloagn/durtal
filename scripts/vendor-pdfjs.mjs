#!/usr/bin/env node
// Installed pinned assets, the established page-tree patch, and exact installed
// layer rules. Runtime URLs and provenance share the same versioned directory.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stagePdfjsAssets } from "./qa/stage-pdfjs-assets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
const target = join(root, "public/vendor/pdfjs", version);
const stamp = join(target, ".version");
const marker = join(target, "ASSETS.json");
const wanted = `${version} durtal-page-tree-1 layers-1\n`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (existsSync(stamp) && readFileSync(stamp, "utf8") === wanted && existsSync(marker)) {
  const saved = JSON.parse(readFileSync(marker, "utf8"));
  if (saved.mode === "durtal-runtime-patched" && saved.version === version &&
      saved.files.every((file) => !file.path.startsWith("/") && !file.path.split("/").includes("..") &&
        existsSync(join(target, file.path)) && hash(readFileSync(join(target, file.path))) === file.sha256))
    process.exit(0);
}

// VENDORED.md patch 4: flat root trees record one page per child instead of
// eagerly fetching every child before the first requested page can render.
const KIDS_PREFETCH = "n===this.toplevelPagesDict&&a instanceof Ref&&!o.has(a)&&o.put(a,s.fetchAsync(a))";
const ONE_PAGE_EACH = "n===this.toplevelPagesDict&&a instanceof Ref&&(h.length===c?r.has(a)||r.put(a,1):!o.has(a)&&o.put(a,s.fetchAsync(a)))";
const rawWorker = readFileSync(join(source, "build/pdf.worker.min.mjs"), "utf8");
if (rawWorker.split(KIDS_PREFETCH).length !== 2)
  throw new Error(`pdf.js ${version}: the page-tree patch does not apply exactly once`);

// Keep each installed top-level layer rule, including its nested selectors and
// font-size transforms. Viewer-shell styles do not belong inside a page iframe.
function layerRule(css, selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`Missing installed layer rule: ${selector}`);
  const opening = css.indexOf("{", start);
  let depth = 1;
  let quote = null;
  let comment = false;
  for (let i = opening + 1; i < css.length; i++) {
    const char = css[i];
    if (comment) {
      if (char === "*" && css[i + 1] === "/") { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && css[i + 1] === "*") { comment = true; i++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return css.slice(start + 1, i + 1);
  }
  throw new Error(`Unterminated installed layer rule: ${selector}`);
}
const viewerBytes = readFileSync(join(source, "web/pdf_viewer.css"));
const viewerCss = viewerBytes.toString("utf8");
const layers = `/* Copyright Mozilla Foundation. Apache-2.0; see LICENSE.\n * Installed pdf.js ${version}, web/pdf_viewer.css SHA-256 ${hash(viewerBytes)}.\n */\n${[".textLayer", ".textLayerImages", ".annotationLayer"].map((selector) => layerRule(viewerCss, selector)).join("\n\n")}\n`;
const worker = rawWorker.replace(KIDS_PREFETCH, ONE_PAGE_EACH);
// All transformations are validated before staging publishes any assets.
const { manifest } = stagePdfjsAssets({ source, destination: target });
writeFileSync(join(target, "pdf.worker.min.mjs"), worker);
writeFileSync(join(target, "layers.css"), layers);
const files = manifest.files.map((file) => file.path === "pdf.worker.min.mjs"
  ? { ...file, upstreamSha256: file.sha256, sha256: hash(worker), size: Buffer.byteLength(worker), transform: "durtal-page-tree-1" }
  : file);
files.push({ path: "layers.css", source: "web/pdf_viewer.css", upstreamSha256: hash(viewerBytes), sha256: hash(layers), size: Buffer.byteLength(layers), transform: "installed-layer-rules-1" });
writeFileSync(marker, `${JSON.stringify({ ...manifest, mode: "durtal-runtime-patched", files }, null, 2)}\n`);
writeFileSync(stamp, wanted);
console.log(`pdf.js ${version}: versioned worker, decoders, ICCs, fonts and installed layer CSS staged`);
