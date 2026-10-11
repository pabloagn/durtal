import { describe, expect, it } from "vitest";
import { createInstanceSchema } from "@/lib/validations/instances";
import { newCopyDraftSchema, parseNewCopyDraft, parseNewEditionIntent } from "@/lib/ebooks/match/manual-intents";

describe("shared manual copy and edition intents", () => {
  it("preserves actual copy fields and catalogue defaults", () => {
    const draft = { condition: "fine", acquisitionType: "gift", notes: "Owner note", isSigned: true,
      signedBy: "The author", dispositionType: "gifted" as const, lentTo: "Reader", hasSlipcase: true };
    const catalogue = createInstanceSchema.parse({ ...draft,
      editionId: "20000000-0000-4000-8000-000000000001",
      locationId: "30000000-0000-4000-8000-000000000001" });
    const { editionId: _edition, locationId: _location, status: _status, ...metadata } = catalogue;
    expect(parseNewCopyDraft(draft)).toEqual(metadata);
    expect(parseNewCopyDraft({})).toEqual({ isSigned: false, isFirstPrinting: false });
  });
  it.each(["id", "editionId", "locationId", "format", "fileSizeBytes", "status", "createdAt", "updatedAt", "unknown"])(
    "refuses protected or unknown %s without stripping it", (key) => {
      expect(newCopyDraftSchema.safeParse({ [key]: "override" }).success).toBe(false);
    },
  );
  it("retains inherited bounds and rejects null draft/invalid shapes", () => {
    expect(() => parseNewCopyDraft({ notes: "x".repeat(10001) })).toThrow();
    expect(() => parseNewCopyDraft({ dispositionType: "invented" })).toThrow();
    expect(() => parseNewCopyDraft(null)).toThrow();
    for (const intent of [null, [], { unknown: true }, { language: "unknown-language" }, { isbn13: "9780306406158" }])
      expect(() => parseNewEditionIntent(intent)).toThrow();
  });
  it("preserves explicit empty create and omitted versus null ISBN", () => {
    expect(parseNewEditionIntent({})).toEqual({});
    expect(Object.hasOwn(parseNewEditionIntent({ language: "English" }), "isbn13")).toBe(false);
    expect(parseNewEditionIntent({ language: "English", isbn13: null })).toEqual({ language: "en", isbn13: null });
    expect(parseNewEditionIntent({ isbn13: "9780306406157" })).toEqual({ isbn13: "9780306406157" });
  });
});
