import { readerUuid } from "@/lib/reader/uuid";
import { UUID_RE } from "@/lib/utils/uuid";
import { matchDownloadedFile, downloadSpacePolicy, validateDownloadIdentity, type DeliveryTrust, type DownloadIdentity } from "./download-policy";
import { bookCacheUrl, downloadKey, type DownloadRecord } from "./download-record";
import type { OfflineStore } from "./store";
export const BOOKS_CACHE = "durtal-books";
const LEASE_MS = 60_000;

export async function downloadBook(options: {
  store: OfflineStore; identity: DownloadIdentity; trust: DeliveryTrust;
  deliveryUrl: string; deviceId: string; book: DownloadRecord["book"];
  signal: AbortSignal; progress: (bytes: number, total: number) => void;
}): Promise<DownloadRecord> {
  const identity = validateDownloadIdentity(options.identity, options.trust);
  if (!UUID_RE.test(options.deviceId) || !matchDownloadedFile(options.deliveryUrl,[identity],options.trust))
    throw new Error("Download delivery or device identity differs");
  const key = downloadKey(identity), token = readerUuid();
  const cache = await caches.open(BOOKS_CACHE), publishedKey = bookCacheUrl(identity,options.trust.appOrigin);
  const run = async () => {
    const estimate: StorageEstimate = await navigator.storage.estimate().catch(() => ({}));
    const reserve = downloadSpacePolicy(identity.sizeBytes, typeof estimate.quota === "number" && typeof estimate.usage === "number" ? { quota: estimate.quota, usage: estimate.usage } : null);
    if (reserve.kind === "insufficient") throw new Error("There is not enough space on this device");
    const prior = (await options.store.listDownloads()).find(record => record.key === key);
    if (prior?.state === "ready" && await cache.match(publishedKey)) return prior;
    const record: DownloadRecord = { v: 1, key, identity, book: options.book, deviceId: options.deviceId,
      state: "downloading", token, leaseUntil: Date.now()+LEASE_MS, downloadedAt: null, failure: null };
    await options.store.transactDownload(key,current => {
      if (current?.state === "downloading" && (current.leaseUntil ?? 0)>Date.now()) throw new Error("This file is already downloading");
      return record;
    });
    const candidate = new URL(`/__durtal_download/${token}`,options.trust.appOrigin).href;
    let worker: Worker;
    try { worker = new Worker(new URL("./hash-worker.ts",import.meta.url),{ type: "module" }); }
    catch (error) {
      await options.store.transactDownload(key,current => current?.token === token ?
        { ...current, state: "failed", leaseUntil: null, failure: "File verification worker unavailable" } : current);
      throw error;
    }
    let id = 0, received = 0, lastLease = Date.now(), completed = false;
    let workerFailure: Error | null = null;
    const pending = new Map<number,{ resolve: (hash?: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const fail = (error: Error) => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); };
    worker.onmessage = (event: MessageEvent<{ id: number; sha256?: string; error?: string }>) => {
      const request = pending.get(event.data.id); pending.delete(event.data.id);
      if (request) clearTimeout(request.timer);
      if (event.data.error) request?.reject(new Error(event.data.error)); else request?.resolve(event.data.sha256);
    };
    worker.onerror = () => { workerFailure = new Error("File hashing failed"); fail(workerFailure); };
    const hash = (chunk?: Uint8Array) => new Promise<string | undefined>((resolve,reject) => {
      if (workerFailure) { reject(workerFailure); return; }
      const next = ++id;
      const timer = setTimeout(() => { pending.delete(next); reject(new Error("File hashing timed out")); },30_000);
      pending.set(next,{ resolve,reject,timer });
      const copy = chunk ? new Uint8Array(chunk.length) : undefined; if (copy && chunk) copy.set(chunk);
      const buffer = copy?.buffer;
      worker.postMessage({ id: next, ...(buffer ? { chunk: buffer } : { finish: true }) },buffer ? [buffer] : []);
    });
    const abort = () => { fail(new Error("Download cancelled")); worker.terminate(); };
    options.signal.addEventListener("abort",abort,{ once: true });
    try {
      options.signal.throwIfAborted();
      const response = await fetch(options.deliveryUrl,{ cache: "no-store", credentials: "same-origin", redirect: "error", signal: options.signal });
      if (response.status !== 200 || !response.body || response.headers.has("content-range")) throw new Error("A complete file is required");
      const stream = response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
        async transform(chunk,controller) {
          options.signal.throwIfAborted(); received += chunk.byteLength;
          if (received>identity.sizeBytes) throw new Error("The file size differs");
          await hash(chunk);
          if (Date.now()-lastLease >= LEASE_MS/3) {
            await options.store.transactDownload(key,current => {
              if (current?.token !== token || current.state !== "downloading") throw new Error("Download ownership changed");
              return { ...current, leaseUntil: Date.now()+LEASE_MS };
            }); lastLease = Date.now();
          }
          options.progress(received,identity.sizeBytes); controller.enqueue(chunk);
        },
      }),{ signal: options.signal });
      await cache.put(candidate,new Response(stream,{ headers: { "Content-Type": identity.contentType, "Content-Length": String(identity.sizeBytes), ETag: `"${identity.sha256}"` } }));
      const actualHash = await hash();
      if (received !== identity.sizeBytes || actualHash !== identity.sha256) throw new Error("The file failed integrity verification");
      options.signal.throwIfAborted();
      const verified = await cache.match(candidate); if (!verified) throw new Error("Verified file disappeared");
      await cache.put(publishedKey,verified);
      options.signal.throwIfAborted();
      const ready = await options.store.transactDownload(key,current => {
        if (current?.token !== token || current.state !== "downloading") throw new Error("Download ownership changed");
        return { ...current, state: "ready", leaseUntil: null, downloadedAt: new Date().toISOString(), failure: null };
      });
      completed = true; void navigator.storage.persist().catch(() => false);
      return ready!;
    } catch (error) {
      await options.store.transactDownload(key,current => current?.token === token ? { ...current, state: "failed", leaseUntil: null,
        failure: options.signal.aborted ? "Download cancelled" : "Download failed verification or storage" } : current);
      throw error;
    } finally {
      options.signal.removeEventListener("abort",abort); worker.terminate(); fail(new Error("Download closed"));
      await cache.delete(candidate);
      if (!completed) {
        const current = (await options.store.listDownloads()).find(record => record.key === key);
        if (current?.token === token && current.state !== "ready") await cache.delete(publishedKey);
      }
    }
  };
  return navigator.locks ? navigator.locks.request(`durtal-offline:download:${key}`,run) : run();
}
export async function removeDownload(store: OfflineStore,record: DownloadRecord,origin: string) {
  const remove = async () => {
    await store.transactDownload(record.key,current => {
      if (current?.token !== record.token) throw new Error("Download ownership changed");
      return null;
    });
    await (await caches.open(BOOKS_CACHE)).delete(bookCacheUrl(record.identity,origin));
  };
  return navigator.locks ? navigator.locks.request(`durtal-offline:download:${record.key}`,remove) : remove();
}
