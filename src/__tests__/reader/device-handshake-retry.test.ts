// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
const settle = vi.hoisted(() => ({ answers: [] as ("ready" | "drop" | "hang" | "hang-webkit")[], calls: 0 }));
vi.mock("@/lib/reader/device-handshake", () => ({
  settleDeviceId: async () => {
    settle.calls++;
    const answer = settle.answers.shift() ?? "drop";
    if (answer === "drop") throw new TypeError("Failed to fetch");
    if (answer === "hang") throw new DOMException("signal timed out", "TimeoutError");
    if (answer === "hang-webkit") throw new DOMException("Fetch is aborted", "AbortError");
    return answer;
  },
}));
import { DeviceHandshake, HANDSHAKE_RETRY_MS } from "@/components/reader/device-handshake";

let host: HTMLElement, root: Root;
const reload = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  reload.mockReset();
  settle.answers = [];
  settle.calls = 0;
  vi.stubGlobal("location", Object.assign(new URL("http://durtal.test/reader/b"), { reload }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = () => act(async () => { root.render(h(DeviceHandshake, { ebookId: "b", backHref: "/ebooks/b" })); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const tryAgain = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");

describe("the reader's first request on a flaky connection (SLN-911)", () => {
  it("asks again by itself after a dropped request, and opens the book without an error", async () => {
    settle.answers = ["drop", "ready"];
    await mount();
    expect(settle.calls).toBe(1);
    expect(host.textContent).toContain("Opening the book");
    await wait(HANDSHAKE_RETRY_MS[0]);
    expect(settle.calls).toBe(2);
    expect(reload).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("waits 0.5 s, then 1.5 s, and shows the error with Try again only when all three fail", async () => {
    await mount();
    await wait(HANDSHAKE_RETRY_MS[0] - 1);
    expect(settle.calls).toBe(1);
    await wait(1);
    expect(settle.calls).toBe(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await wait(HANDSHAKE_RETRY_MS[1]);
    expect(settle.calls).toBe(3);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Durtal could not be reached. Check the connection, then try again.");
    expect(tryAgain()).toBeDefined();
    // Try again starts over, with its own retries, and recovers
    settle.answers = ["drop", "ready"];
    await act(async () => tryAgain()!.click());
    expect(settle.calls).toBe(4);
    await wait(HANDSHAKE_RETRY_MS[0]);
    expect(settle.calls).toBe(5);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stops asking once the page is gone", async () => {
    await mount();
    act(() => root.unmount());
    root = createRoot(host);
    await wait(HANDSHAKE_RETRY_MS[0] + HANDSHAKE_RETRY_MS[1]);
    expect(settle.calls).toBe(1);
  });

  it.each(["hang", "hang-webkit"] as const)("shows the error at once after a request that hung (%s), without asking again", async (answer) => {
    settle.answers = [answer];
    await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Durtal could not be reached");
    await wait(HANDSHAKE_RETRY_MS[0] + HANDSHAKE_RETRY_MS[1]);
    expect(settle.calls).toBe(1);
  });

  it("does not bring back a Leave the book? that the error replaced", async () => {
    await mount();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await vi.advanceTimersByTimeAsync(0); });
    expect(document.body.textContent).toContain("Leave the book?");
    await wait(HANDSHAKE_RETRY_MS[0] + HANDSHAKE_RETRY_MS[1]);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    settle.answers = ["ready"];
    await act(async () => tryAgain()!.click());
    expect(document.body.textContent).not.toContain("Leave the book?");
    expect(reload).toHaveBeenCalledOnce();
  });
});
