import { describe, it, expect } from "vitest";
import { draftsToCreate, pickDefaultLocationId } from "@/lib/utils/instance-drafts";

// ── pickDefaultLocationId ─────────────────────────────────────────────────────

describe("pickDefaultLocationId", () => {
  it("prefers Amsterdam", () => {
    expect(
      pickDefaultLocationId([
        { id: "cal", name: "Calibre" },
        { id: "mex", name: "Mexico City" },
        { id: "ams", name: "Amsterdam" },
      ]),
    ).toBe("ams");
  });

  it("falls back to Mexico City", () => {
    expect(
      pickDefaultLocationId([
        { id: "cal", name: "Calibre" },
        { id: "mex", name: "Mexico City Apartment" },
      ]),
    ).toBe("mex");
  });

  it("matches names case-insensitively", () => {
    expect(pickDefaultLocationId([{ id: "x", name: "AMSTERDAM (home)" }])).toBe("x");
  });

  it("falls back to the first location", () => {
    expect(
      pickDefaultLocationId([
        { id: "a", name: "Storage" },
        { id: "b", name: "Office" },
      ]),
    ).toBe("a");
  });

  it("returns an empty id when there are no locations", () => {
    expect(pickDefaultLocationId([])).toBe("");
  });
});

// ── draftsToCreate ─────────────────────────────────────────────────────────────

describe("draftsToCreate", () => {
  const withLocation = { locationId: "ams", format: "paperback" };
  const withoutLocation = { locationId: "", format: "paperback" };

  it("creates nothing when copies are skipped, even with a location set", () => {
    expect(draftsToCreate([withLocation, withLocation], true)).toEqual([]);
  });

  it("creates every draft with a location when not skipped", () => {
    expect(draftsToCreate([withLocation, withoutLocation, withLocation], false)).toEqual([
      withLocation,
      withLocation,
    ]);
  });

  it("never creates a draft without a location", () => {
    expect(draftsToCreate([withoutLocation], false)).toEqual([]);
  });
});
