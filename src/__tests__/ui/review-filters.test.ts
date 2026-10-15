// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewFilters } from "@/app/(catalogue)/ebooks/review/review-filters";

// Main audit 2026-10-15: on a phone the review queue started at 914px, under
// four fields and Apply. There the search shares its row with Filter, which
// opens the rest; from `sm` up every field stays in the form's grid.
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (active: number) => act(async () => root.render(createElement(ReviewFilters, {
  active,
  search: createElement("input", { name: "q" }),
  filters: createElement("select", { name: "language" }),
})));

describe("ReviewFilters", () => {
  it("keeps the choices behind Filter on a phone, in the grid from sm up", async () => {
    await render(0);
    const toggle = host.querySelector("button")!;
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.querySelector("select[name=language]")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "sm:contents"]));
    expect(toggle.className.split(/\s+/)).toEqual(expect.arrayContaining(["sm:hidden", "pointer-coarse:h-11"]));
    // The search and Filter share a row on a phone; the row dissolves into the grid from sm up
    expect(toggle.parentElement!.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "sm:contents"]));
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.className.split(/\s+/)).toContain("grid");
    expect(panel.className.split(/\s+/)).not.toContain("hidden");
  });

  it("counts the choices set on Filter", async () => {
    await render(2);
    expect(host.querySelector("button")!.textContent).toBe("Filter2");
    await render(0);
    expect(host.querySelector("button")!.textContent).toBe("Filter");
  });

  it("submits the form on Enter in the search, with Apply hidden on a phone", async () => {
    const form = document.createElement("form"); host.append(form);
    const formRoot = createRoot(form);
    await act(async () => formRoot.render(createElement(ReviewFilters, {
      active: 0, search: createElement("input", { name: "q" }), filters: createElement("button", { type: "submit" }, "Apply filters"),
    })));
    const submit = vi.fn();
    form.requestSubmit = submit;
    const input = form.querySelector("input")!;
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => { input.dispatchEvent(enter); });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    // Enter that ends an input method's composition only confirms the text
    const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    await act(async () => { input.dispatchEvent(composing); });
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => formRoot.unmount());
  });

  it("closes on Esc with focus back on Filter, as the other lists' Filter does", async () => {
    await render(0);
    const toggle = host.querySelector("button")!;
    await act(async () => toggle.click());
    const select = host.querySelector("select")!;
    select.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => { select.dispatchEvent(escape); });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(escape.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  it("offers Clear all when a choice is set: it unsets the choices and submits", async () => {
    await render(0);
    expect(host.textContent).not.toContain("Clear all");
    const form = document.createElement("form"); host.append(form);
    const formRoot = createRoot(form);
    await act(async () => formRoot.render(createElement(ReviewFilters, {
      active: 1, search: createElement("input", { name: "q", defaultValue: "Huysmans" }),
      filters: createElement("select", { name: "format", defaultValue: "epub" },
        createElement("option", { value: "" }, "All formats"), createElement("option", { value: "epub" }, "EPUB")),
    })));
    const submit = vi.fn();
    form.requestSubmit = submit;
    const clear = [...form.querySelectorAll("button")].find((button) => button.textContent === "Clear all")!;
    expect(clear.className.split(/\s+/)).toContain("sm:hidden");
    await act(async () => clear.click());
    expect(form.querySelector("select")!.value).toBe("");
    expect(form.querySelector("input")!.value).toBe("Huysmans");
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => formRoot.unmount());
  });
});

// The section chips scroll in one row on a phone, as the reading tabs do
describe("ReviewSectionNav", () => {
  it("keeps the sections on one scrolling row below sm", async () => {
    const source = (await import("fs")).readFileSync(
      (await import("path")).resolve(__dirname, "../../components/ebooks/review-section.tsx"), "utf8");
    expect(source).toContain('className="flex flex-wrap gap-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:whitespace-nowrap max-sm:[scrollbar-width:none]"');
    expect(source).toContain('<li key={key} className="shrink-0">');
  });
});
