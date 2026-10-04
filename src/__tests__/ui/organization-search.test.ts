// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Which organizations a picker searches (task 0297 review): with `roles` only
 * those kinds; without, every organization, as a venue's "Link an
 * institution" needs.
 */
const { getOrganizations } = vi.hoisted(() => ({
  getOrganizations: vi.fn(async () => ({ rows: [], total: 0 })),
}));
vi.mock("@/lib/actions/organizations", () => ({ getOrganizations, saveOrganization: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({ getPeople: vi.fn(), createPerson: vi.fn() }));
vi.mock("@/components/taxonomy/taxonomy-assignments", () => ({ TaxonomyItemSearch: () => null }));
import { useOrganizationSearch } from "@/components/catalogue/record-fields";
import type { OrganizationRole } from "@/lib/catalogue/organizations";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
let search: (query: string) => Promise<unknown>;

function Probe({ role, roles }: { role: OrganizationRole; roles?: OrganizationRole[] }) {
  search = useOrganizationSearch(role, roles).search;
  return null;
}
const render = (role: OrganizationRole, roles?: OrganizationRole[]) =>
  act(() => root.render(createElement(Probe, { role, roles })));

beforeEach(() => {
  getOrganizations.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useOrganizationSearch", () => {
  it("searches every organization without roles", async () => {
    render("retailer");
    await search("MK2");
    expect(getOrganizations).toHaveBeenCalledWith({ query: "MK2", roles: undefined, limit: 8 });
  });

  it("searches only the given kinds with roles", async () => {
    render("perfume_house", ["perfume_house", "brand", "manufacturer"]);
    await search("Guerlain");
    expect(getOrganizations).toHaveBeenCalledWith({
      query: "Guerlain",
      roles: ["perfume_house", "brand", "manufacturer"],
      limit: 8,
    });
  });
});
