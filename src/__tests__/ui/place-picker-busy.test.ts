// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The place picker is busy from the first key, and only the newest search's
// answer shows (SLN-806)

const pending = vi.hoisted(() => new Map<string, (rows: { id: string; name: string; fullName: string }[]) => void>());
vi.mock("@/lib/actions/places", () => ({
  searchPlaces: vi.fn((q: string) => new Promise((resolve) => pending.set(q, resolve))),
  createPlace: vi.fn(),
  createPlaceFromGeocode: vi.fn(),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
import { PlacePicker } from "@/components/shared/place-picker";

let root: Root;
let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers();
  pending.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(PlacePicker, { label: "Born in", value: null, onChange: () => {} })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const input = () => host.querySelector("input")!;
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const spinner = () => host.querySelector('svg[role="status"]');
const rows = () => [...host.querySelectorAll("button")].map((b) => b.textContent).filter((t) => !/Search worldwide|Add /.test(t ?? ""));
const place = (name: string) => [{ id: name, name, fullName: name }];

describe("the place picker's wait", () => {
  it("shows from the first key until the answer arrives", async () => {
    type("z");
    expect(spinner()).not.toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(spinner()).not.toBeNull();
    await act(async () => pending.get("z")!(place("Zürich")));
    expect(spinner()).toBeNull();
    expect(rows()).toEqual(["Zürich"]);
  });

  it("drops an older answer that arrives after a newer key", async () => {
    type("zu");
    act(() => vi.advanceTimersByTime(300));
    type("zur");
    act(() => vi.advanceTimersByTime(300));
    // The first search answers last
    await act(async () => pending.get("zur")!(place("Zürich")));
    await act(async () => pending.get("zu")!(place("Zug")));
    expect(rows()).toEqual(["Zürich"]);
    expect(spinner()).toBeNull();
  });

  it("stays busy while a newer search is still on its way", async () => {
    type("zu");
    act(() => vi.advanceTimersByTime(300));
    type("zur");
    await act(async () => pending.get("zu")!(place("Zug")));
    expect(spinner()).not.toBeNull();
    expect(rows()).toEqual([]);
  });
});

// A long place name widened the edit form past a 320px phone, because a
// fieldset sizes to its content's narrowest width. The browser layout is
// measured by hand; this pins the class it rests on (SLN-820)
it("keeps long place names inside the list's width", async () => {
  type("par");
  act(() => vi.advanceTimersByTime(300));
  await act(async () => pending.get("par")!(place("Paris 6e Arrondissement, Saint-Germain-des-Prés, Île-de-France, France")));
  const list = host.querySelector("button")!.parentElement!;
  expect(list.className.split(" ")).toEqual(expect.arrayContaining(["overflow-y-auto", "[contain:inline-size]"]));
  // and shows each name in full, wrapping it: names are never cut
  const names = [...list.querySelectorAll("button > span:last-child")];
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    expect(name.className.split(" ")).toContain("[overflow-wrap:anywhere]");
    expect(name.className).not.toContain("truncate");
  }
});
