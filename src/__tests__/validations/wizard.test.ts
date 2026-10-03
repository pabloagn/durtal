import { describe, expect, it } from "vitest";
import { wizardBookSchema } from "@/lib/validations/wizard";

const LOCATION = "11111111-1111-4111-8111-111111111111";
const WORK = "22222222-2222-4222-8222-222222222222";

const issues = (input: unknown) => {
  const result = wizardBookSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("wizard book input", () => {
  it("needs the work and its author for a new book", () => {
    expect(issues({ edition: { title: "Untitled" } })).toEqual([
      "work: Work details are required",
      "authorName: Author is required",
    ]);
    expect(
      issues({ authorName: "  ", work: { title: "Demian" }, edition: { title: "Demian" } }),
    ).toEqual(["authorName: Author is required"]);
  });

  it("needs neither for an edition of an existing book", () => {
    expect(issues({ existingWorkId: WORK, edition: { title: "Demian" } })).toEqual([]);
  });

  it("checks every part before anything is written", () => {
    const result = issues({
      authorName: "Hermann Hesse",
      work: { title: "Demian", rating: 9 },
      edition: { title: "Demian", isbn13: "123" },
      copies: [{ locationId: "not-a-location" }],
      collectionIds: ["not-a-collection"],
      taxonomy: { subjectIds: ["not-a-subject"] },
    });
    // Every part is checked; a field may break more than one rule
    expect([...new Set(result.map((issue) => issue.split(":")[0]))].sort()).toEqual([
      "collectionIds.0",
      "copies.0.locationId",
      "edition.isbn13",
      "taxonomy.subjectIds.0",
      "work.rating",
    ]);
  });

  it("defaults copies and collections to none, and keeps the book kind", () => {
    const parsed = wizardBookSchema.parse({
      authorName: "Hermann Hesse",
      work: { title: "Demian" },
      edition: { title: "Demian" },
    });
    expect(parsed).toMatchObject({
      copies: [],
      collectionIds: [],
      work: { kind: "book", catalogueStatus: "tracked" },
    });
    expect(
      wizardBookSchema.safeParse({
        existingWorkId: WORK,
        edition: { title: "Demian" },
        copies: Array.from({ length: 51 }, () => ({ locationId: LOCATION })),
      }).success,
    ).toBe(false);
  });
});
