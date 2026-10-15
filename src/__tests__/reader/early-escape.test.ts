// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { EARLY_ESCAPE_GLOBAL, earlyEscapeScript, takeEarlyEscape } from "@/lib/reader/early-escape";

const press = (key: string, init: KeyboardEventInit = {}) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

afterEach(() => {
  takeEarlyEscape();
});

describe("the page's early Escape (SLN-811)", () => {
  it("notes an Escape pressed before the reader listens, once", () => {
    new Function(earlyEscapeScript())();
    press("a");
    press("Escape", { metaKey: true });
    expect(takeEarlyEscape()).toBe(false);
    new Function(earlyEscapeScript())();
    press("Escape");
    expect(takeEarlyEscape()).toBe(true);
    expect(takeEarlyEscape()).toBe(false);
  });

  it("stops listening once taken, and leaves the key to the page", () => {
    new Function(earlyEscapeScript())();
    const early = (window as unknown as Record<string, { take(): boolean }>)[EARLY_ESCAPE_GLOBAL];
    expect(takeEarlyEscape()).toBe(false);
    expect(press("Escape")).toBe(true);
    expect(early.take()).toBe(false);
  });

  it("gives false when the page had no script", () => {
    expect(takeEarlyEscape()).toBe(false);
  });
});
