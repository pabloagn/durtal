// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
const settle = vi.hoisted(() => ({ resolve: (_: "ready" | "no-cookie") => {} }));
vi.mock("@/lib/reader/device-handshake", () => ({
  settleDeviceId: () => new Promise((resolve) => { settle.resolve = resolve; }),
}));
import { DeviceHandshake } from "@/components/reader/device-handshake";
import { earlyEscapeScript } from "@/lib/reader/early-escape";

let host: HTMLElement, root: Root;
const reload = vi.fn(), assign = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reload.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", Object.assign(new URL("http://durtal.test/reader/b"), { reload, assign }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const escape = (target: EventTarget = document) => act(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
});
// The prompt opens once the key is done (a task later)
const afterKey = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const prompt = () => host.querySelector("[data-reader-leave-prompt]");
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const mount = () => act(async () => { root.render(h(DeviceHandshake, { ebookId: "b", backHref: "/ebooks/b" })); });

describe("Escape on the reader's first page in a browser (SLN-811)", () => {
  it("asks before leaving on one press, and Leave goes back to the e-book", async () => {
    await mount();
    expect(host.textContent).toContain("Opening the book");
    escape();
    await afterKey();
    expect(prompt()?.closest("dialog")?.textContent).toContain("Leave the book?");
    expect(document.activeElement).toBe(button("Leave"));
    act(() => button("Leave").click());
    expect(assign).toHaveBeenCalledWith("http://durtal.test/ebooks/b");
  });

  it("holds the reload while the question is up, and Escape again stays and opens the book", async () => {
    await mount();
    escape();
    await afterKey();
    await act(async () => settle.resolve("ready"));
    expect(reload).not.toHaveBeenCalled();
    escape(document.activeElement!);
    await afterKey();
    expect(prompt()).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads at once with no question, and takes a press made before its code ran", async () => {
    await mount();
    await act(async () => settle.resolve("ready"));
    expect(reload).toHaveBeenCalledOnce();
    act(() => root.unmount());
    root = createRoot(host);
    new Function(earlyEscapeScript())();
    escape();
    await mount();
    await afterKey();
    expect(prompt()).not.toBeNull();
  });
});
