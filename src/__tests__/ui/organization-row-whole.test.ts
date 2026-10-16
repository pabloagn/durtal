import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { contributionParts, contributionText, organizationRoleLabels, organizationRoleText } from "@/lib/catalogue/organizations";

// Design polish pass 4, item 3 (SLN-831): on a phone every organization's
// roles line ended in an ellipsis ("Perfume house · Manufacturer · Production
// compa…"), and it is the only line that says what the organization is.

const row = readFileSync(path.resolve(__dirname, "../../components/organizations/organization-list.tsx"), "utf8");

describe("an organization's row", () => {
  it("cuts nothing: the name wraps, the roles and counts wrap between parts", () => {
    expect(row).not.toMatch(/\btruncate\b/);
    expect(row).toContain('<h3 className="type-item-title [overflow-wrap:anywhere]');
    expect(row).toContain("<FactsRow facts={about} small />");
    expect(row).toContain("<FactsRow facts={counts} small />");
    // One counts line for both layouts
    expect(row.match(/<FactsRow facts=\{counts\}/g)).toHaveLength(1);
  });

  it("gives the roles and counts as parts, and as text joined by ·", () => {
    expect(organizationRoleLabels(["retailer", "perfume_house"])).toEqual(["Perfume house", "Retailer"]);
    expect(organizationRoleText(["retailer", "perfume_house"])).toBe("Perfume house · Retailer");
    const counts = { editions: 1200, houses: 0, wanted: 0, perfumes: 1, films: 3, paintings: 0, venues: 0, supplied: 0 };
    expect(contributionParts(counts)).toEqual(["999+ editions", "1 perfume", "3 films"]);
    expect(contributionText(counts)).toBe("999+ editions · 1 perfume · 3 films");
  });
});
