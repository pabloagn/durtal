export interface OfflineAssets { v: 1; buildId: string; assets: { url: string; sha256: string }[] }
/** Production only. The build manifest is baked by prepare-offline.mjs using
 * the emitted Next BUILD_ID, also recorded by the release packager.
 */
const available = () => process.env.NODE_ENV === "production" && isSecureContext && "serviceWorker" in navigator;

/** The build the server runs now. The query is new each time, so an installed
 * worker's cache can't answer with its own release's copy (SLN-1145). */
async function serverManifest(signal?: AbortSignal): Promise<OfflineAssets> {
  const response = await fetch(`/offline-assets.json?t=${Date.now()}`,{ cache: "no-store", redirect: "error", signal });
  if (!response.ok) throw new Error("Offline reading is unavailable in this build");
  const manifest = await response.json() as OfflineAssets;
  if (manifest.v !== 1 || typeof manifest.buildId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.buildId)) throw new Error("Offline build identity is unavailable");
  return manifest;
}

export async function installOfflineRuntime(signal?: AbortSignal): Promise<ServiceWorkerRegistration | null> {
  if (!available()) return null;
  const manifest = await serverManifest(signal);
  const registration = await navigator.serviceWorker.register(`/sw.js?build=${manifest.buildId}`,{ scope: "/", updateViaCache: "none" });
  signal?.throwIfAborted();
  if (!registration.active) await new Promise<void>((resolve,reject) => {
    const worker = registration.installing ?? registration.waiting;
    const done = (error?: Error) => {
      clearTimeout(timer); signal?.removeEventListener("abort",abort); worker?.removeEventListener("statechange",changed);
      if (error) reject(error); else resolve();
    };
    const abort = () => done(new Error("Offline setup cancelled"));
    const changed = () => {
      if (worker?.state === "activated") done();
      else if (worker?.state === "redundant") done(new Error("Offline setup did not complete"));
    };
    const timer = setTimeout(() => done(new Error("Offline setup took too long")),300_000);
    signal?.addEventListener("abort",abort,{ once: true }); worker?.addEventListener("statechange",changed);
    if (!worker) done(new Error("Offline worker unavailable")); else changed();
  });
  const announce = () => navigator.serviceWorker.controller?.postMessage({ type: "CLIENT_BUILD", buildId: manifest.buildId });
  announce(); navigator.serviceWorker.addEventListener("controllerchange",announce,{ once: true });
  return registration;
}

const workerBuild = (worker: ServiceWorker | null | undefined) => worker ? new URL(worker.scriptURL).searchParams.get("build") : null;

/** On a device that keeps books offline, installs the server's newer release
 * beside the running one (SLN-1145). Resolves to that release's worker once it
 * waits to take over, or null when there is nothing newer. A device that never
 * made a book available offline gets no worker. */
export async function checkOfflineUpdate(): Promise<ServiceWorker | null> {
  if (!available() || !navigator.onLine) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.active) return null;
  const { buildId } = await serverManifest();
  if (workerBuild(registration.active) === buildId) return null;
  if (workerBuild(registration.waiting) !== buildId && workerBuild(registration.installing) !== buildId)
    await navigator.serviceWorker.register(`/sw.js?build=${buildId}`,{ scope: "/", updateViaCache: "none" });
  return new Promise<ServiceWorker | null>((resolve) => {
    const settle = () => {
      if (workerBuild(registration.waiting) === buildId) done(registration.waiting);
      else if (workerBuild(registration.installing) === buildId) watch(registration.installing);
      else done(null);
    };
    let watched: ServiceWorker | null = null;
    const watch = (worker: ServiceWorker | null) => {
      if (worker === watched) return;
      watched?.removeEventListener("statechange",settle); watched = worker; worker?.addEventListener("statechange",settle);
    };
    const done = (worker: ServiceWorker | null) => {
      clearTimeout(timer); watch(null); registration.removeEventListener("updatefound",settle); resolve(worker);
    };
    const timer = setTimeout(() => done(null),300_000);
    registration.addEventListener("updatefound",settle);
    settle();
  });
}

/** Lets a waiting release take over now, and resolves once it controls this
 * page (or after a few seconds, when the browser never says). */
export function takeOverWith(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve,3000);
    navigator.serviceWorker.addEventListener("controllerchange",() => { clearTimeout(timer); resolve(); },{ once: true });
    worker.postMessage({ type: "SKIP_WAITING" });
  });
}
