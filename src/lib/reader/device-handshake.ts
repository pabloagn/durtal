/**
 * The reader's first visit in a browser (SLN-668): it has no durtal-device
 * cookie yet, so it asks POST /api/reader/device for one before it opens a
 * book. Tabs opened at once take turns under one Web Lock, so the first makes
 * the id and the others are given it: one id per browser, where two first
 * page loads used to make two and the losing tab kept the stale one.
 *
 * "ready": the cookie is stored, reload to open the book. "cookies-off": the
 * browser did not keep it, so a reload would ask again for ever.
 */
export type DeviceHandshake = "ready" | "cookies-off";

export const DEVICE_LOCK = "durtal-reader-device";

type Locks = { request(name: string, callback: () => Promise<DeviceHandshake>): Promise<DeviceHandshake> };

export async function settleDeviceId({
  fetch: doFetch = fetch,
  locks = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: Locks }).locks,
}: { fetch?: typeof fetch; locks?: Locks } = {}): Promise<DeviceHandshake> {
  const ask = async (method: "GET" | "POST") => {
    const response = await doFetch("/api/reader/device", { method, cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error(`Device request answered ${response.status}`);
    const body = (await response.json()) as { deviceId?: unknown };
    return typeof body.deviceId === "string" ? body.deviceId : null;
  };
  const handshake = async (): Promise<DeviceHandshake> => {
    const made = await ask("POST");
    // Read back: only a stored cookie reaches the reader's later requests
    return made && (await ask("GET")) === made ? "ready" : "cookies-off";
  };
  // Without Web Locks (older browsers) two tabs can still race, as before
  return locks ? locks.request(DEVICE_LOCK, handshake) : handshake();
}
