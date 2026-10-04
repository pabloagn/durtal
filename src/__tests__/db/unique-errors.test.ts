import { describe, expect, it } from "vitest";
import { readableDatabaseError, uniqueConstraint } from "@/lib/db/errors";
import { isbnTaken } from "@/lib/catalogue/isbn-clash";

/** A unique violation as the ORM wraps it: "Failed query", the driver error as cause */
const wrapped = (constraint: string) =>
  new Error("Failed query: update ... params: ...", {
    cause: Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
      code: "23505",
      constraint_name: constraint,
    }),
  });

describe("unique constraint errors", () => {
  it("names the constraint behind a wrapped error", () => {
    expect(uniqueConstraint(wrapped("recommenders_name_unique"))).toBe("recommenders_name_unique");
    expect(uniqueConstraint(new Error("other"))).toBeNull();
    expect(
      uniqueConstraint(Object.assign(new Error("fk"), { code: "23503", constraint_name: "x" })),
    ).toBeNull();
  });

  it("turns an ISBN constraint into the ISBN message, and leaves others", () => {
    expect(isbnTaken(wrapped("editions_isbn_13_unique"), { isbn13: "9780811214131" })).toBe(
      "An edition with ISBN 9780811214131 already exists",
    );
    expect(isbnTaken(wrapped("editions_isbn_10_unique"), { isbn10: "0811214133" })).toBe(
      "An edition with ISBN 0811214133 already exists",
    );
    expect(isbnTaken(wrapped("works_slug_unique"), { isbn13: "9780811214131" })).toBeNull();
  });

  it("never shows the database's wording", () => {
    const error = readableDatabaseError(wrapped("keywords_name_unique"), {
      unique: "This family already has an item with this name",
    }) as Error;
    expect(error.message).toBe("This family already has an item with this name");
  });
});
