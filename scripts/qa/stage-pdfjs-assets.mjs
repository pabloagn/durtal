#!/usr/bin/env node
// SLN-502 preparation only: exact installed assets plus reproducible SHA evidence.
// This does not replace scripts/vendor-pdfjs.mjs or change runtime asset URLs.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(ROOT, "package.json"));
const PINNED_VERSION = "6.4.299";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function* directoryFiles(source, directory) {
  for (const entry of readdirSync(join(source, directory), {
    withFileTypes: true,
  }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) yield* directoryFiles(source, path);
    else if (entry.isFile()) yield path;
    else throw new Error(`Unexpected non-file pdf.js asset: ${path}`);
  }
}

/** Source-bound copies; all assets stay untouched, including the raw worker. */
export function stagePdfjsAssets({ source, destination }) {
  const packageBytes = readFileSync(join(source, "package.json"));
  const { version } = JSON.parse(packageBytes.toString("utf8"));
  const apiBytes = readFileSync(join(source, "build/pdf.mjs"));
  const apiVersion = /^const version = "([^"]+)";$/m.exec(
    apiBytes.toString("utf8"),
  )?.[1];
  if (version !== PINNED_VERSION || apiVersion !== version)
    throw new Error(
      "Installed pdf.js package/API version must both be 6.4.299",
    );

  const paths = ["build/pdf.worker.min.mjs", "LICENSE", "web/pdf_viewer.css"];
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    if (!existsSync(join(source, directory)))
      throw new Error(`Missing installed pdf.js asset directory: ${directory}`);
    paths.push(...directoryFiles(source, directory));
  }
  // Read and hash first: a missing source fails before publishing anything.
  const copies = paths
    .map((path) => {
      const bytes = readFileSync(join(source, path));
      const target =
        path === "build/pdf.worker.min.mjs"
          ? "pdf.worker.min.mjs"
          : path === "web/pdf_viewer.css"
            ? "pdf_viewer.css"
            : path;
      return {
        bytes,
        source: path,
        path: target,
        size: bytes.length,
        sha256: hash(bytes),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = {
    v: 1,
    version,
    apiVersion,
    mode: "installed-unpatched-staging",
    base: `/vendor/pdfjs/${version}/`,
    sourcePackage: { path: "package.json", sha256: hash(packageBytes) },
    sourceApi: { path: "build/pdf.mjs", sha256: hash(apiBytes) },
    // The established worker patch and layer-CSS extraction remain integration work.
    files: copies.map(({ bytes: _bytes, ...entry }) => entry),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(destination, { recursive: true });
  const marker = join(destination, "ASSETS.json");
  if (existsSync(marker)) unlinkSync(marker);
  for (const copy of copies) {
    const target = join(destination, copy.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, copy.bytes);
    if (hash(readFileSync(target)) !== copy.sha256)
      throw new Error(`Staged asset checksum differs: ${copy.path}`);
  }
  writeFileSync(join(destination, "VERSION"), `${version}\n`);
  // Publication marker last; a missing marker denotes unfinished staging.
  writeFileSync(marker, manifestBytes);
  return { manifest, manifestBytes, sha256: hash(manifestBytes) };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${name} needs a path`);
    args.splice(index, 2);
    return value;
  };
  const output = option("--output-dir");
  const evidence = option("--manifest-file");
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(" ")}`);
  const source = dirname(require.resolve("pdfjs-dist/package.json"));
  const destination = output
    ? resolve(ROOT, output)
    : join(ROOT, "public/vendor/pdfjs", PINNED_VERSION);
  const staged = stagePdfjsAssets({ source, destination });
  if (evidence) {
    const target = resolve(ROOT, evidence);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, staged.manifestBytes);
  }
  process.stdout.write(
    `pdf.js ${staged.manifest.version}: ${staged.manifest.files.length} exact installed assets, manifest SHA-256 ${staged.sha256}\n${destination}\n`,
  );
}
