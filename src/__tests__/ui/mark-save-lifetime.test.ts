// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, startTransition, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HuntAssessmentControl } from "@/components/books/hunt-assessment-control";
import { PoisonToggle } from "@/components/books/poison-toggle";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
const calls = vi.hoisted(() => ({ hunt: vi.fn(), poison: vi.fn(), favourite: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: calls.refresh }) }));
vi.mock("@/lib/actions/catalogue-client", () => ({ updateHuntAssessment: calls.hunt, setPoison: calls.poison, setFavourite: calls.favourite }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { error: calls.error } }));
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({ useShortcut: () => {} }));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const cases = [
  { name: "rare", render: () => h(HuntAssessmentControl, { workId: "book" }), save: calls.hunt, result: { isRare: true, huntAssessedOn: "2026-10-29" } },
  { name: "anathema", render: () => h(PoisonToggle, { workId: "book" }), save: calls.poison, result: { isPoison: true } },
  { name: "favourite", render: () => h(FavouriteToggle, { favourite: false, target: { entity: "work", id: "book" } }), save: calls.favourite, result: undefined },
];
for (const item of cases) describe(item.name, () => {
  it("releases busy after saving even while a real React refresh transition remains suspended", async () => {
    const save = deferred<unknown>(), refresh = deferred<void>(); let ready = false;
    item.save.mockReturnValue(save.promise);
    function PagePart({ version }: { version: number }) { if (version && !ready) throw refresh.promise; return h("p", null, version ? "New view" : "Old view"); }
    function Harness() {
      const [version, setVersion] = useState(0);
      calls.refresh.mockImplementation(() => startTransition(() => setVersion(1)));
      return h("div", null, item.render(), h(Suspense, { fallback: h("p", null, "Refreshing") }, h(PagePart, { version })));
    }
    act(() => root.render(h(Harness)));
    const button = host.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    act(() => { button.click(); button.click(); });
    expect(item.save).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => { save.resolve(item.result); await Promise.resolve(); });
    expect(calls.refresh).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Old view");
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { ready = true; refresh.resolve(); });
    expect(host.textContent).toContain("New view");
  });
  it("releases busy and reports a refused save without leaving the optimistic mark on", async () => {
    const save = deferred<unknown>(); item.save.mockReturnValue(save.promise);
    act(() => root.render(item.render())); const button = host.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    act(() => button.click());
    await act(async () => { save.reject(new Error("Save unavailable")); await Promise.resolve(); });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(calls.error).toHaveBeenCalledOnce(); expect(calls.refresh).not.toHaveBeenCalled();
  });
});
