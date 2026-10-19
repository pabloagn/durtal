import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOfflineUpdate, installOfflineRuntime, takeOverWith } from "@/lib/reader/offline/install";

// SLN-1145: once a book was downloaded, the device's offline worker never
// updated. The installed worker answered the manifest from its own cache, so
// the app kept registering the old release.

class Worker extends EventTarget {
  state: ServiceWorkerState = "installing";
  postMessage = vi.fn();
  constructor(readonly scriptURL: string) { super(); }
  become(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event("statechange")); }
}
const worker = (build: string) => new Worker(`https://durtal.local/sw.js?build=${build}`);
class Registration extends EventTarget {
  active: Worker | null = null; waiting: Worker | null = null; installing: Worker | null = null;
}

let registration: Registration | undefined;
const register = vi.fn();
const fetchMock = vi.fn();
const container = new EventTarget() as EventTarget & Record<string, unknown>;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("isSecureContext", true);
  registration = new Registration();
  registration.active = worker("old");
  register.mockReset().mockImplementation(async (url: string) => {
    const next = new Worker(`https://durtal.local${url}`);
    registration!.installing = next;
    registration!.dispatchEvent(new Event("updatefound"));
    return registration;
  });
  fetchMock.mockReset().mockImplementation(async () => Response.json({ v: 1, buildId: "new", assets: [] }));
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(container, { register, getRegistration: async () => registration, controller: { postMessage: vi.fn() } });
  vi.stubGlobal("navigator", { onLine: true, serviceWorker: container });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const settled = (installed: (w: Worker) => void) => {
  const result = checkOfflineUpdate();
  setTimeout(() => installed(registration!.installing as Worker), 0);
  return result;
};

describe("the offline manifest", () => {
  it("asks the server with a query an installed worker's cache can't answer", async () => {
    await installOfflineRuntime().catch(() => {});
    const first = String(fetchMock.mock.calls[0][0]);
    expect(first).toMatch(/^\/offline-assets\.json\?t=\d+$/);
  });
});

describe("checkOfflineUpdate", () => {
  it("installs the server's newer release and resolves to it once it waits", async () => {
    const waiting = await settled((next) => {
      registration!.installing = null; registration!.waiting = next; next.become("installed");
    });
    expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js?build=new", { scope: "/", updateViaCache: "none" });
    expect(waiting?.scriptURL).toMatch(/build=new$/);
  });

  it("resolves to nothing when the new release fails to install", async () => {
    const waiting = await settled((next) => { registration!.installing = null; next.become("redundant"); });
    expect(waiting).toBeNull();
  });

  it("does nothing when the running release is the server's", async () => {
    registration!.active = worker("new");
    expect(await checkOfflineUpdate()).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("finds a release already waiting without installing it again", async () => {
    registration!.waiting = worker("new");
    expect(await checkOfflineUpdate()).toBe(registration!.waiting);
    expect(register).not.toHaveBeenCalled();
  });

  it("never installs a worker on a device without downloads", async () => {
    registration = undefined;
    expect(await checkOfflineUpdate()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("waits while the device is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false, serviceWorker: container });
    expect(await checkOfflineUpdate()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("takeOverWith", () => {
  it("asks the waiting release to take over and resolves when it controls the page", async () => {
    const next = worker("new");
    const done = takeOverWith(next as unknown as ServiceWorker);
    expect(next.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "SKIP_WAITING" });
    container.dispatchEvent(new Event("controllerchange"));
    await expect(done).resolves.toBeUndefined();
  });
});

