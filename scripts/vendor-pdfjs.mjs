#!/usr/bin/env node
// Copies what pdf.js loads at run time into public/vendor/pdfjs/, so the
// reader never loads anything from another origin (eBooks sub-issue 3): the
// worker, the character maps, the standard fonts and the wasm decoders from
// Durtal's own pdfjs-dist, and the two layer stylesheets vendored with
// foliate-js (src/vendor/foliate-js/pdfjs-css/). `pnpm dev` and `pnpm build`
// run it first; it is not a postinstall step. The folder is git-ignored and
// rebuilt when the pdfjs-dist version changes.
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

const wanted = `${version}\n`;
if (existsSync(stamp) && readFileSync(stamp, "utf8") === wanted) process.exit(0);

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(pdfjs, "build/pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm"]) cpSync(join(pdfjs, dir), join(target, dir), { recursive: true });
for (const file of ["text_layer_builder.css", "annotation_layer_builder.css"]) cpSync(join(css, file), join(target, file));
cpSync(join(pdfjs, "LICENSE"), join(target, "LICENSE"));
writeFileSync(stamp, wanted);
console.log(`pdf.js ${version}: worker, cmaps, standard fonts and wasm copied to public/vendor/pdfjs/`);
