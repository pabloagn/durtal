/* Classical worker. Build identity and exact immutable asset hashes are supplied
 * by the manifest generated from SLN-509 BUILD_IDENTITY.buildId. No API/RSC or
 * mutation response enters these shell/asset caches. Books are explicitly verified.
 */
const BUILD = new URL(self.location.href).searchParams.get("build");
const SHELL = `durtal-shell-${BUILD}`, ASSETS = `durtal-assets-${BUILD}`, BOOKS = "durtal-books";
const SHELLS = ["/reader/offline", "/ebooks/offline", "/offline"];
const clientsBuild = new Map();
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n => n.toString(16).padStart(2,"0")).join("");
const checked = async response => {
  if (!response.ok || response.redirected || response.type === "opaque") throw new Error("Incomplete offline install");
  return response;
};
self.addEventListener("install",event => event.waitUntil((async () => {
  if (!/^[a-f0-9]{40}$/.test(BUILD ?? "")) throw new Error("Missing baked build identity");
  const manifest = await (await checked(await fetch("/offline-assets.json",{ cache: "no-store", redirect: "error" }))).json();
  if (manifest.v !== 1 || manifest.buildId !== BUILD || !Array.isArray(manifest.assets) || !manifest.assets.length)
    throw new Error("Offline asset identity mismatch");
  const hadAssets = await caches.has(ASSETS), hadShell = await caches.has(SHELL);
  const assets = await caches.open(ASSETS), shell = await caches.open(SHELL);
  try {
    // Bound concurrency and verify every same-origin immutable resource.
    for (let offset = 0; offset < manifest.assets.length; offset += 4) await Promise.all(manifest.assets.slice(offset,offset+4).map(async item => {
      const url = new URL(item.url,self.location.origin);
      if (url.origin !== self.location.origin || url.search || !/^\/(?:_next\/static\/|fonts\/reader\/|vendor\/pdfjs\/|icons\/)/.test(url.pathname) || !/^[a-f0-9]{64}$/.test(item.sha256))
        throw new Error("Untrusted offline asset");
      const response = await checked(await fetch(url.href,{ cache: "reload", redirect: "error" }));
      if (await digest(await response.clone().arrayBuffer()) !== item.sha256) throw new Error("Offline asset changed during install");
      await assets.put(url.href,response);
    }));
    for (const path of SHELLS) {
      const response = await checked(await fetch(path,{ cache: "reload", redirect: "error", headers: { Accept: "text/html" } }));
      if (!response.headers.get("content-type")?.includes("text/html")) throw new Error("Offline shell is not a document");
      await shell.put(path,response);
    }
    await assets.put("/offline-assets.json",new Response(JSON.stringify(manifest),{ headers: { "Content-Type": "application/json" } }));
  } catch (error) { if (!hadShell) await caches.delete(SHELL); if (!hadAssets) await caches.delete(ASSETS); throw error; }
  // No skipWaiting: retain the old working release while its clients are open.
})()));
self.addEventListener("activate",event => event.waitUntil((async () => {
  await self.clients.claim();
  // Preserve older releases for rollback and still-open clients; cleanup is an
  // explicit client-confirmed maintenance action, never an activation guess.
})()));
self.addEventListener("message",event => {
  if (event.data?.type === "CLIENT_BUILD" && /^[a-f0-9]{40}$/.test(event.data.buildId) && event.source?.id)
    clientsBuild.set(event.source.id,event.data.buildId);
});
const openDownloads = () => new Promise((resolve,reject) => {
  const req = indexedDB.open("durtal-offline");
  req.onupgradeneeded = () => req.transaction.abort(); // Worker never creates/upgrades the shared store.
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    if (db.version !== 1 || !db.objectStoreNames.contains("downloads")) { db.close(); reject(new Error("Unsupported offline store")); return; }
    const tx = db.transaction("downloads","readonly"), read = tx.objectStore("downloads").getAll();
    read.onsuccess = () => { db.close(); resolve(read.result); };
    read.onerror = () => { db.close(); reject(read.error); };
  };
});
function identify(url,records) {
  for (const record of records) {
    const f = record.identity;
    if (record.v !== 1 || record.state !== "ready" || f?.v !== 1 || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.sizeBytes) || f.sizeBytes<1) continue;
    const canonical = new URL(f.canonicalUrl);
    const appMatch = url.origin === self.location.origin && url.pathname === `/api/ebooks/files/${f.fileId}`;
    const canonicalMatch = url.origin === canonical.origin && url.pathname === canonical.pathname;
    const requestedHash = url.searchParams.get("durtal-sha");
    if ((appMatch || canonicalMatch) && (!requestedHash || requestedHash === f.sha256)) return record;
  }
  return null;
}
function range(request,file,blob) {
  const headers = { "Content-Type": file.contentType, "Accept-Ranges": "bytes", ETag: `"${file.sha256}"` };
  const full = () => new Response(request.method === "HEAD" ? null : blob,{ status: 200, headers: { ...headers, "Content-Length": String(blob.size) } });
  const requested = request.headers.get("range"), ifRange = request.headers.get("if-range");
  if (request.method === "HEAD" || !requested || requested.length>1024 || requested.includes(",") || (ifRange && ifRange !== headers.ETag)) return full();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(requested.trim());
  if (!match || (!match[1] && !match[2])) return full();
  const size = BigInt(blob.size), zero = BigInt(0), one = BigInt(1);
  let start, end;
  const refused = () => new Response(null,{ status: 416, headers: { ...headers, "Content-Range": `bytes */${blob.size}`, "Content-Length": "0" } });
  if (!blob.size) return refused();
  if (!match[1]) { const suffix = BigInt(match[2]); if (suffix===zero) return refused(); start = suffix>=size ? zero : size-suffix; end=size-one; }
  else { start=BigInt(match[1]); end=match[2] ? BigInt(match[2]) : size-one; if (start>=size || end<start) return refused(); if (end>=size) end=size-one; }
  return new Response(blob.slice(Number(start),Number(end+one)),{ status: 206,
    headers: { ...headers, "Content-Length": String(end-start+one), "Content-Range": `bytes ${start}-${end}/${blob.size}` } });
}
async function bookResponse(request,url) {
  try {
    const record = identify(url,await openDownloads()); if (!record) return null;
    const file = record.identity;
    const key = new URL(`/__durtal_books/${file.fileId.toLowerCase()}/${file.sha256}`,self.location.origin).href;
    const response = await (await caches.open(BOOKS)).match(key); if (!response) return null;
    const blob = await response.blob();
    if (blob.size !== file.sizeBytes || response.headers.get("etag") !== `"${file.sha256}"`) return null;
    return range(request,file,blob);
  } catch { return null; }
}
self.addEventListener("fetch",event => {
  const request=event.request,url=new URL(request.url);
  if (!["GET","HEAD"].includes(request.method)) return;
  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(`durtal-shell-${clientsBuild.get(event.clientId) ?? BUILD}`);
      if (SHELLS.includes(url.pathname)) {
        const saved = await cache.match(url.pathname);
        if (saved) return saved;
      }
      try { return await fetch(request); }
      catch {
        const reader = /^\/reader\/([a-f0-9-]{36})$/i.exec(url.pathname);
        if (reader) {
          const target = new URL("/reader/offline",url.origin); target.searchParams.set("ebookId",reader[1]);
          const file=url.searchParams.get("file"); if (file) target.searchParams.set("file",file);
          return Response.redirect(target.href,302);
        }
        return await cache.match("/offline") ?? new Response("Offline",{ status: 503 });
      }
    })()); return;
  }
  if (url.origin === self.location.origin && (/^\/_next\/static\//.test(url.pathname) || /^\/fonts\/reader\//.test(url.pathname) || /^\/vendor\/pdfjs\//.test(url.pathname) || url.pathname === "/offline-assets.json")) {
    event.respondWith((async () => {
      const cache = await caches.open(`durtal-assets-${clientsBuild.get(event.clientId) ?? BUILD}`);
      return await cache.match(request) ?? fetch(request);
    })()); return;
  }
  // Other APIs, RSC/flight, plugins, mutations and unrelated URLs pass through.
  if (request.headers.get("rsc") || url.searchParams.has("_rsc")) return;
  if (/^\/api\/ebooks\/files\/[a-f0-9-]{36}$/i.test(url.pathname) || url.origin !== self.location.origin)
    event.respondWith((async () => await bookResponse(request,url) ?? fetch(request))());
});
