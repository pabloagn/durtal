import { describe, it, expect } from "vitest";
import {
  WORK_AUTHOR_ROLES,
  EDITION_CONTRIBUTOR_ROLES,
  INSTANCE_FORMATS,
  INSTANCE_CONDITIONS,
  ACQUISITION_TYPES,
  CATALOGUE_STATUSES,
  ACQUISITION_PRIORITIES,
  INSTANCE_STATUSES,
  DISPOSITION_TYPES,
  BINDING_TYPES,
  LOCATION_TYPES,
  MEDIA_TYPES,
} from "@/lib/types/index";

// ── Enum completeness: types/index.ts must match docs/02_DATA_MODEL.md ────────

describe("CATALOGUE_STATUSES", () => {
  it("contains all documented statuses", () => {
    const expected = ["tracked", "shortlisted", "wanted", "on_order", "accessioned", "deaccessioned"];
    expect([...CATALOGUE_STATUSES]).toEqual(expected);
  });
});

describe("ACQUISITION_PRIORITIES", () => {
  it("contains all documented priorities", () => {
    const expected = ["none", "low", "medium", "high", "urgent"];
    expect([...ACQUISITION_PRIORITIES]).toEqual(expected);
  });
});

describe("INSTANCE_STATUSES", () => {
  it("contains all documented statuses", () => {
    const expected = ["available", "lent_out", "in_transit", "in_storage", "missing", "damaged", "deaccessioned"];
    expect([...INSTANCE_STATUSES]).toEqual(expected);
  });
});

describe("DISPOSITION_TYPES", () => {
  it("contains all documented types", () => {
    const expected = ["sold", "donated", "gifted", "traded", "lost", "stolen", "destroyed", "returned", "expired"];
    expect([...DISPOSITION_TYPES]).toEqual(expected);
  });
});

describe("WORK_AUTHOR_ROLES", () => {
  it("contains author and co_author", () => {
    expect([...WORK_AUTHOR_ROLES]).toEqual(["author", "co_author"]);
  });
});

describe("EDITION_CONTRIBUTOR_ROLES", () => {
  // Per docs/02_DATA_MODEL.md line 368, "contributor" is a valid role
  it("contains all documented roles including contributor", () => {
    const documented = [
      "translator", "editor", "illustrator", "foreword", "afterword",
      "introduction", "narrator", "photographer", "compiler", "contributor",
    ];
    const actual = [...EDITION_CONTRIBUTOR_ROLES];
    for (const role of documented) {
      expect(actual).toContain(role);
    }
  });
});

describe("INSTANCE_FORMATS", () => {
  it("contains all documented formats", () => {
    const expected = ["hardcover", "paperback", "ebook", "audiobook", "pdf", "epub", "other"];
    expect([...INSTANCE_FORMATS]).toEqual(expected);
  });
});

describe("INSTANCE_CONDITIONS", () => {
  it("contains conditions in descending quality order", () => {
    const expected = ["mint", "fine", "very_good", "good", "fair", "poor"];
    expect([...INSTANCE_CONDITIONS]).toEqual(expected);
  });
});

describe("BINDING_TYPES", () => {
  it("contains all documented binding types", () => {
    const expected = ["hardcover", "paperback", "leather", "cloth", "boards", "wrappers", "spiral", "saddle_stitch", "other"];
    expect([...BINDING_TYPES]).toEqual(expected);
  });
});

describe("LOCATION_TYPES", () => {
  it("contains physical and digital", () => {
    expect([...LOCATION_TYPES]).toEqual(["physical", "digital"]);
  });
});

describe("MEDIA_TYPES", () => {
  it("contains poster, background, and gallery", () => {
    expect([...MEDIA_TYPES]).toEqual(["poster", "background", "gallery"]);
  });
});

describe("ACQUISITION_TYPES", () => {
  it("contains all acquisition types", () => {
    const expected = ["purchased", "gift", "inherited", "borrowed", "found", "review_copy", "other"];
    expect([...ACQUISITION_TYPES]).toEqual(expected);
  });
});
