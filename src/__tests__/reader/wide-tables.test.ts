// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { attachReaderMedia } from "@/lib/reader/media/document";
import { fromRange } from "@/vendor/foliate-js/epubcfi.js";

describe("wide table wrappers", () => {
  it("wraps once, keeps CFI indices invariant and claims horizontal wheel/key input", async () => {
    const table = document.createElement("table");
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.textContent = "original table text";
    row.append(cell);
    table.append(row);
    document.body.replaceChildren(table);
    Object.defineProperty(table, "scrollWidth", { value: 1400 });
    Object.defineProperty(window, "innerWidth", {
      value: 800,
      configurable: true,
    });
    const range = document.createRange();
    range.selectNodeContents(cell.firstChild!);
    const before = fromRange(range);
    const publish = vi.fn();
    const detach = attachReaderMedia(document, publish);
    await vi.waitFor(() =>
      expect(
        document.querySelectorAll("[data-durtal-wide-table]"),
      ).toHaveLength(1),
    );
    expect(fromRange(range)).toEqual(before);
    const wrapper = document.querySelector<HTMLElement>(
      "[data-durtal-wide-table]",
    )!;
    expect(wrapper.hasAttribute("cfi-skip")).toBe(true);
    expect(wrapper.getAttribute("aria-label")).toBe("Table scrolls sideways");
    const button = document.querySelector<HTMLButtonElement>("button")!;
    expect(button.hasAttribute("cfi-inert")).toBe(true);
    button.click();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "table", element: table }),
    );
    Object.defineProperty(wrapper, "clientWidth", { value: 800 });
    const key = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    wrapper.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(wrapper.scrollLeft).toBe(80);
    const wheel = new WheelEvent("wheel", {
      deltaX: 30,
      bubbles: true,
      cancelable: true,
    });
    wrapper.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(wrapper.scrollLeft).toBe(110);
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelectorAll("[data-durtal-wide-table]")).toHaveLength(
      1,
    );
    detach();
  });
});
