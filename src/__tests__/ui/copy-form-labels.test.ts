// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_INSTANCE, InstanceForm } from "@/components/books/instance-form";

// The copy form names formats, conditions, statuses and dispositions in
// words, never as stored keys (SLN-400)

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The options a select lists once open, without its placeholder */
const options = (id: string) => {
  const trigger = host.querySelector<HTMLButtonElement>(`#${id}`)!;
  act(() => trigger.click());
  const list = [...host.querySelectorAll("[role=listbox] [role=option]")].map((o) => (o.textContent ?? "").replace("✓", "").trim());
  act(() => trigger.click());
  return list.filter((t) => t && !t.endsWith("..."));
};

describe("copy form labels", () => {
  it("shows words, not keys", () => {
    act(() =>
      root.render(
        createElement(InstanceForm, {
          value: { ...EMPTY_INSTANCE, status: "deaccessioned" },
          onChange: () => {},
          locations: [],
          index: 0,
        }),
      ),
    );
    expect(options("inst-0-format")).toEqual(["Hardcover", "Paperback", "E-book", "Audiobook", "PDF", "EPUB", "Other"]);
    expect(options("inst-0-condition")).toContain("Very good");
    expect(options("inst-0-status")).toContain("Lent out");
    expect(options("inst-0-disposition-type")).toEqual([
      "Sold", "Donated", "Gifted", "Traded", "Lost", "Stolen", "Destroyed", "Returned", "Expired",
    ]);
    const all = ["inst-0-format", "inst-0-condition", "inst-0-status", "inst-0-disposition-type"].flatMap(options);
    expect(all.filter((t) => /_|^[a-z]/.test(t))).toEqual([]);
  });
});
