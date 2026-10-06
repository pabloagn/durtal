import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  bookHoldings,
  perfumeHoldings,
  filmHoldings,
  paintingHoldings,
} from "@/lib/catalogue/holdings";
import { curationPatchSchema } from "@/lib/catalogue/curation";
import {
  WORK_DOMAINS,
  kindsWithCapability,
  canUseWorkCapability,
} from "@/lib/catalogue/domains";
import { WORK_KINDS } from "@/lib/catalogue/kinds";
import type { InstanceWithLocation } from "@/lib/utils/ownership";

function instance(
  status: InstanceWithLocation["status"],
  type: "physical" | "digital" = "physical",
): InstanceWithLocation {
  return {
    id: randomUUID(),
    status,
    format: null,
    fileSizeBytes: null,
    lentTo: null,
    lentDate: null,
    location: {
      id: randomUUID(),
      name: "Library",
      type,
      color: null,
      icon: null,
    },
  };
}
describe("curation independent of ownership", () => {
  it("accepts sparse personal edits and rejects acquisition or consumption fields", () => {
    expect(curationPatchSchema.parse({ notes: null })).toEqual({ notes: null });
    expect(curationPatchSchema.parse({ isFavourite: true })).toEqual({
      isFavourite: true,
    });
    for (const fields of [
      { catalogueStatus: "accessioned" },
      { acquisitionPriority: "urgent" },
      { watched: true },
      { personallyOwned: true },
      { rating: 6 },
      { rating: 4.3 },
      { rating: 0 },
    ])
      expect(curationPatchSchema.safeParse(fields).success).toBe(false);
  });
  it("centralizes domain controls independently of whether the domain is enabled", () => {
    expect(kindsWithCapability("bookLifecycle")).toEqual(["book"]);
    expect(kindsWithCapability("bookEditions")).toEqual(["book"]);
    expect(kindsWithCapability("originalWhereabouts")).toEqual(["painting"]);
    expect(kindsWithCapability("curation")).toEqual([...WORK_KINDS]);
    expect(WORK_DOMAINS.painting.capabilities.reading).toBe(false);
    // A capability is usable only while its domain is open
    expect(canUseWorkCapability("painting", "artObjects")).toBe(WORK_DOMAINS.painting.enabled);
    expect(canUseWorkCapability("painting", "reading")).toBe(false);
    expect(canUseWorkCapability("book", "reading")).toBe(true);
  });
  it("keeps a curated film unowned until an optional copy is recorded", () => {
    expect(filmHoldings([])).toMatchObject({
      personallyOwned: false,
      activeCount: 0,
    });
    expect(
      filmHoldings([
        { id: randomUUID(), medium: "physical", status: "held" },
        { id: randomUUID(), medium: "digital", status: "disposed" },
      ]),
    ).toMatchObject({
      personallyOwned: true,
      physicalCount: 1,
      digitalCount: 0,
      disposedCount: 1,
    });
  });
  it("counts samples and decants, keeps empty containers distinct from usable quantity", () => {
    expect(
      perfumeHoldings([
        {
          id: randomUUID(),
          container: "sample",
          status: "held",
          remainingMl: 1.5,
        },
        {
          id: randomUUID(),
          container: "bottle",
          status: "held",
          remainingMl: 0,
        },
        {
          id: randomUUID(),
          container: "decant",
          status: "in_storage",
          remainingMl: null,
        },
        {
          id: randomUUID(),
          container: "bottle",
          status: "disposed",
          remainingMl: 50,
        },
      ]),
    ).toMatchObject({
      personallyOwned: true,
      activeCount: 3,
      disposedCount: 1,
      samples: 1,
      bottles: 1,
      decants: 1,
      knownRemainingMl: 1.5,
      unknownRemainingCount: 1,
    });
  });
  it("never treats institutional, private or unknown art ownership as personal", () => {
    expect(
      paintingHoldings([
        {
          id: randomUUID(),
          ownership: "institutional",
          objectKind: "original",
        },
        { id: randomUUID(), ownership: "private", objectKind: "version" },
        { id: randomUUID(), ownership: "unknown", objectKind: "original" },
      ]),
    ).toMatchObject({ personallyOwned: false, originals: 0, versions: 0 });
  });
  it("keeps personal loans owned and distinguishes originals from reproductions", () => {
    expect(
      paintingHoldings([
        {
          id: randomUUID(),
          ownership: "personal",
          objectKind: "original",
          status: "lent_out",
        },
        {
          id: randomUUID(),
          ownership: "personal",
          objectKind: "reproduction",
          status: "held",
        },
        {
          id: randomUUID(),
          ownership: "personal",
          objectKind: "version",
          status: "disposed",
        },
      ]),
    ).toMatchObject({
      personallyOwned: true,
      originals: 1,
      reproductions: 1,
      versions: 0,
      disposedCount: 1,
    });
  });
  it("rejects duplicate holdings instead of counting joined rows twice", () => {
    const copy = {
      id: randomUUID(),
      medium: "physical" as const,
      status: "held" as const,
    };
    expect(() => filmHoldings([copy, copy])).toThrow("more than once");
  });
  it("preserves book partial holdings, disposition and format derivation", () => {
    const copies = [
      instance("available"),
      instance("lent_out", "digital"),
      instance("deaccessioned"),
    ];
    expect(bookHoldings("wanted", copies)).toMatchObject({
      personallyOwned: true,
      totalActive: 2,
      totalDeaccessioned: 1,
      ownershipStatus: "physical_and_digital",
      lifecycle: { isPartiallyHeld: true, isInconsistent: false },
    });
    expect(bookHoldings("accessioned", [])).toMatchObject({
      personallyOwned: false,
      lifecycle: { isInconsistent: true },
    });
    expect(bookHoldings("deaccessioned", copies)).toMatchObject({
      lifecycle: { isInconsistent: true },
    });
    expect(
      bookHoldings("deaccessioned", [instance("deaccessioned")]),
    ).toMatchObject({
      personallyOwned: false,
      lifecycle: { isInconsistent: false },
    });
  });
});
