#!/usr/bin/env node
// Copies what pdf.js loads at run time into public/vendor/pdfjs/, so the
// reader never loads anything from another origin (eBooks sub-issue 3): the
// worker, the character maps, the standard fonts and the wasm decoders from
// Durtal's own pdfjs-dist, and the two layer stylesheets vendored with
// foliate-js (src/vendor/foliate-js/pdfjs-css/). `pnpm dev` and `pnpm build`
// run it first; it is not a postinstall step. The folder is git-ignored and
// rebuilt when the pdfjs-dist version or the patch below changes.
//
// The worker gets one patch (src/vendor/foliate-js/VENDORED.md, patch 4).
// On its first page lookup pdf.js fetches every child of the root of the
// page tree, and its last-page check then waits for all of them: in a flat
// tree (most scanned PDFs) that is one Range request per page before the
// first page shows, 300 requests for a 300-page scan. When the root's /Count
// equals its number of children, each child holds exactly one page, so the
// patch records that count instead and only the pages asked for are read.
// The patch is written against the minified worker of the pinned version:
// a version whose worker does not contain the exact text stops the copy.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const pdfjs = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(readFileSync(join(pdfjs, "package.json"), "utf8"));
const target = join(root, "public/vendor/pdfjs");
const stamp = join(target, ".version");
const css = join(root, "src/vendor/foliate-js/pdfjs-css");

const PATCH = 1;
const wanted = `${version} durtal-patch-${PATCH}\n`;
if (existsSync(stamp) && readFileSync(stamp, "utf8") === wanted) process.exit(0);

// In getPageDict: the loop that pushes the root's children (h: Kids, n: the
// node, c: its /Count, r: the kids-count cache, o: the page-dict cache)
const KIDS_PREFETCH = "n===this.toplevelPagesDict&&a instanceof Ref&&!o.has(a)&&o.put(a,s.fetchAsync(a))";
const ONE_PAGE_EACH =
  "n===this.toplevelPagesDict&&a instanceof Ref&&(h.length===c?r.has(a)||r.put(a,1):!o.has(a)&&o.put(a,s.fetchAsync(a)))";
const worker = readFileSync(join(pdfjs, "build/pdf.worker.min.mjs"), "utf8");
if (worker.split(KIDS_PREFETCH).length !== 2) {
  console.error(`pdf.js ${version}: the page-tree patch does not apply to this worker; update scripts/vendor-pdfjs.mjs`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
writeFileSync(join(target, "pdf.worker.min.mjs"), worker.replace(KIDS_PREFETCH, ONE_PAGE_EACH));
for (const dir of ["cmaps", "standard_fonts", "wasm"]) cpSync(join(pdfjs, dir), join(target, dir), { recursive: true });
for (const file of ["text_layer_builder.css", "annotation_layer_builder.css"]) cpSync(join(css, file), join(target, file));
cpSync(join(pdfjs, "LICENSE"), join(target, "LICENSE"));
writeFileSync(stamp, wanted);
console.log(`pdf.js ${version}: worker (patched), cmaps, standard fonts and wasm copied to public/vendor/pdfjs/`);
