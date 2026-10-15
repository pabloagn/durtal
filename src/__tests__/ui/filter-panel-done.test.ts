// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";

// The filter panel's apply and clear flow (SLN-641): a choice applies at
// once, Done (or Enter, or Esc) closes the panel with focus back on Filter,
// and Clear all at its foot removes every choice

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
let url: URLSearchParams;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  url = new URLSearchParams("sort=title");
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const groups: AnyFilterGroup[] = [
  { section: "Reading", key: "reading", label: "Reading", options: [{ value: "read", label: "Read" }] },
  {
    section: "Reading",
    key: "ebook",
    label: "eBook",
    options: [
      { value: "yes", label: "Available in the reader" },
      { value: "no", label: "No readable eBook" },
    ],
  },
  { section: "Book", key: "lang", label: "Language", options: [{ value: "fr", label: "French" }] },
];

/** The panel over a URL, as a list page holds it */
function Harness() {
  const [, rerender] = useState(0);
  const list = (key: string) => url.get(key)?.split(",").filter(Boolean) ?? [];
  return createElement(FilterDropdown, {
    groups,
    sections: ["Reading", "Book"],
    activeFilters: { reading: list("reading"), ebook: list("ebook"), lang: list("lang") },
    onFilterChange: (key, values) => {
      if (values.length) url.set(key, values.join(","));
      else url.delete(key);
      rerender((n) => n + 1);
    },
    onClearAll: () => {
      for (const key of ["reading", "ebook", "lang"]) url.delete(key);
      rerender((n) => n + 1);
    },
  });
}

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) ?? null;
const panelOpen = () => !!button("Done");
const footer = () => button("Done")!.parentElement!.textContent;
const choose = (label: string) =>
  act(() => {
    const row = [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(label))!;
    row.querySelector("input")!.click();
  });
const key = (target: Element, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });

describe("filter panel: apply and clear", () => {
  it("applies a choice at once, closes on Done, and Clear all leaves the URL as before", () => {
    act(() => root.render(createElement(Harness)));
    act(() => button("Filter")!.click());
    expect(footer()).toContain("No filters");
    expect(button("Clear all")).toBeNull();

    choose("Available in the reader");
    expect(url.toString()).toBe("sort=title&ebook=yes");
    expect(footer()).toContain("1 active");

    act(() => button("Done")!.click());
    expect(panelOpen()).toBe(false);
    expect(document.activeElement).toBe(button("Filter"));
    // The button counts what is chosen
    expect(button("Filter")!.textContent).toBe("Filter1");

    act(() => button("Filter")!.click());
    act(() => button("Clear all")!.click());
    expect(url.toString()).toBe("sort=title");
    expect(footer()).toContain("No filters");
    expect(panelOpen()).toBe(true);
  });

  it("closes on Enter from an option, and on Esc; a section tab keeps its Enter", () => {
    act(() => root.render(createElement(Harness)));
    act(() => button("Filter")!.click());
    const tab = host.querySelector('[role="tab"]')!;
    key(tab, "Enter");
    expect(panelOpen()).toBe(true);

    choose("Read");
    const option = [...host.querySelectorAll("label")].find((l) => l.textContent === "Read")!.querySelector("input")!;
    key(option, "Enter");
    expect(panelOpen()).toBe(false);
    expect(url.get("reading")).toBe("read");
    expect(document.activeElement).toBe(button("Filter"));

    act(() => button("Filter")!.click());
    key(host.querySelector('[role="tabpanel"]')!, "Escape");
    expect(panelOpen()).toBe(false);
  });

  it("keeps Clear all and Done at 44px on touch", () => {
    url.set("lang", "fr");
    act(() => root.render(createElement(Harness)));
    act(() => button("Filter")!.click());
    expect(button("Done")!.className).toContain("pointer-coarse:min-h-11");
    // A text command grows to 44px tall on touch around its line
    expect(button("Clear all")!.className).toContain("text-command");
  });
});
