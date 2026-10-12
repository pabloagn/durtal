import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOfflineRuntime } from "@/lib/reader/offline/install";

const id = "Next_generated-Release_27";
const registration = { active: {} } as ServiceWorkerRegistration;
const register = vi.fn(), postMessage = vi.fn(), addEventListener = vi.fn();
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("isSecureContext", true);
  register.mockReset().mockResolvedValue(registration);
  postMessage.mockReset(); addEventListener.mockReset();
  vi.stubGlobal("navigator", { serviceWorker: { register, controller: { postMessage }, addEventListener } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function manifest(buildId: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ v: 1, buildId, assets: [] })));
}
describe("actual offline client emitted build-ID contract", () => {
  it.each([id, "a".repeat(40), "x".repeat(128)])("registers and announces the exact manifest identity %s", async buildId => {
    manifest(buildId);
    expect(await installOfflineRuntime()).toBe(registration);
    expect(register).toHaveBeenCalledExactlyOnceWith(`/sw.js?build=${buildId}`, { scope: "/", updateViaCache: "none" });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "CLIENT_BUILD", buildId });
    expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function), { once: true });
  });
  it.each([null, 123, "", "bad/id", "bad?query", "x".repeat(129)])("refuses malformed manifest identity %s before registration", async buildId => {
    manifest(buildId);
    await expect(installOfflineRuntime()).rejects.toThrow("Offline build identity is unavailable");
    expect(register).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
  });
});
