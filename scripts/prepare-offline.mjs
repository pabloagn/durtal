#!/usr/bin/env node
/** Called after Next's production build and before public/ is packaged. No
 * independent identity generation: SLN-509 owns BUILD_IDENTITY and BUILD_ID.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(new URL("../",import.meta.url).pathname);
export async function prepareOfflineAssets(identity) {
  const buildId=identity.buildId;
  if (!/^[a-f0-9]{40}$/.test(buildId ?? "") || (await readFile(join(root,".next/BUILD_ID"),"utf8")).trim() !== buildId)
    throw new Error("Offline assets require SLN-509's exact baked build identity");
  async function files(dir) {
    const entries = await readdir(dir,{ withFileTypes: true }), result=[];
    for (const entry of entries) result.push(...entry.isDirectory() ? await files(join(dir,entry.name)) : [join(dir,entry.name)]);
    return result;
  }
  const sharp = (await import("sharp")).default;
  const icon=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#07090d"/><path d="M156 144h105c70 0 103 49 103 112s-33 112-103 112H156V144zm46 42v140h53c42 0 63-29 63-70s-21-70-63-70h-53z" fill="#c8c3b8"/></svg>');
  await mkdir(join(root,"public/icons"),{ recursive: true });
  for (const [name,size] of [["durtal-192",192],["durtal-512",512],["durtal-maskable-512",512]])
    await sharp(icon).resize(size,size).png().toFile(join(root,`public/icons/${name}.png`));
  // Reader/offline entry references are roots; follow hashed dynamic imports and
  // CSS/font URLs to include every lazy reader/PDF format dependency.
  const roots=["reader/offline","(offline)/ebooks/offline","(offline)/offline"];
  const urls=new Set(), seen=new Set();
  async function scan(text,from = "static/chunks/entry.js") {
    const matches=text.matchAll(/(?:\/_next\/|["'\s])?(static\/(?:chunks|media)\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?))/g);
    const relative=text.matchAll(/["'(]((?:\.\.?\/)[a-zA-Z0-9_./-]+\.(?:js|css|woff2?))/g);
    for (const match of relative) {
      const url = new URL(match[1],`https://build.invalid/_next/${from}`);
      if (!url.pathname.startsWith("/_next/static/")) continue;
      const path = url.pathname.slice(7); if (seen.has(path)) continue;
      seen.add(path); urls.add(url.pathname);
      if (/\.(js|css)$/.test(path)) await scan(await readFile(join(root,".next",path),"utf8"),path);
    }
    for (const match of matches) {
      const relative=match[1]; if (seen.has(relative)) continue; seen.add(relative); urls.add(`/_next/${relative}`);
      if (/\.(js|css)$/.test(relative)) await scan(await readFile(join(root,".next",relative),"utf8"),relative);
    }
  }
  for (const route of roots) await scan(await readFile(join(root,`.next/server/app/${route}/page_client-reference-manifest.js`),"utf8"));
  for (const dir of ["fonts/reader","vendor/pdfjs","icons"]) for (const path of await files(join(root,"public",dir)))
    urls.add("/"+path.slice(join(root,"public").length+1));
  const assets=[];
  for (const url of [...urls].sort()) {
    const path=url.startsWith("/_next/") ? join(root,".next",url.slice(7)) : join(root,"public",url.slice(1));
    assets.push({ url, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  if (!assets.some(item => /\.js$/.test(item.url))) throw new Error("Offline reader dependency graph is incomplete");
  await writeFile(join(root,"public/offline-assets.json"),JSON.stringify({ v: 1, buildId, assets }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { BUILD_IDENTITY } = await import("../src/lib/deployment/build-identity.ts");
  await prepareOfflineAssets(BUILD_IDENTITY);
}
