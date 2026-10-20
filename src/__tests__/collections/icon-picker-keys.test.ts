// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import IconPickerPanel, { iconGridMove } from "@/components/collections/icon-picker-panel";

// SLN-1302: the picker is one choice, one Tab stop a grid, arrows across its rows
describe("collection icon picker keys", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const radios = (group: Element) => [...group.querySelectorAll<HTMLElement>("[role=radio]")];
  const press = (target: Element, key: string) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });

  it("moves across 8 columns and along a row, stopping at the edges", () => {
    expect(iconGridMove("ArrowRight", 0, 20, 8)).toBe(1);
    expect(iconGridMove("ArrowLeft", 0, 20, 8)).toBe(0);
    expect(iconGridMove("ArrowDown", 3, 20, 8)).toBe(11);
    expect(iconGridMove("ArrowDown", 15, 20, 8)).toBe(15);
    expect(iconGridMove("ArrowUp", 11, 20, 8)).toBe(3);
    expect(iconGridMove("Home", 11, 20, 8)).toBe(8);
    expect(iconGridMove("End", 9, 20, 8)).toBe(15);
    expect(iconGridMove("End", 17, 20, 8)).toBe(19);
    expect(iconGridMove("Tab", 3, 20, 8)).toBeNull();
  });

  it("gives each grid one Tab stop, the chosen icon, and moves it with the arrows", () => {
    const pick = vi.fn();
    act(() => root.render(h(IconPickerPanel, { value: "BookOpen", onPick: pick })));
    const [suggested, all] = [...host.querySelectorAll("[role=radiogroup]")];
    expect(suggested.getAttribute("aria-labelledby")).toBe(host.querySelector("p.type-caption:not([role])")!.id);
    expect(radios(all).length).toBeGreaterThan(1000);
    for (const group of [suggested, all]) {
      const stops = radios(group).filter((b) => b.tabIndex === 0);
      expect(stops.map((b) => b.getAttribute("aria-label"))).toEqual(["book open"]);
      expect(stops[0].getAttribute("aria-checked")).toBe("true");
    }
    expect(radios(suggested).filter((b) => b.getAttribute("aria-checked") === "true")).toHaveLength(1);

    const icons = radios(suggested);
    const at = icons.findIndex((b) => b.tabIndex === 0);
    icons[at].focus();
    press(icons[at], "ArrowDown");
    expect(document.activeElement).toBe(icons[at + 8]);
    press(icons[at + 8], "ArrowRight");
    expect(document.activeElement).toBe(icons[at + 9]);
    expect(radios(suggested).filter((b) => b.tabIndex === 0)).toEqual([icons[at + 9]]);
    press(icons[at + 9], "Home");
    expect(document.activeElement).toBe(icons[8]);
    press(icons[8], "End");
    expect(document.activeElement).toBe(icons[15]);
    // Enter or Space on a button is its click: it chooses that icon
    act(() => icons[15].click());
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.calls[0][0]).toMatch(/^[A-Z]\w+$/);
  });

  it("announces the match count, and no match, from one status line", async () => {
    act(() => root.render(h(IconPickerPanel, { value: null, onPick: vi.fn() })));
    const status = host.querySelector("[role=status]")!;
    expect(status.textContent).toBe("");
    // Empty, it stays in the accessibility tree: never display none, or its first text goes unannounced
    expect(status.className.split(" ").some((c) => /(^|:)hidden$/.test(c))).toBe(false);
    const input = host.querySelector("input")!;
    const type = async (text: string) => {
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("book open");
    expect(host.querySelector("[role=status]")).toBe(status);
    expect(status.textContent).toMatch(/^\d+ icons?$/);
    expect(host.querySelector("[role=radiogroup]")!.getAttribute("aria-labelledby")).toBe(status.id);
    await type("zzzz-nothing");
    expect(host.querySelector("[role=status]")).toBe(status);
    expect(status.textContent).toBe("No icons match “zzzz-nothing”");
    expect(host.querySelector("[role=radiogroup]")).toBeNull();
  });
});
