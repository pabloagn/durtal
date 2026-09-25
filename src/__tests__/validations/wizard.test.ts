import { describe, it, expect } from "vitest";
import { wizardBookSchema } from "@/lib/validations/wizard";
import { defaultSortName } from "@/lib/utils/author-names";

const uuid = "11111111-1111-4111-8111-111111111111";
const edition = { title: "Blinding", language: "ro" };

describe("wizardBookSchema", () => {
  it("accepts a new work with an edition and applies the defaults", () => {
    const parsed = wizardBookSchema.parse({ authorName: " Mircea Cărtărescu ", work: { title: "Blinding" }, edition });
    expect(parsed.authorName).toBe("Mircea Cărtărescu");
    expect(parsed.copies).toEqual([]);
    expect(parsed.collectionIds).toEqual([]);
  });

  it("accepts an existing work without work details", () => {
    expect(wizardBookSchema.safeParse({ authorName: "x", existingWorkId: uuid, edition }).success).toBe(true);
  });

  it("requires work details when there is no existing work", () => {
    const r = wizardBookSchema.safeParse({ authorName: "x", edition });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["work"]);
  });

  it("requires an author name", () => {
    expect(wizardBookSchema.safeParse({ authorName: "  ", work: { title: "t" }, edition }).success).toBe(false);
  });

  it("rejects a malformed ISBN, a copy without a location and a bad taxonomy id", () => {
    const base = { authorName: "x", work: { title: "t" }, edition };
    expect(wizardBookSchema.safeParse({ ...base, edition: { ...edition, isbn13: "97800000" } }).success).toBe(false);
    expect(wizardBookSchema.safeParse({ ...base, copies: [{}] }).success).toBe(false);
    expect(wizardBookSchema.safeParse({ ...base, taxonomy: { subjectIds: ["nope"] } }).success).toBe(false);
  });

  it("caps the number of copies", () => {
    const copies = Array.from({ length: 51 }, () => ({ locationId: uuid }));
    expect(wizardBookSchema.safeParse({ authorName: "x", work: { title: "t" }, edition, copies }).success).toBe(false);
  });
});

describe("defaultSortName", () => {
  it("puts the last name first", () => {
    expect(defaultSortName("Tarjei Vesaas")).toBe("Vesaas, Tarjei");
    expect(defaultSortName("José Donoso Yáñez")).toBe("Yáñez, José Donoso");
  });

  it("keeps a single name and ignores extra spaces", () => {
    expect(defaultSortName("Homer")).toBe("Homer");
    expect(defaultSortName("  Clarice   Lispector ")).toBe("Lispector, Clarice");
  });
});
