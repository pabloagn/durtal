// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PaintersField, type PainterEntry } from "@/components/paintings/painting-fields";
import { painterInput } from "@/lib/catalogue/painting-labels";
import { CreditListField, type CreditEntry } from "@/components/perfumes/perfume-fields";

// SLN-1131: a painting's painters and a perfume's people can be put in
// order, as a book's authors and a film's credits can; the list's order is
// what the form saves. Remote searches are replaced; the fields are real.
vi.mock("@/lib/actions/people", () => ({ getPeople: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/actions/organizations", () => ({ getOrganizations: vi.fn(async () => []) }));
vi.mock("@/lib/actions/catalogue-client", () => ({ createPerson: vi.fn(), saveOrganization: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());

it("puts a painting's painters in order, the unknown hand too", () => {
  let latest: PainterEntry[] = [];
  function Field() {
    const [value, setValue] = useState<PainterEntry[]>([
      { key: "p1", personId: "a1", name: "Matthias Grünewald", creditedAs: null, attribution: "confirmed" },
      { key: "p2", personId: null, name: null, creditedAs: null, attribution: "unknown" },
    ]);
    latest = value;
    return createElement(PaintersField, { value, onChange: setValue });
  }
  act(() => root.render(createElement(Field)));
  expect(button("Move Matthias Grünewald up").disabled).toBe(true);
  const down = button("Move Matthias Grünewald down");
  act(() => down.focus());
  click(down);
  expect(latest.map((p) => p.key)).toEqual(["p2", "p1"]);
  // Saved in this order: each credit's place is its sort_order
  expect(painterInput(latest).map((c) => c.personId)).toEqual([null, "a1"]);
  // At the end its Move down turns off: the focus goes to its Move up
  expect(document.activeElement).toBe(button("Move Matthias Grünewald up"));
  expect(button("Remove Matthias Grünewald")).not.toBeNull();
});

it("puts a perfume's people in order, a credit added in the form keeping its row", () => {
  let latest: CreditEntry[] = [];
  function Field() {
    const [value, setValue] = useState<CreditEntry[]>([
      { id: "c1", personId: "a1", name: "Germaine Cellier", creditedAs: null, attribution: "unspecified", roleId: "perfume.perfumer" },
      { key: "new-a", personId: "a2", name: "Edmond Roudnitska", creditedAs: null, attribution: "unspecified", roleId: "perfume.creative_director" },
    ]);
    latest = value;
    return createElement(CreditListField, { label: "People", value, onChange: setValue, roles: true });
  }
  act(() => root.render(createElement(Field)));
  const up = button("Move Edmond Roudnitska up");
  act(() => up.focus());
  click(up);
  expect(latest.map((c) => c.name)).toEqual(["Edmond Roudnitska", "Germaine Cellier"]);
  expect(latest[0]!.roleId).toBe("perfume.creative_director");
  expect(document.activeElement).toBe(button("Move Edmond Roudnitska down"));
});
