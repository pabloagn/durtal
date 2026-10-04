// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { useLazyOptions } from "@/hooks/use-lazy-options";

// Filter options that load on first use, and long option lists

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

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) ?? null;

describe("useLazyOptions", () => {
  function Probe({ load }: { load: () => Promise<string[]> }) {
    const { value, failed, start } = useLazyOptions(load);
    return createElement(
      "div",
      null,
      createElement("button", { onClick: start }, "start"),
      createElement("span", { id: "state" }, failed ? "failed" : value ? value.join(",") : "none"),
    );
  }
  const state = () => host.querySelector("#state")?.textContent;

  it("loads once, however often it is started", async () => {
    let resolve: (v: string[]) => void = () => {};
    const load = vi.fn(() => new Promise<string[]>((r) => (resolve = r)));
    act(() => root.render(createElement(Probe, { load })));
    expect(state()).toBe("none");
    click(button("start"));
    click(button("start"));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => resolve(["a", "b"]));
    expect(state()).toBe("a,b");
    click(button("start"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("starts again after a failed load", async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(["a"]);
    act(() => root.render(createElement(Probe, { load })));
    click(button("start"));
    await settle();
    expect(state()).toBe("failed");
    click(button("start"));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(state()).toBe("a");
  });
});

describe("FilterDropdown", () => {
  const people = Array.from({ length: 250 }, (_, i) => ({ value: `p${i}`, label: `Person ${i}` }));
  const groups: AnyFilterGroup[] = [{ key: "cast", label: "Cast", options: people }];
  const render = (props: Partial<Parameters<typeof FilterDropdown>[0]> = {}) =>
    act(() =>
      root.render(
        createElement(FilterDropdown, {
          groups,
          activeFilters: {},
          onFilterChange: () => {},
          onClearAll: () => {},
          ...props,
        }),
      ),
    );
  const rows = () => host.querySelectorAll("label").length;
  const countLine = () =>
    [...host.querySelectorAll("p")].map((p) => p.textContent).find((t) => t?.includes("shown")) ?? null;

  it("lists 200 options of a long group and says how many there are", () => {
    render();
    click(button("Filter"));
    expect(rows()).toBe(200);
    expect(countLine()).toBe("200 of 250 shown. Type to narrow.");
  });

  it("keeps chosen options listed past the limit", () => {
    render({ activeFilters: { cast: ["p240", "p249"] } });
    click(button("Filter"));
    expect(rows()).toBe(202);
    const labels = [...host.querySelectorAll("label")].map((l) => l.textContent);
    expect(labels).toContain("Person 240");
    expect(labels).toContain("Person 249");
    expect(countLine()).toBe("202 of 250 shown. Type to narrow.");
  });

  it("has no count line when every option is listed", () => {
    render({ groups: [{ key: "cast", label: "Cast", options: people.slice(0, 20) }] });
    click(button("Filter"));
    expect(rows()).toBe(20);
    expect(countLine()).toBeNull();
  });

  it("starts the load on the first sign of use, and says it is loading or failed", () => {
    const onIntent = vi.fn();
    render({ groups: [], onIntent, loading: true });
    act(() => {
      button("Filter")!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(onIntent).toHaveBeenCalledTimes(1);
    click(button("Filter"));
    expect(onIntent).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[role=status]")?.textContent).toBe("Loading filters…");
    render({ groups: [], onIntent, failed: true });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("did not load");
  });
});
