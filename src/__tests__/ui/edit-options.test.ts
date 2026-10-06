// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditOptionGroup, EditOptions } from "@/lib/catalogue/edit-options";

// The edit dialogs' lists, loaded when a dialog opens (SLN-510)

const getEditOptions = vi.fn<(groups: EditOptionGroup[]) => Promise<EditOptions>>();
vi.mock("@/lib/actions/edit-options", () => ({ getEditOptions: (groups: EditOptionGroup[]) => getEditOptions(groups) }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  getEditOptions.mockReset();
  // A fresh module each time: its cache lives for the page
  vi.resetModules();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const settle = (ms = 0) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const lists = (groups: EditOptionGroup[]) =>
  Object.fromEntries(groups.map((g) => [g, [{ id: `${g}-1`, name: `${g} one` }]])) as EditOptions;

async function probe() {
  const { useEditOptions, preloadEditOptions } = await import("@/hooks/use-edit-options");
  function Probe({ groups, open, id }: { groups: EditOptionGroup[]; open: boolean; id: string }) {
    const { options, loading, failed, retry } = useEditOptions(groups, open);
    return createElement(
      "div",
      { id },
      createElement("span", { "data-state": "" }, failed ? "failed" : loading ? "loading" : "ready"),
      createElement("span", { "data-lists": "" }, JSON.stringify(options)),
      createElement("button", { onClick: retry }, "retry"),
    );
  }
  return { Probe, preloadEditOptions };
}
const state = (id: string) => host.querySelector(`#${id} [data-state]`)?.textContent;
const loaded = (id: string) => JSON.parse(host.querySelector(`#${id} [data-lists]`)?.textContent ?? "{}") as EditOptions;

describe("useEditOptions", () => {
  it("loads nothing until the dialog opens", async () => {
    const { Probe } = await probe();
    act(() => root.render(createElement(Probe, { groups: ["genres", "tags"], open: false, id: "a" })));
    await settle();
    expect(getEditOptions).not.toHaveBeenCalled();
    expect(state("a")).toBe("loading");
  });

  it("asks once for the lists two open dialogs share, and asks only for the missing ones", async () => {
    getEditOptions.mockImplementation(async (groups) => lists(groups));
    const { Probe } = await probe();
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(Probe, { groups: ["genres", "tags"], open: true, id: "a" }),
          createElement(Probe, { groups: ["genres", "tags"], open: true, id: "b" }),
        ),
      ),
    );
    await settle();
    expect(getEditOptions).toHaveBeenCalledTimes(1);
    expect(getEditOptions).toHaveBeenCalledWith(["genres", "tags"]);
    expect(state("a")).toBe("ready");
    expect(loaded("b").tags).toEqual([{ id: "tags-1", name: "tags one" }]);

    act(() => root.render(createElement(Probe, { groups: ["tags", "themes"], open: true, id: "c" })));
    await settle();
    expect(getEditOptions).toHaveBeenCalledTimes(2);
    expect(getEditOptions).toHaveBeenLastCalledWith(["themes"]);
  });

  it("keeps a loaded list for a minute, then loads it again on the next open, showing the old copy meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    getEditOptions.mockImplementation(async (groups) => lists(groups));
    const { Probe } = await probe();
    act(() => root.render(createElement(Probe, { groups: ["genres"], open: true, id: "a" })));
    await settle();
    act(() => root.render(createElement(Probe, { groups: ["genres"], open: false, id: "a" })));
    act(() => root.render(createElement(Probe, { groups: ["genres"], open: true, id: "a" })));
    await settle();
    expect(getEditOptions).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61_000);
    let resolve: (v: EditOptions) => void = () => {};
    getEditOptions.mockImplementation(() => new Promise((r) => (resolve = r)));
    act(() => root.render(createElement(Probe, { groups: ["genres"], open: false, id: "a" })));
    act(() => root.render(createElement(Probe, { groups: ["genres"], open: true, id: "a" })));
    expect(getEditOptions).toHaveBeenCalledTimes(2);
    expect(state("a")).toBe("ready");
    await act(async () => resolve({ genres: [{ id: "g2", name: "New" }] }));
    expect(loaded("a").genres).toEqual([{ id: "g2", name: "New" }]);
  });

  it("says when the load fails, and Retry loads again", async () => {
    getEditOptions.mockRejectedValueOnce(new Error("offline")).mockImplementation(async (groups) => lists(groups));
    const { Probe } = await probe();
    act(() => root.render(createElement(Probe, { groups: ["series"], open: true, id: "a" })));
    await settle();
    expect(state("a")).toBe("failed");
    act(() => host.querySelector<HTMLButtonElement>("#a button")!.click());
    await settle();
    expect(state("a")).toBe("ready");
    expect(getEditOptions).toHaveBeenCalledTimes(2);
  });

  it("preloads on a sign of use, so the dialog opens full", async () => {
    getEditOptions.mockImplementation(async (groups) => lists(groups));
    const { Probe, preloadEditOptions } = await probe();
    preloadEditOptions(["genres", "tags"]);
    preloadEditOptions(["genres", "tags"]);
    await settle();
    act(() => root.render(createElement(Probe, { groups: ["genres", "tags"], open: true, id: "a" })));
    expect(state("a")).toBe("ready");
    expect(getEditOptions).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed preload quiet", async () => {
    getEditOptions.mockRejectedValue(new Error("offline"));
    const { preloadEditOptions } = await probe();
    const rejections: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);
    window.addEventListener("unhandledrejection", onRejection);
    preloadEditOptions(["genres"]);
    await settle(10);
    window.removeEventListener("unhandledrejection", onRejection);
    expect(rejections).toEqual([]);
  });
});

describe("withChosen", () => {
  it("shows the chosen items while the list loads, then the list with any chosen item it lacks", async () => {
    const { withChosen } = await import("@/lib/catalogue/edit-options");
    const chosen = [{ id: "b", name: "B" }, { id: "z", name: "Z, made since" }];
    expect(withChosen(undefined, chosen)).toEqual(chosen);
    expect(withChosen([{ id: "a", name: "A" }, { id: "b", name: "B" }], chosen).map((o) => o.id)).toEqual(["a", "b", "z"]);
    expect(withChosen([], [])).toEqual([]);
  });

  it("names every dialog's lists among the groups the action loads", async () => {
    const { EDIT_OPTION_GROUPS, EDITION_GROUPS, TAXONOMY_GROUPS, WORK_EDIT_GROUPS } = await import("@/lib/catalogue/edit-options");
    const all = [...WORK_EDIT_GROUPS, ...TAXONOMY_GROUPS, ...EDITION_GROUPS];
    expect([...all].sort()).toEqual([...EDIT_OPTION_GROUPS].sort());
  });
});

describe("OptionsNotice", () => {
  async function draw(props: { loading: boolean; failed: boolean; onRetry?: () => void }) {
    const { OptionsNotice } = await import("@/components/shared/options-notice");
    act(() => root.render(createElement(OptionsNotice, { onRetry: () => {}, ...props })));
  }

  it("says nothing for a quick load, then one quiet line", async () => {
    await draw({ loading: true, failed: false });
    expect(host.textContent).toBe("");
    await settle(150);
    expect(host.textContent).toBe("");
    await settle(100);
    expect(host.querySelector("[data-options-loading]")?.textContent).toBe("Loading the lists…");
    await draw({ loading: false, failed: false });
    expect(host.textContent).toBe("");
  });

  it("shows a failed load with Retry", async () => {
    const onRetry = vi.fn();
    await draw({ loading: false, failed: true, onRetry });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not load the lists.Retry");
    act(() => host.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
