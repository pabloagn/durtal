#!/usr/bin/env node
// Flattened and pnpm-private copies must share one native instance: PDF.js
// passes native Path2D values into the application's canvas context.
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inside = (base, file) => {
  const path = relative(base, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const assertPng = (png) => {
  if (png.length <= 8 || !png.subarray(0, 8).equals(pngSignature))
    throw new Error("Standalone native PDF renderer did not produce a PNG");
};

// Do not follow directory symlinks while discovering traced package copies.
async function canvasPackages(directory, names, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (basename(directory) === "@napi-rs" && basename(dirname(directory)) === "node_modules" &&
        names.has(`@napi-rs/${entry.name}`)) {
      found.push({ path, name: `@napi-rs/${entry.name}` });
    } else if (entry.isDirectory()) {
      await canvasPackages(path, names, found);
    }
  }
  return found;
}

async function textPdfSmoke(buildRoot, standalone, targetRequire, canvas) {
  const pdfFile = await realpath(targetRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
  const pdfPackage = await realpath(targetRequire.resolve("pdfjs-dist/package.json"));
  if (!inside(standalone, pdfFile) || !inside(standalone, pdfPackage))
    throw new Error("PDF.js resolved outside the standalone release");
  if (createRequire(pdfFile)("@napi-rs/canvas") !== canvas)
    throw new Error("PDF.js and the application do not share the same canvas module");
  const { getDocument } = await import(pathToFileURL(pdfFile).href);
  if (globalThis.Path2D !== canvas.Path2D)
    throw new Error("PDF.js Path2D differs from the application's native constructor");
  const assets = dirname(pdfPackage);
  const data = new Uint8Array(await readFile(join(buildRoot, "src/__tests__/fixtures/ebooks/text.pdf")));
  const task = getDocument({ data, useSystemFonts: false, verbosity: 0,
    standardFontDataUrl: `${assets}/standard_fonts/`, cMapUrl: `${assets}/cmaps/`,
    cMapPacked: true, wasmUrl: `${assets}/wasm/`, iccUrl: `${assets}/iccs/` });
  let page, image;
  try {
    const doc = await task.promise;
    const { info } = await doc.getMetadata();
    if (doc.numPages !== 4 || info.Title !== "The Sudden Winter")
      throw new Error("Standalone text PDF metadata differs from the committed fixture");
    page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ");
    if (!text.includes("Read heavy walked silence spring morning"))
      throw new Error("Standalone text PDF extraction did not read the committed fixture");
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 800 / base.width });
    image = canvas.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = image.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, image.width, image.height);
    await page.render({ canvas: image, canvasContext: context, viewport }).promise;
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let ink = false;
    for (let at = 0; at < pixels.length; at += 4) {
      if (pixels[at] < 200 && pixels[at + 1] < 200 && pixels[at + 2] < 200) { ink = true; break; }
    }
    if (!ink) throw new Error("Standalone text PDF rendered a blank page");
    const png = image.toBuffer("image/png"); assertPng(png);
    return { pages: doc.numPages, title: info.Title, textCharacters: text.length,
      width: image.width, height: image.height, pngSha256: hash(png) };
  } finally {
    page?.cleanup();
    if (image) { image.width = 0; image.height = 0; }
    await task.destroy();
  }
}

export async function prepareNativePdfPackages(buildRoot = root) {
  const standalone = await realpath(join(buildRoot, ".next/standalone"));
  if (!(await stat(join(standalone, "server.js"))).isFile())
    throw new Error("Native PDF packaging requires completed Next standalone output");
  const sourceModules = await realpath(join(buildRoot, "node_modules"));
  const sourceRequire = createRequire(join(buildRoot, "package.json"));
  const canvasPackage = await realpath(sourceRequire.resolve("@napi-rs/canvas/package.json"));
  if (!inside(sourceModules, canvasPackage)) throw new Error("Canvas resolved outside this build's dependencies");
  const canvas = JSON.parse(await readFile(canvasPackage, "utf8"));
  const canvasRequire = createRequire(canvasPackage);
  const modules = await realpath(join(standalone, "node_modules"));
  if (!inside(standalone, modules)) throw new Error("Standalone dependencies are outside the release");
  const bindingStore = await mkdtemp(join(modules, ".native-pdf-"));
  const canonicalCanvas = await realpath(join(modules, "@napi-rs/canvas"));
  if (!inside(standalone, canonicalCanvas)) throw new Error("Canvas wrapper is outside the release");
  const targetRequire = createRequire(join(canonicalCanvas, "package.json"));
  const bindings = [];
  const canonical = new Map([["@napi-rs/canvas", canonicalCanvas]]);
  const names = new Set(["@napi-rs/canvas"]);
  for (const name of Object.keys(canvas.optionalDependencies ?? {}).sort()) {
    if (!/^@napi-rs\/canvas-[a-z0-9-]+$/.test(name)) continue;
    names.add(name);
    let packageFile;
    try { packageFile = await realpath(canvasRequire.resolve(`${name}/package.json`)); }
    catch (error) { if (error.code === "MODULE_NOT_FOUND") continue; throw error; }
    if (!inside(sourceModules, packageFile)) throw new Error("Native binding resolved outside this build's dependencies");
    const metadata = JSON.parse(await readFile(packageFile, "utf8"));
    if (metadata.name !== name || metadata.version !== canvas.version ||
        !/^[a-zA-Z0-9._-]+\.node$/.test(metadata.main) || Object.keys(metadata.dependencies ?? {}).length)
      throw new Error("Unsupported canvas native binding package layout");
    const source = await realpath(join(dirname(packageFile), metadata.main));
    if (!inside(sourceModules, source)) throw new Error("Native binary is outside this build's dependencies");
    const destination = join(bindingStore, name);
    await mkdir(destination, { recursive: true });
    const contained = await realpath(destination);
    if (!inside(standalone, contained)) throw new Error("Native binding destination is outside the release");
    // Only installed metadata and its declared binary; no install or platform map.
    await copyFile(packageFile, join(contained, "package.json"));
    await copyFile(source, join(contained, metadata.main));
    canonical.set(name, contained);
    bindings.push({ name, version: metadata.version, main: metadata.main, sha256: hash(await readFile(source)) });
  }
  if (!bindings.length) throw new Error("No installed canvas native binding was packaged");
  const aliases = await canvasPackages(modules, names);
  for (const binding of bindings) {
    const path = join(modules, binding.name);
    try { await lstat(path); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      aliases.push({ path, name: binding.name, missing: true });
    }
  }
  // Verify every duplicate before replacing it. Differences are errors, not guesses.
  for (const alias of aliases) {
    if (alias.missing) continue;
    const actual = await realpath(alias.path);
    const destination = canonical.get(alias.name);
    if (!inside(standalone, actual) || !destination)
      throw new Error("Traced canvas package is external or not installed in this build");
    const manifest = await realpath(join(actual, "package.json"));
    if (!inside(standalone, manifest)) throw new Error("Traced canvas manifest is outside the release");
    const metadata = JSON.parse(await readFile(manifest, "utf8"));
    if (metadata.name !== alias.name || metadata.version !== canvas.version)
      throw new Error("Traced canvas package identity differs from the installed package");
    if (alias.name === "@napi-rs/canvas") {
      const files = ["package.json", ...canvas.files.filter((file) => file.endsWith(".js"))];
      for (const file of files) {
        const traced = await realpath(join(actual, file));
        const installed = await realpath(join(dirname(canvasPackage), file));
        if (!inside(standalone, traced) || !inside(sourceModules, installed) ||
            hash(await readFile(traced)) !== hash(await readFile(installed)))
          throw new Error("Traced canvas wrapper differs from the installed runtime files");
      }
    } else {
      const binding = bindings.find((item) => item.name === alias.name);
      const binary = await realpath(join(actual, binding.main));
      if (metadata.main !== binding.main || Object.keys(metadata.dependencies ?? {}).length ||
          !inside(standalone, binary) || hash(await readFile(binary)) !== binding.sha256)
        throw new Error("Traced native binary differs from the installed binding");
    }
  }
  for (const alias of aliases) {
    const destination = canonical.get(alias.name);
    if (alias.missing || (alias.path !== destination && await realpath(alias.path) !== destination)) {
      if (!alias.missing) await rm(alias.path, { recursive: true });
      await symlink(relative(dirname(alias.path), destination), alias.path, "dir");
    }
    if (await realpath(alias.path) !== destination)
      throw new Error("Canvas alias did not resolve to its canonical standalone package");
  }
  for (const binding of bindings) {
    const actual = await realpath(targetRequire.resolve(binding.name));
    if (actual !== join(canonical.get(binding.name), binding.main) || hash(await readFile(actual)) !== binding.sha256)
      throw new Error("Canvas did not resolve the canonical native binary");
  }
  const renderedCanvas = targetRequire("@napi-rs/canvas");
  const proof = await textPdfSmoke(buildRoot, standalone, targetRequire, renderedCanvas);
  await writeFile(join(standalone, "native-pdf-bindings.json"), JSON.stringify({ v: 2,
    canvasVersion: canvas.version, bindings, aliases: aliases.map(({ path, name }) => ({
      path: relative(standalone, path), target: relative(standalone, canonical.get(name)) })), textPdf: proof }) + "\n");
  return bindings;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const bindings = await prepareNativePdfPackages();
  console.log(`Standalone native PDF bindings canonicalized and text PDF rendered: ${bindings.length}`);
}
