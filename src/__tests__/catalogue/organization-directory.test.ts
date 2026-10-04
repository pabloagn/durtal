import { describe, expect, it } from "vitest";
import {
  DIRECTORY_ROLES,
  ORGANIZATION_ROLE_LABELS,
  boundedCount,
  contributionText,
  organizationRoleText,
} from "@/lib/catalogue/organizations";
import { NAV_SECTIONS } from "@/lib/navigation";
import { SECTION_ICONS } from "@/components/shortcuts/section-icons";

describe("organization directory words", () => {
  it("names each role in its collection's words, in one order", () => {
    expect(DIRECTORY_ROLES.every((role) => ORGANIZATION_ROLE_LABELS[role].one)).toBe(true);
    expect(organizationRoleText(["museum", "publisher", "perfume_house"])).toBe(
      "Publisher · Perfume house · Museum",
    );
    expect(organizationRoleText(["group", "retailer"])).toBe("Publishing group · Retailer");
    expect(organizationRoleText(["distribution_company"])).toBe("Distributor");
    expect(organizationRoleText([])).toBe("");
  });

  it("counts up to the cap, then says 999+", () => {
    expect(boundedCount(0)).toBe("0");
    expect(boundedCount(999)).toBe("999");
    expect(boundedCount(1000)).toBe("999+");
    const none = { editions: 0, houses: 0, wanted: 0, perfumes: 0, films: 0, paintings: 0, venues: 0, supplied: 0 };
    expect(contributionText({ ...none, editions: 1000, perfumes: 1, paintings: 2 })).toBe(
      "999+ editions · 1 perfume · 2 paintings",
    );
    expect(contributionText({ ...none, houses: 3, wanted: 1 })).toBe("3 houses under it · 1 book wanted");
    expect(contributionText({ ...none, venues: 1, supplied: 2 })).toBe("1 venue · 2 copies supplied");
    expect(contributionText(none)).toBe("");
  });

  it("lists the directory in the sidebar after Publishers, with its icon", () => {
    const hrefs = NAV_SECTIONS.map((s) => s.href);
    expect(hrefs.indexOf("/organizations")).toBe(hrefs.indexOf("/publishers") + 1);
    expect(NAV_SECTIONS.every((s) => SECTION_ICONS[s.href])).toBe(true);
  });
});
