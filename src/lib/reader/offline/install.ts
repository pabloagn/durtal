export interface OfflineAssets { v: 1; buildId: string; assets: { url: string; sha256: string }[] }
/** Production only. The build manifest is baked by prepare-offline.mjs using
 * SLN-509's BUILD_IDENTITY.buildId; no clock, random ID or fallback build name.
 */
export async function installOfflineRuntime(signal?: AbortSignal): Promise<ServiceWorkerRegistration | null> {
  if (process.env.NODE_ENV !== "production" || !isSecureContext || !("serviceWorker" in navigator)) return null;
  const response = await fetch("/offline-assets.json",{ cache: "no-store", redirect: "error", signal });
  if (!response.ok) throw new Error("Offline reading is unavailable in this build");
  const manifest = await response.json() as OfflineAssets;
  if (manifest.v !== 1 || !/^[a-f0-9]{40}$/.test(manifest.buildId)) throw new Error("Offline build identity is unavailable");
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
