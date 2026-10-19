import { describe, expect, it } from "vitest";
import { rowsChanged, undoRemoves } from "@/lib/reading/import/action-words";

/* The import buttons' words (SLN-956) */

describe("the import's button words", () => {
  it("counts changed rows by number", () => {
    expect([rowsChanged(1), rowsChanged(0), rowsChanged(12)]).toEqual(["1 row changed", "0 rows changed", "12 rows changed"]);
  });

  it("names the Goodreads ids Undo removes only when the import recorded some", () => {
    expect(undoRemoves({ readings: 3 })).toEqual(["the 3 readings it wrote", "the book ratings it set while they are unchanged"]);
    expect(undoRemoves({ readings: 1, goodreadsIds: 1 })).toContain("the Goodreads id it recorded");
    expect(undoRemoves({ readings: 1, queued: 2, notes: 1, goodreadsIds: 4 })).toEqual([
      "the reading it wrote",
      "the 2 books it added to Up next",
      "the note it imported",
      "the book ratings it set while they are unchanged",
      "the 4 Goodreads ids it recorded",
    ]);
  });
});
