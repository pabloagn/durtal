import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/reader/device/route";
import { DEVICE_LOCK, settleDeviceId } from "@/lib/reader/device-handshake";

const DEVICE = "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10";
const post = (cookie?: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest("https://durtal.test/api/reader/device", {
    method: "POST",
    headers: { ...headers, ...(cookie ? { cookie: `durtal-device=${cookie}` } : {}) },
  }));

describe("POST /api/reader/device (SLN-668)", () => {
  it("makes this browser's id when it has none", async () => {
    const response = await post();
    const { deviceId } = await response.json();
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^durtal-device=${deviceId}; `));
    expect(cookie).toMatch(/Max-Age=34560000/);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a valid id as it is and replaces a forged one", async () => {
    const kept = await post(DEVICE);
    expect(await kept.json()).toEqual({ deviceId: DEVICE });
    expect(kept.headers.get("set-cookie")).toBeNull();
    const forged = await post("forged");
    expect(forged.headers.get("set-cookie")).toMatch(/^durtal-device=[0-9a-f-]{36}; /);
  });

  it("refuses another origin and sets nothing", async () => {
    const response = await post(undefined, { "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("settleDeviceId", () => {
  const free = { request: (_name: string, run: () => Promise<"ready" | "cookies-off">) => run() };
  const answers = (post: string | null, get: string | null) =>
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      Response.json({ deviceId: init?.method === "POST" ? post : get }));

  it("asks for an id under the reader's lock, then reads the stored cookie back", async () => {
    const fetch = answers(DEVICE, DEVICE);
    const names: string[] = [];
    const locks = { request: vi.fn(async (name: string, run: () => Promise<"ready" | "cookies-off">) => { names.push(name); return run(); }) };
    expect(await settleDeviceId({ fetch, locks })).toBe("ready");
    expect(names).toEqual([DEVICE_LOCK]);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/reader/device", "POST"],
      ["/api/reader/device", "GET"],
    ]);
  });

  it("two tabs take turns, so the second is given the first one's id", async () => {
    let cookie: string | null = null;
    const given: (string | null)[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      // The server's rule: keep a stored id, else make one
      if (init?.method === "POST") given.push((cookie ??= crypto.randomUUID()));
      return Response.json({ deviceId: cookie });
    });
    let queue = Promise.resolve<unknown>(null);
    const locks = { request: (_name: string, run: () => Promise<"ready" | "cookies-off">) => {
      const turn = queue.then(run);
      queue = turn.catch(() => null);
      return turn;
    } };
    expect(await Promise.all([settleDeviceId({ fetch, locks }), settleDeviceId({ fetch, locks })])).toEqual(["ready", "ready"]);
    expect(given).toHaveLength(2);
    expect(new Set(given).size).toBe(1);
  });

  it("says when the browser did not keep the cookie, so the page does not reload for ever", async () => {
    expect(await settleDeviceId({ fetch: answers(DEVICE, null), locks: free })).toBe("cookies-off");
  });

  it("takes another tab's stored id: without Web Locks two tabs can race (#305 review)", async () => {
    expect(await settleDeviceId({ fetch: answers(DEVICE, "5d1f0c2e-8b1a-4c3d-9e2f-0a1b2c3d4e5f") })).toBe("ready");
  });

  it("gives up on a stalled request, so it does not hold the lock for ever (#305 review)", async () => {
    const fetch = answers(DEVICE, DEVICE);
    await settleDeviceId({ fetch, locks: free });
    expect(fetch.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  it("fails when the app cannot be reached", async () => {
    const fetch = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(settleDeviceId({ fetch, locks: free })).rejects.toThrow("503");
  });
});
