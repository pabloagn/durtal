// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_INSTANCE, InstanceForm, type InstanceDraft } from "@/components/books/instance-form";

// A printed copy is kept in a physical place and a file in a digital one, as
// the film copy form does (SLN-1060)

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

const LOCATIONS = [
  { id: "study", name: "Study", type: "physical", subLocations: [] },
  { id: "kindle", name: "Kindle", type: "digital", subLocations: [] },
];

const options = (id: string) => {
  const trigger = host.querySelector<HTMLButtonElement>(`#${id}`)!;
  act(() => trigger.click());
  const list = [...host.querySelectorAll("[role=listbox] [role=option]")].map((o) => (o.textContent ?? "").replace("✓", "").trim());
  act(() => trigger.click());
  return list.filter((t) => t && !t.endsWith("..."));
};

function draw(value: InstanceDraft, onChange: (v: InstanceDraft) => void = () => {}) {
  act(() => root.render(createElement(InstanceForm, { value, onChange, locations: LOCATIONS, index: 0 })));
}

describe("copy form locations", () => {
  it.each([
    ["paperback", ["Study, physical"]],
    ["hardcover", ["Study, physical"]],
    ["epub", ["Kindle, digital"]],
    ["pdf", ["Kindle, digital"]],
    ["audiobook", ["Study, physical", "Kindle, digital"]],
    ["", ["Study, physical", "Kindle, digital"]],
  ])("lists the places a %s copy can be kept", (format, expected) => {
    draw({ ...EMPTY_INSTANCE, format });
    expect(options("inst-0-location")).toEqual(expected);
  });

  it("keeps a saved place listed, so it never reads as empty", () => {
    draw({ ...EMPTY_INSTANCE, format: "paperback", locationId: "kindle" });
    expect(options("inst-0-location")).toEqual(["Study, physical", "Kindle, digital"]);
  });

  it("clears a place the new format cannot be kept in, and keeps one it can", () => {
    const seen: InstanceDraft[] = [];
    const pick = (format: string) => {
      const trigger = host.querySelector<HTMLButtonElement>("#inst-0-format")!;
      act(() => trigger.click());
      const option = [...host.querySelectorAll<HTMLElement>("[role=listbox] [role=option]")].find(
        (o) => (o.textContent ?? "").replace("✓", "").trim() === format,
      )!;
      act(() => option.click());
    };
    draw({ ...EMPTY_INSTANCE, format: "epub", locationId: "kindle" }, (v) => seen.push(v));
    pick("Paperback");
    expect(seen.at(-1)).toMatchObject({ format: "paperback", locationId: "", subLocationId: "" });
    pick("PDF");
    expect(seen.at(-1)).toMatchObject({ format: "pdf", locationId: "kindle" });
    pick("Audiobook");
    expect(seen.at(-1)).toMatchObject({ format: "audiobook", locationId: "kindle" });
  });
});
