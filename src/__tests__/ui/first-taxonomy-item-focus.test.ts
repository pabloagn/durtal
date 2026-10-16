// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/taxonomy/first",
}));
vi.mock("@/components/taxonomy/create-item-dialog", () => ({
  CreateItemDialog: ({ open, onCreated, onClose }: { open: boolean; onCreated: (id: string) => void; onClose: () => void }) =>
    open ? h("button", { onClick: () => { onCreated("new-item"); onClose(); } }, "Complete creation") : null,
}));
import { TaxonomyFamilyShell } from "@/app/(catalogue)/taxonomy/[familySlug]/taxonomy-family-shell";
const family = { id: "family", name: "First", slug: "first", description: null, icon: null, color: null, isSystem: false, entityLevel: "work", hierarchical: false, sortOrder: 0, applicability: [] };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { document.body.innerHTML = ""; });
it("focuses the first created row once refreshed data arrives", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(h(TaxonomyFamilyShell, { family, items: [] })));
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("New item"))!;
    act(() => add.click());
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Complete creation")!.click());
    act(() => root.render(h(TaxonomyFamilyShell, { family, items: [{ id: "new-item", name: "First term", slug: "first-term", color: null, entityCount: 0, sortOrder: 0 }] })));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(host.querySelector('[data-taxonomy-item-name="new-item"]'));
    expect(document.activeElement?.textContent).toBe("First term");
  } finally { act(() => root.unmount()); }
});
