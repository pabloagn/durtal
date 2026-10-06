import { describe, it, expect } from "vitest";
import { draftsToCreate, newCopyLocationId } from "@/lib/utils/instance-drafts";

// ── newCopyLocationId ─────────────────────────────────────────────────────────

describe("newCopyLocationId", () => {
  const locations = [
    { id: "cal", name: "eBooks" },
    { id: "ams", name: "Amsterdam" },
  ];

  it("uses the default location from Settings", () => {
    expect(newCopyLocationId(locations, "ams")).toBe("ams");
  });

  it("starts with no location when Settings has none", () => {
    expect(newCopyLocationId(locations, null)).toBe("");
  });

  it("starts with no location when the default is not offered", () => {
    expect(newCopyLocationId(locations, "gone")).toBe("");
    expect(newCopyLocationId([], "ams")).toBe("");
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
