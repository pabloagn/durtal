// @vitest-environment happy-dom
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/named-duplicates", () => ({
  findNamedDuplicates: lookup,
}));
import { NameDuplicateNotice } from "@/components/shared/name-duplicate-notice";
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = "";
  lookup.mockReset();
});
it("shows the existing record as advice while leaving the save available", async () => {
  lookup.mockResolvedValue([
    { id: "one", name: "Étoile", href: "/people/etoile" },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        h(
          "div",
          null,
          h(NameDuplicateNotice, { kind: "person", name: "ETOILE" }),
          h("button", null, "Save"),
        ),
      ),
    );
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(host.textContent).toContain("You can still add another");
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "/people/etoile",
    );
    expect(host.querySelector("button")?.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});
it("hides stale advice as soon as the entered name changes", async () => {
  lookup.mockResolvedValue([
    { id: "one", name: "First", href: "/people/first" },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(h(NameDuplicateNotice, { kind: "person", name: "First" })),
    );
    await act(() => new Promise((r) => setTimeout(r, 350)));
    expect(host.querySelector("a")).not.toBeNull();
    act(() =>
      root.render(h(NameDuplicateNotice, { kind: "person", name: "Second" })),
    );
    expect(host.querySelector("a")).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});
