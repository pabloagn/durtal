import { describe, expect, it } from "vitest";
import {
  attributedName,
  checkedText,
  custodyText,
  dimensionsText,
  objectName,
  ownerText,
  painterInput,
  painterName,
  paintingRatio,
  placeText,
} from "@/lib/catalogue/painting-labels";
import { hasPaintingFilters, paintingQueryFromParams } from "@/lib/catalogue/painting-params";
import { domainSwitchHref } from "@/lib/catalogue/domain-switch";
import { paintingQuerySchema } from "@/lib/validations/paintings";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("painting names and lines", () => {
  it("names painters with their attribution, and an unnamed hand", () => {
    expect(painterName({ name: "Giorgione", creditedAs: null, attribution: "unspecified" })).toBe("Giorgione");
    expect(painterName({ person: null, creditedAs: "Master of Flémalle", attribution: "unspecified" })).toBe("Master of Flémalle");
    expect(painterName({ creditedAs: null, attribution: "anonymous" })).toBe("Anonymous");
    expect(painterName({ creditedAs: null, attribution: "unknown" })).toBe("Unknown painter");
    expect(attributedName({ name: "Giorgione", creditedAs: null, attribution: "attributed" })).toBe("Attributed to Giorgione");
    expect(attributedName({ name: "Titian", creditedAs: null, attribution: "uncertain" })).toBe("Possibly by Titian");
    expect(attributedName({ name: "Titian", creditedAs: null, attribution: "confirmed" })).toBe("Titian");
    expect(attributedName({ creditedAs: null, attribution: "unknown" })).toBe("Unknown painter");
  });

  it("writes sizes without inventing a missing side", () => {
    expect(dimensionsText({ height: 73.7, width: 92.1, depth: null, dimensionUnit: "cm" })).toBe("73.7 × 92.1 cm");
    expect(dimensionsText({ height: 73.7, width: 92.1, depth: 4, dimensionUnit: "cm" })).toBe("73.7 × 92.1 × 4 cm");
    expect(dimensionsText({ height: 30, width: null, depth: null, dimensionUnit: "in" })).toBe("30 × ? in");
    expect(dimensionsText({ height: null, width: null, depth: null, dimensionUnit: null })).toBeNull();
  });

  it("names objects, owners and places for every state, unknown included", () => {
    expect(objectName({ kind: "original", label: null })).toBe("Original");
    expect(objectName({ kind: "version", label: "Second version" })).toBe("Version: Second version");
    expect(objectName({ kind: "reproduction", label: "Poster" })).toBe("Reproduction: Poster");
    expect(ownerText({ ownership: "institutional", ownerName: "Museum of Modern Art" })).toBe("Museum of Modern Art");
    expect(ownerText({ ownership: "private", ownerLabel: "Zürich" })).toBe("Private collection, Zürich");
    expect(ownerText({ ownership: "personal" })).toBe("You");
    expect(ownerText({ ownership: "unknown" })).toBe("Unknown");
    expect(placeText({ placeKind: "venue", venueName: "Prado", placeLabel: null })).toBe("Prado");
    expect(placeText({ placeKind: "private", venueName: null, placeLabel: null })).toBe("A private place");
    expect(placeText({ placeKind: "unknown", venueName: null, placeLabel: null })).toBe("Whereabouts unknown");
    expect(placeText({ placeKind: "lost", venueName: null, placeLabel: null })).toBe("Lost");
    expect(custodyText({ custody: "temporary_loan", displayStatus: "on_display", placeKind: "venue" })).toBe(
      "On loan for an exhibition · On display",
    );
    expect(custodyText({ custody: "unknown", displayStatus: "unknown", placeKind: "unknown" })).toBe("");
    const recordedAt = new Date("2026-10-01T09:00:00Z");
    // The date is the owner's calendar day (APP_TIMEZONE), set here so the
    // runner's own setting cannot change the result
    const original = process.env.APP_TIMEZONE;
    try {
      process.env.APP_TIMEZONE = "Europe/Amsterdam";
      // 23:30 UTC is 01:30 the next day in Amsterdam
      expect(checkedText({ verifiedAt: new Date("2026-10-04T23:30:00Z"), recordedAt })).toBe(
        "Checked Oct 5, 2026",
      );
      expect(checkedText({ verifiedAt: null, recordedAt })).toBe("Recorded Oct 1, 2026, not checked");
      process.env.APP_TIMEZONE = "America/Mexico_City";
      // ...and still Oct 4 in Mexico City
      expect(checkedText({ verifiedAt: new Date("2026-10-04T23:30:00Z"), recordedAt })).toBe(
        "Checked Oct 4, 2026",
      );
    } finally {
      if (original === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = original;
    }
  });

  it("keeps a frame between 1:3 and 3:1, from the picture first", () => {
    expect(paintingRatio({ width: 1000, height: 500 })).toBe(2);
    expect(paintingRatio(null, { widthCm: 50, heightCm: 100 })).toBe(0.5);
    expect(paintingRatio(null, null)).toBe(0.8);
    expect(paintingRatio({ width: 5000, height: 100 })).toBe(3);
    expect(paintingRatio({ width: 100, height: 5000 })).toBeCloseTo(1 / 3);
  });

  it("sends painters as painting credits, keeping stored IDs", () => {
    expect(
      painterInput([
        { key: "a", id: A, personId: B, name: "Bosch", creditedAs: null, attribution: "unspecified" },
        { key: "b", personId: null, name: null, creditedAs: null, attribution: "unknown" },
      ]),
    ).toEqual([
      { id: A, personId: B, roleId: "painting.painter", creditedAs: null, attribution: "unspecified" },
      { personId: null, roleId: "painting.painter", creditedAs: null, attribution: "unknown" },
    ]);
  });
});

describe("painting home URL", () => {
  it("reads every filter, search and sort", () => {
    const query = paintingQueryFromParams({
      q: " garden ",
      painter: `${A},${B}`,
      movement: A,
      genre: B,
      technique: C,
      medium: A,
      support: `${B},${B}`,
      institution: C,
      venue: A,
      holding: "owned",
      favourite: "1",
      from: "1400",
      to: "1600",
      sort: "created",
      order: "asc",
    });
    expect(query).toEqual({
      search: "garden",
      painterIds: [A, B],
      artMovementIds: [A],
      taxonomyItemIds: [B, C, A],
      ownerOrganizationIds: [C],
      currentVenueIds: [A],
      createdFrom: 1400,
      createdTo: 1600,
      holding: "owned",
      favourite: true,
      sort: "created",
      order: "asc",
    });
    expect(paintingQuerySchema.safeParse(query).success).toBe(true);
    expect(hasPaintingFilters({ venue: A })).toBe(true);
    expect(hasPaintingFilters({ q: "garden", sort: "title" })).toBe(false);
  });

  it("drops what it cannot read instead of failing", () => {
    const query = paintingQueryFromParams({
      painter: "not-an-id",
      holding: "owned,not_owned",
      from: "1900",
      to: "1800",
      sort: "runtime",
      order: "sideways",
    });
    expect(query).toEqual({ holding: "any", createdFrom: 1800, createdTo: 1900, sort: "title" });
    expect(paintingQuerySchema.safeParse(query).success).toBe(true);
  });

  it("keeps painting filters when switching to the painting home", () => {
    const href = domainSwitchHref(
      "painting",
      new URLSearchParams({ q: "bosch", painter: A, director: B, sort: "created" }),
    );
    expect(href).toBe(`/paintings?q=bosch&painter=${A}&sort=created`);
  });
});
