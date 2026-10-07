// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The goal dialog's one trigger (SLN-455), on a page that is not the hub, with the actions mocked.

const actions = vi.hoisted(() => ({
  getGoalDialogData: vi.fn(async () => ({
    year: 2026,
    goals: [{ year: 2026, metric: "books", target: 30, countRereads: true, excludedWorkTypeIds: [] as string[] }],
    workTypes: [{ id: "t1", name: "Reference" }],
    history: [{ year: 2025, metric: "books", target: 30, count: 28 }],
  })),
  setReadingGoal: vi.fn(async () => ({})),
  removeReadingGoal: vi.fn(async () => ({})),
}));
vi.mock("@/lib/actions/reading-goals", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
// The lazy dialog, loaded through React.lazy so the test can wait for it
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (load: () => Promise<React.ComponentType<object>>) => {
      const Lazy = React.lazy(() => load().then((c) => ({ default: c })));
      return (props: object) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    },
  };
});

import { GoalDialogButton } from "@/components/reading/goal-dialog-button";

// The dialog's modules take 1 to 4 s to load the first time, more under a full run's load, and that time
// counted inside the test's 5 s. Loaded here, the click still opens it through React.lazy, from the module cache
beforeAll(async () => {
  await import("@/components/reading/goal-dialog");
}, 30_000);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as never;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
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
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe("GoalDialogButton", () => {
  it("opens the goal dialog with this year's goals and the past years, and saves them", async () => {
    await act(async () => root.render(createElement("main", null, createElement(GoalDialogButton))));
    await flush();
    act(() => (host.querySelector("[data-goal-open]") as HTMLButtonElement).click());
    // The dialog's module loads on the first open: wait for it, then for its data
    for (let i = 0; i < 100 && !document.querySelector("[data-goal-dialog]"); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Set a reading goal");
    expect((dialog.querySelector('[data-goal-target="books"]') as HTMLInputElement).value).toBe("30");
    expect(dialog.querySelector("[data-goal-history]")!.textContent).toContain("28 of 30 books in 2025");
    expect(dialog.querySelector("[data-goal-types]")!.textContent).toContain("Reference");
    await act(async () => {
      dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(actions.setReadingGoal).toHaveBeenCalledWith({ year: 2026, metric: "books", target: 30, countRereads: true, excludedWorkTypeIds: [] });
    expect(actions.removeReadingGoal).not.toHaveBeenCalled();
  });
});
