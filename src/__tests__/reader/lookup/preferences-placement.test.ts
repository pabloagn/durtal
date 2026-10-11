// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { readLocalLookupSettings, writeLocalLookupSettings, LOOKUP_SETTINGS_KEY } from "@/lib/reader/lookup/preferences";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import { lookupPopoverPosition } from "@/lib/reader/lookup/placement";
import { LookupSessionCache } from "@/lib/reader/lookup/session-cache";
import { createReaderBridge } from "@/lib/reader/bridge-state";
afterEach(() => localStorage.clear());
describe("lookup offline copy, placement and ordering", () => {
  it("accepts a validated offline copy and rejects corrupt or oversized storage", () => {
    const value = { ...defaultLookupSettings(), translateTo: "es" };
    writeLocalLookupSettings(value); expect(readLocalLookupSettings().translateTo).toBe("es");
    localStorage.setItem(LOOKUP_SETTINGS_KEY, '{"v":1,"sources":[],"translateTo":"../../"}');
    expect(readLocalLookupSettings()).toEqual(defaultLookupSettings());
    localStorage.setItem(LOOKUP_SETTINGS_KEY, "x".repeat(170001));
    expect(readLocalLookupSettings()).toEqual(defaultLookupSettings());
  });
  it("keeps desktop placement opposite an above toolbar and within 16px gutters", () => {
    const position = lookupPopoverPosition({ left: 1350, right: 1390, top: 200, bottom: 220 },
      { left: 1250, right: 1400, top: 140, bottom: 192 }, { width: 1440, height: 900 }, 400);
    expect(position.left).toBe(1044); expect(position.top).toBe(228);
    expect(position.maxHeight).toBe(440);
  });
  it.each([100, 650])("docks a phone sheet to the farther edge for selection at %s", top => {
    const position = lookupPopoverPosition({ left: 30, right: 90, top, bottom: top + 20 }, null,
      { width: 390, height: 844 }, 300);
    expect(position.left).toBe(16); expect(position.width).toBe(358);
    expect(position.maxHeight).toBeLessThanOrEqual(422);
    if (top < 422) expect(position.top).toBe(528); else expect(position.top).toBe(16);
  });
  it.each([
    { viewport: { width: 390, height: 844 }, top: 20, bottom: 824 },
    { viewport: { width: 390, height: 844 }, top: -500, bottom: 1400 },
    { viewport: { width: 1440, height: 900 }, top: 0, bottom: 900 },
    { viewport: { width: 1440, height: 900 }, top: -500, bottom: 1400 },
  ])("reserves controls and body for a viewport-spanning passage: %j", ({ viewport, top, bottom }) => {
    const position = lookupPopoverPosition({ left: 30, right: 90, top, bottom }, null, viewport, 400);
    expect(position.minHeight).toBe(220);
    expect(position.maxHeight).toBeGreaterThanOrEqual(220);
    expect(position.top).toBeGreaterThanOrEqual(16);
    expect(position.top + Math.max(220, Math.min(400, position.maxHeight))).toBeLessThanOrEqual(viewport.height - 16);
    expect(position.left).toBeGreaterThanOrEqual(16);
    expect(position.left + position.width).toBeLessThanOrEqual(viewport.width - 16);
  });
  it.each([
    { width: 390, height: 844 }, { width: 1440, height: 900 },
  ])("keeps wholly offscreen selections bounded in %j", viewport => {
    for (const anchor of [
      { left: -600, right: -500, top: -500, bottom: -300 },
      { left: 2000, right: 2100, top: 1200, bottom: 1500 },
    ]) {
      const position = lookupPopoverPosition(anchor, null, viewport, 400);
      expect(position.maxHeight).toBeGreaterThanOrEqual(220);
      expect(position.top).toBeGreaterThanOrEqual(16);
      expect(position.top + Math.min(400, position.maxHeight)).toBeLessThanOrEqual(viewport.height - 16);
      expect(position.left).toBeGreaterThanOrEqual(16);
      expect(position.left + position.width).toBeLessThanOrEqual(viewport.width - 16);
    }
  });
  it("keeps the opposite-toolbar preference above a selection when room exists", () => {
    const position = lookupPopoverPosition({ left: 100, right: 160, top: 700, bottom: 720 },
      { left: 80, right: 220, top: 728, bottom: 780 }, { width: 1440, height: 900 }, 400);
    expect(position.top).toBe(292); expect(position.maxHeight).toBe(440);
    expect(position.minHeight).toBeUndefined();
  });
  it("bounds completed results at 200 and updates LRU order", () => {
    const cache = new LookupSessionCache<{ word: string }>();
    for (let at = 0; at < 200; at++) cache.put(String(at), { word: String(at) });
    cache.get("0"); cache.put("200", { word: "200" });
    expect(cache.get("1")).toBeNull(); expect(cache.get("0")).toEqual({ word: "0" });
    cache.clear(); expect(cache.get("0")).toBeNull();
  });
  it("Look up stays last when a plugin fills after it with a larger order", () => {
    const bridge = createReaderBridge({ ebookId: "book", fileId: "file", format: "epub", locator: null, chapter: null, percent: null, selection: null });
    const target = document.createElement("div"), lookup = document.createElement("button"), quote = document.createElement("button");
    lookup.textContent = "Look up"; quote.textContent = "Save quote";
    const first = bridge.fill("selection-actions", lookup, 0, "last");
    bridge.mountSlot("selection-actions", target);
    const second = bridge.fill("selection-actions", quote, 100);
    expect(target.textContent).toBe("Save quoteLook up");
    first(); second(); bridge.destroy();
  });
});
