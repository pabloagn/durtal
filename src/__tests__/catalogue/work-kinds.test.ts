import { describe, expect, it } from "vitest";
import { isWorkKind, WORK_KINDS } from "@/lib/catalogue/kinds";
import { getEnabledWorkKinds, WORK_DOMAINS } from "@/lib/catalogue/domains";
import { createWorkSchema, updateWorkSchema } from "@/lib/validations/works";
import { fastTrackBookSchema } from "@/lib/validations/fast-track";

const book = {
  title: "On Painting",
  authorIds: [{ authorId: "11111111-1111-4111-8111-111111111111" }],
};

describe("work domain boundaries", () => {
  it.each(WORK_KINDS)("recognizes the explicit %s identity", (kind) => {
    expect(isWorkKind(kind)).toBe(true);
  });

  it.each([undefined, null, "", "Book", "novel", "museum", "toString", {}, []])(
    "does not infer a domain from %j",
    (input) => expect(isWorkKind(input)).toBe(false),
  );

  it("exposes only the ready domains: books and paintings", () => {
    expect(getEnabledWorkKinds()).toEqual(["book", "painting"]);
    expect(WORK_DOMAINS.book.basePath).toBe("/library");
  });

  it("preserves legacy book payloads and accepts an explicit book kind", () => {
    expect(createWorkSchema.parse(book).kind).toBe("book");
    expect(createWorkSchema.parse({ ...book, kind: "book" }).kind).toBe("book");
  });

  it.each(["film", "perfume", "painting", "novel", null])(
    "rejects %j instead of silently creating a book",
    (kind) => {
      const result = createWorkSchema.safeParse({ ...book, kind });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some((issue) => issue.path[0] === "kind"),
        ).toBe(true);
    },
  );

  it.each(WORK_KINDS)("rejects kind %s in an update", (kind) => {
    expect(
      updateWorkSchema.safeParse({ notes: "Keep my metadata", kind }).success,
    ).toBe(false);
  });

  it("does not insert create defaults into sparse updates", () => {
    expect(updateWorkSchema.parse({ notes: "A new note" })).toEqual({
      notes: "A new note",
    });
    expect(updateWorkSchema.parse({})).toEqual({});
    expect(updateWorkSchema.parse({ rating: null })).toEqual({ rating: null });
  });

  it.each(["film", "perfume", "painting"])(
    "rejects %s through the fast-track book path",
    (kind) => {
      const result = fastTrackBookSchema.safeParse({
        authorName: "Leon Battista Alberti",
        work: { title: "On Painting", kind },
        edition: {},
      });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.error.issues.some(
            (issue) => issue.path.join(".") === "work.kind",
          ),
        ).toBe(true);
    },
  );

  it("preserves domain-specific primary creators and artwork geometry", () => {
    expect(WORK_DOMAINS.perfume.creatorRoles).toContain("perfumer");
    expect(WORK_DOMAINS.film.creatorRoles).toContain("director");
    expect(WORK_DOMAINS.painting.creatorRoles).toContain("painter");
    expect(WORK_DOMAINS.painting.image).toMatchObject({
      slot: "native",
      fit: "contain",
      emphasis: "large",
    });
  });
});
