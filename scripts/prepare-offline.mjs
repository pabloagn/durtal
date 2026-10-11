#!/usr/bin/env node
/** Called after Next's production build and before public/ is packaged. The exact
 * emitted Next BUILD_ID is also the release packager's build identity.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(new URL("../",import.meta.url).pathname);
export async function prepareOfflineAssets(buildRoot = root) {
  // Read the actual completed build, never an environment label or a new ID.
  const buildId = (await readFile(join(buildRoot,".next/BUILD_ID"),"utf8")).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId))
    throw new Error("Offline assets require a valid emitted Next build ID");
  // The existing build-time TypeScript parser distinguishes asset syntax
  // from third-party configuration strings; no package is installed here.
  const ts = (await import("typescript")).default;
  async function files(dir) {
    const entries = await readdir(dir,{ withFileTypes: true }), result=[];
    for (const entry of entries) {
      // Hidden files/directories are build metadata, not public runtime URLs.
      if (entry.name.startsWith(".")) continue;
      result.push(...entry.isDirectory() ? await files(join(dir,entry.name)) : [join(dir,entry.name)]);
    }
    return result;
  }
  const sharp = (await import("sharp")).default;
  const icon=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#07090d"/><path d="M156 144h105c70 0 103 49 103 112s-33 112-103 112H156V144zm46 42v140h53c42 0 63-29 63-70s-21-70-63-70h-53z" fill="#c8c3b8"/></svg>');
  await mkdir(join(buildRoot,"public/icons"),{ recursive: true });
  for (const [name,size] of [["durtal-192",192],["durtal-512",512],["durtal-maskable-512",512]])
    await sharp(icon).resize(size,size).png().toFile(join(buildRoot,`public/icons/${name}.png`));
  // Reader/offline references and Next's emitted framework bootstraps are roots;
  // follow their hashed imports and CSS/font URLs, without catalogue page roots.
  const roots=["reader/offline","(offline)/ebooks/offline","(offline)/offline"];
  const urls=new Set(), seen=new Set();
  async function scan(text,from = "static/chunks/entry.js") {
    // Next manifests/runtime chunk tables contain literal emitted paths.
    // Turbopack emits ~ in chunk/media names; fonts can also be .otf/.ttf.
    const matches=text.matchAll(/(?:\/_next\/|["'\s])?(static\/(?:chunks|media)\/[a-zA-Z0-9_./~-]+\.(?:m?js|css|woff2?|ttf|otf|wasm))/g);
    const relative = new Set();
    const remember = value => {
      if (/^\.\.?\//.test(value) && /\.(?:m?js|css|woff2?|ttf|otf|wasm)(?:[?#].*)?$/.test(value))
        relative.add(value);
    };
    if (/\.css$/.test(from)) {
      for (const match of text.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi))
        remember(match[1] ?? match[2] ?? match[3]);
      for (const match of text.matchAll(/@import\s*["']([^"']+)["']/gi)) remember(match[1]);
    } else {
      const parsed = ts.createSourceFile(from, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
      const literal = node => {
        if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) remember(node.text);
      };
      function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal(node.moduleSpecifier);
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          if (ts.isIdentifier(callee) && callee.text === "importScripts") {
            for (const argument of node.arguments) literal(argument);
          } else if (callee.kind === ts.SyntaxKind.ImportKeyword ||
            ts.isPropertyAccessExpression(callee) && callee.name.text === "addModule") literal(node.arguments[0]);
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
          ["URL", "Worker", "SharedWorker"].includes(node.expression.text)) literal(node.arguments?.[0]);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
    }
    for (const reference of relative) {
      const url = new URL(reference,`https://build.invalid/_next/${from}`);
      if (!url.pathname.startsWith("/_next/static/")) continue;
      const path = url.pathname.slice(7); if (seen.has(path)) continue;
      seen.add(path); urls.add(url.pathname);
      if (/\.(m?js|css)$/.test(path)) await scan(await readFile(join(buildRoot,".next",path),"utf8"),path);
    }
    for (const match of matches) {
      const relative=match[1]; if (seen.has(relative)) continue; seen.add(relative); urls.add(`/_next/${relative}`);
      if (/\.(m?js|css)$/.test(relative)) await scan(await readFile(join(buildRoot,".next",relative),"utf8"),relative);
    }
  }
  // Client-reference manifests omit the shared framework scripts emitted into
  // each offline document. Read only bootstrap fields from completed manifests;
  // pages/lowPriorityFiles are not reader dependencies.
  for (const manifestPath of [".next/build-manifest.json", ...roots.map(route => `.next/server/app/${route}/page/build-manifest.json`)]) {
    const manifest = JSON.parse(await readFile(join(buildRoot,manifestPath),"utf8"));
    if (!Array.isArray(manifest.rootMainFiles) || !manifest.rootMainFiles.length || !Array.isArray(manifest.polyfillFiles))
      throw new Error(`Offline framework roots are incomplete: ${manifestPath}`);
    for (const path of new Set([...manifest.rootMainFiles,...manifest.polyfillFiles])) {
      if (typeof path !== "string" || !/^static\/chunks\/[a-zA-Z0-9_./~-]+\.m?js$/.test(path) || path.split("/").some(part => !part || part === "." || part === ".."))
        throw new Error(`Unsupported offline framework root: ${manifestPath}`);
      if (seen.has(path)) continue;
      seen.add(path); urls.add(`/_next/${path}`);
      await scan(await readFile(join(buildRoot,".next",path),"utf8"),path);
    }
  }
  for (const route of roots) await scan(await readFile(join(buildRoot,`.next/server/app/${route}/page_client-reference-manifest.js`),"utf8"));
  for (const dir of ["fonts/reader","vendor/pdfjs","icons"]) for (const path of await files(join(buildRoot,"public",dir)))
    urls.add("/"+path.slice(join(buildRoot,"public").length+1));
  const assets=[];
  for (const url of [...urls].sort()) {
    const path=url.startsWith("/_next/") ? join(buildRoot,".next",url.slice(7)) : join(buildRoot,"public",url.slice(1));
    assets.push({ url, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  if (!assets.some(item => /\.js$/.test(item.url))) throw new Error("Offline reader dependency graph is incomplete");
  await writeFile(join(buildRoot,"public/offline-assets.json"),JSON.stringify({ v: 1, buildId, assets }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await prepareOfflineAssets();
}
