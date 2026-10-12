import { describe, expect, it } from "vitest";
import * as schemas from "@/lib/validations/ebook-review";
import {
  at,
  hash,
  id,
  keepRequest,
  operation,
  stamp,
  workStamp,
} from "../ebooks/review-fixtures";

const decision = { ebookId: id(3), stamp, operation, effectHash: hash };
const cases = [
  [
    schemas.acceptEbookCandidateSchema,
    { ...decision, rank: 1, candidateHash: hash },
  ],
  [
    schemas.linkEbookToWorkSchema,
    {
      ...decision,
      workId: id(4),
      choice: { kind: "add_copy", editionId: id(5) },
    },
  ],
  [
    schemas.accessionEbookSchema,
    { ...decision, authors: [{ id: id(6) }], language: "Spanish" },
  ],
  [schemas.keepEbookStandaloneSchema, decision],
  [schemas.excludeEbookSchema, { ...decision, reason: "duplicate" }],
  [schemas.rematchEbookSchema, decision],
  [
    schemas.restoreEbookToReviewSchema,
    { ...decision, expectedState: "excluded" },
  ],
  [
    schemas.undoEbookDecisionSchema,
    { ebookId: id(3), originalOperation: operation },
  ],
  [schemas.unlinkEbookSchema, { ...decision, originalOperation: operation }],
  [
    schemas.markWorkAccessionedSchema,
    { workId: id(4), stamp: workStamp, operation, effectHash: hash },
  ],
  [
    schemas.undoWorkAccessionedSchema,
    { workId: id(4), originalOperation: operation },
  ],
] as const;

describe("review action input boundaries", () => {
  it.each(cases.map(([schema, input], index) => ({ schema, input, index })))(
    "validates action $index and refuses hidden write fields",
    ({ schema, input }) => {
      expect(schema.safeParse(input).success).toBe(true);
      expect(
        schema.safeParse({ ...input, metadataLocked: false }).success,
      ).toBe(false);
      const field = "ebookId" in input ? "ebookId" : "workId";
      expect(
        schema.safeParse({ ...input, [field]: "not-a-uuid" }).success,
      ).toBe(false);
    },
  );
  it.each([0, 4, 1.5, "1"])("refuses candidate rank %s", (rank) => {
    expect(
      schemas.acceptEbookCandidateSchema.safeParse({
        ...decision,
        rank,
        candidateHash: hash,
      }).success,
    ).toBe(false);
  });
  it.each([1, 2, 3])(
    "allows candidate rank %s with a candidate hash",
    (rank) => {
      expect(
        schemas.acceptEbookCandidateSchema.safeParse({
          ...decision,
          rank,
          candidateHash: hash,
        }).success,
      ).toBe(true);
      expect(
        schemas.acceptEbookCandidateSchema.safeParse({ ...decision, rank })
          .success,
      ).toBe(false);
    },
  );
  it.each(["duplicate", "not_a_book", "other"])(
    "allows exclusion reason %s",
    (reason) => {
      expect(
        schemas.excludeEbookSchema.safeParse({ ...decision, reason }).success,
      ).toBe(true);
    },
  );
  it("rejects an invented reason and preserves the exact microsecond stamp", () => {
    expect(
      schemas.excludeEbookSchema.safeParse({ ...decision, reason: "sample" })
        .success,
    ).toBe(false);
    expect(schemas.ebookReviewStampSchema.parse(stamp).updatedAt).toBe(at);
    for (const updatedAt of [
      "2026-10-09T20:00:00.000Z",
      "2026-02-30T20:00:00.000001Z",
      "2026-10-09T22:00:00.000001+02:00",
    ]) {
      expect(
        schemas.ebookReviewStampSchema.safeParse({ ...stamp, updatedAt })
          .success,
      ).toBe(false);
    }
  });
  it("requires state and catalogue fingerprints even for a work-only action", () => {
    expect(
      schemas.markWorkAccessionedSchema.safeParse({
        workId: id(4),
        stamp,
        operation,
        effectHash: hash,
      }).success,
    ).toBe(false);
    for (const catalogueStatus of ["accessioned", "deaccessioned"]) {
      expect(
        schemas.markWorkAccessionedSchema.safeParse({
          workId: id(4),
          stamp: { ...workStamp, catalogueStatus },
          operation,
          effectHash: hash,
        }).success,
      ).toBe(false);
    }
  });
  it.each([
    { kind: "fill_copy", editionId: id(5), instanceId: id(6) },
    { kind: "add_copy", editionId: id(5) },
    { kind: "new_edition", language: "es", isbn13: "9780306406157" },
    { kind: "new_edition", isbn13: null },
  ])("accepts explicit edition intent $kind", (choice) => {
    expect(schemas.ebookEditionChoiceSchema.safeParse(choice).success).toBe(
      true,
    );
  });
  it.each([
    { kind: "fill_copy", editionId: id(5) },
    { kind: "add_copy", editionId: id(5), instanceId: id(6) },
    { kind: "new_edition", editionId: id(5) },
    { kind: "new_edition", isbn13: "9780306406158" },
    { kind: "new_edition", language: "und" },
  ])("rejects incomplete or contradictory edition intent %#", (choice) => {
    expect(schemas.ebookEditionChoiceSchema.safeParse(choice).success).toBe(
      false,
    );
  });
  it("normalizes chosen language and existing author id without choosing defaults", () => {
    const result = schemas.accessionEbookSchema.parse({
      ...decision,
      authors: [{ name: " Pedro Lemebel " }],
      language: "spa",
    });
    expect(result.language).toBe("es");
    expect(result.authors).toEqual([{ name: "Pedro Lemebel" }]);
    expect(
      schemas.accessionEbookSchema.parse(decision).language,
    ).toBeUndefined();
    expect(
      schemas.reviewAuthorChoiceSchema.safeParse({ name: " " }).success,
    ).toBe(false);
    expect(
      schemas.reviewAuthorChoiceSchema.safeParse({ id: id(6), name: "Borges" })
        .success,
    ).toBe(false);
  });
  it("limits chunks to 50 distinct targets and operation keys in one run/database", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      ...keepRequest(),
      ebookId: id(i + 100),
      operation: { ...operation, operationId: id(i + 200) },
    }));
    expect(schemas.reviewChunkSchema.safeParse(rows).success).toBe(true);
    expect(schemas.reviewChunkSchema.safeParse([]).success).toBe(false);
    expect(
      schemas.reviewChunkSchema.safeParse([...rows, keepRequest()]).success,
    ).toBe(false);
    expect(
      schemas.reviewChunkSchema.safeParse([rows[0], rows[0]]).success,
    ).toBe(false);
    for (const field of ["runId", "targetDatabase"]) {
      expect(
        schemas.reviewChunkSchema.safeParse([
          rows[0],
          {
            ...rows[1],
            operation: {
              ...rows[1].operation,
              [field]: field === "runId" ? id(999) : "another-database",
            },
          },
        ]).success,
      ).toBe(false);
    }
  });
  it("does not accept connection URLs as database identities", () => {
    expect(
      schemas.reviewOperationSchema.safeParse({
        ...operation,
        targetDatabase: "postgres://user:secret@localhost/db",
      }).success,
    ).toBe(false);
  });
});
