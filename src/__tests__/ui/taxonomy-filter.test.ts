// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The taxonomy item filter (SLN-881): accents and case ignored, every typed
// letter kept however slow the server is, and the shared no-match state

const route = vi.hoisted(() => ({ query: "", replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: route.replace, push: route.push, refresh: route.refresh }),
  useSearchParams: () => new URLSearchParams(route.query),
  usePathname: () => "/taxonomy/film-genres",
}));
import { TaxonomyFamilyShell } from "../../app/(catalogue)/taxonomy/[familySlug]/taxonomy-family-shell";

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const family = {
  id: "f1", name: "Film genres", slug: "film-genres", description: null, icon: null, color: null,
  isSystem: true, entityLevel: "work", hierarchical: false, sortOrder: 0, applicability: [],
};
const item = (id: string, name: string) => ({ id, name, slug: id, color: null, entityCount: 0 });
const items = [item("a", "Décadentisme"), item("b", "Gothique"), item("c", "Film noir")];

let root: Root, host: HTMLElement;
const render = () => act(() => root.render(createElement(TaxonomyFamilyShell, { family, items })));
const input = () => host.querySelector('input[aria-label="Filter items"]') as HTMLInputElement;
const shown = () => items.map((i) => i.name).filter((name) => host.textContent?.includes(name));
function key(value: string) {
  act(() => {
    input().focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  route.query = "";
  route.replace.mockReset();
  route.push.mockReset();
  window.history.replaceState(null, "", "/taxonomy/film-genres");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("taxonomy item filter", () => {
  it("ignores accents and case", () => {
    key("DECADENTISME");
    expect(shown()).toEqual(["Décadentisme"]);
    key("gothique film");
    expect(shown()).toEqual([]);
    key("noir");
    expect(shown()).toEqual(["Film noir"]);
  });

  it("keeps every letter typed, with no server request, and puts the filter in the address after a pause", () => {
    for (const [i] of [..."decadent"].entries()) key("decadent".slice(0, i + 1));
    expect(input().value).toBe("decadent");
    expect(shown()).toEqual(["Décadentisme"]);
    advance(299);
    expect(window.location.search).toBe("");
    advance(1);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("decadent");
    // The address comes back with what was written: the field keeps what was typed since
    key("decadentism");
    route.query = "q=decadent";
    render();
    expect(input().value).toBe("decadentism");
    expect(route.replace).not.toHaveBeenCalled();
  });

  it("takes the address's filter when it changes from elsewhere, as after back", () => {
    key("noir");
    advance(300);
    route.query = "q=goth";
    render();
    expect(input().value).toBe("goth");
    expect(shown()).toEqual(["Gothique"]);
  });

  it("says nothing matches and offers Clear search", () => {
    route.query = "sort=alphabetical";
    render();
    key("zzqxv");
    expect(host.textContent).toContain("No items found");
    expect(host.textContent).toContain('No items match "zzqxv".');
    const clear = [...host.querySelectorAll("a")].find((a) => a.textContent === "Clear search");
    expect(clear?.getAttribute("href")).toBe("/taxonomy/film-genres?sort=alphabetical");
    // It clears here, before the address has the filter, and leaves focus in the field
    act(() => clear!.click());
    expect(input().value).toBe("");
    expect(shown()).toEqual(["Décadentisme", "Gothique", "Film noir"]);
    expect(document.activeElement).toBe(input());
    advance(300);
    expect(new URLSearchParams(window.location.search).get("q")).toBeNull();
    expect(route.push).not.toHaveBeenCalled();
  });
  it("keeps typing and focus when a slow server filter response arrives", () => {
    const browse={total:900,familyTotal:900,wholeTree:false,page:1,perPage:48,nested:false};
    const draw=()=>act(()=>root.render(createElement(TaxonomyFamilyShell,{family,items,browse})));
    draw(); key("decadent"); advance(300);
    expect(route.replace).toHaveBeenCalledWith("/taxonomy/film-genres?q=decadent",{scroll:false});
    key("decadentism"); route.query="q=decadent"; draw();
    expect(input().value).toBe("decadentism");
    expect(document.activeElement).toBe(input());
  });

});
