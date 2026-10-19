// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Settings > Display (SLN-925): every list that saves a view or size is in
// the table, the grid sizes are a maximum, the sidebar switch leaves phones,
// and Reset names everything it clears

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { DisplaySettings } from "@/app/(catalogue)/settings/display/display-settings";
import { useHomeView } from "@/components/domains/domain-home-shell";
import { LIST_PREFERENCES } from "@/lib/preferences";
import { deleteCookie, preferenceCookieNames } from "@/lib/utils/preference-cookies";

let root: Root, host: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  for (const name of preferenceCookieNames()) deleteCookie(name);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(DisplaySettings)));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const control = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
function choose(label: string, option: string) {
  act(() => control(label)!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === option);
  act(() => item!.click());
}

describe("display settings", () => {
  it("lists Films, Perfumes, Paintings and a publisher's books, each with its view and grid size", () => {
    for (const list of ["Films", "Perfumes", "Paintings", "A publisher's books"]) {
      expect(control(`${list}: view`), list).not.toBeNull();
      expect(control(`${list}: cards per row`), list).not.toBeNull();
    }
    for (const list of ["Films", "Perfumes", "Paintings"]) expect(control(`${list}: items per page`), list).not.toBeNull();
    // Each publisher keeps its own page size
    expect(control("A publisher's books: items per page")).toBeNull();
  });

  it("lists Organizations with its page size, its one view having nothing to choose", () => {
    expect(control("Organizations: items per page")).not.toBeNull();
    expect(control("Organizations: view")).toBeNull();
    expect(control("Organizations: cards per row")).toBeNull();
  });

  it("changes the view the films list shows", () => {
    choose("Films: view", "List");
    expect(document.cookie).toContain(`${LIST_PREFERENCES.films.view.key}=`);
    let seen = "";
    function Films() {
      seen = useHomeView("film").viewMode;
      return null;
    }
    const other = createRoot(document.createElement("div"));
    act(() => other.render(createElement(Films)));
    expect(seen).toBe("list");
    act(() => other.unmount());
  });

  it("offers grid sizes as a maximum", () => {
    act(() => control("Books: cards per row")!.click());
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toHaveLength(7);
    expect(options.every((o) => o?.startsWith("Up to "))).toBe(true);
    expect(options.some((o) => o?.startsWith("Up to 6 per row"))).toBe(true);
  });

  it("leaves the sidebar switch off phones, where the sidebar is a drawer", () => {
    const section = host.querySelector("#sidebar-collapsed")!.closest("section")!;
    expect(section.className).toContain("max-md:hidden");
  });

  it("names everything Reset clears", () => {
    const reset = [...host.querySelectorAll("button")].find((b) => b.textContent === "Reset")!;
    act(() => reset.click());
    const text = document.body.textContent ?? "";
    expect(text).toContain("the sort of Books");
    expect(text).toContain("the sidebar width");
    expect(text).toContain("“I’m at” place in Up next");
  });
});
