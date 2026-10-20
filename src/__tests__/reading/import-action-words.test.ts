import { commitResultWords } from "@/lib/reading/import/action-words";
import { describe, expect, it } from "vitest";
import { canUndoImport, rowsChanged, undoDescription, undoRemoves } from "@/lib/reading/import/action-words";

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


describe("Undo for interrupted ID claims", () => {
  it("is available for a reused claim with no removable records", () => {
    expect(canUndoImport({ readings: 0, queued: 0, notes: 0, ratings: 0, identifiers: 0, pendingClaims: 1 })).toBe(true);
    expect(canUndoImport({ readings: 0, queued: 0, notes: 0, ratings: 0, identifiers: 0, pendingClaims: 0 })).toBe(false);
  });
  it("describes zero record removal and guarded new-ID removal truthfully", () => {
    const reused = undoDescription({ readings: 0, pendingClaims: 1 });
    expect(reused).toContain("No readings, notes or Up next items were written");
    expect(reused).toContain("Reused Goodreads IDs are kept");
    expect(reused).not.toContain("book ratings it set");
    expect(undoDescription({ readings: 0, pendingClaims: 1, goodreadsIds: 1 })).toContain("Only new IDs still owned by this import and unused elsewhere are removed");
  });
  it("includes an outstanding rating journal alongside a pending ID claim", () => {
    const description = undoDescription({ readings: 0, pendingClaims: 1, ratings: 1 });
    expect(description).toContain("the book ratings it set while they are unchanged");
    expect(description).not.toContain("No readings, notes or Up next items were written");
  });
});


describe("commit results",()=>{
  it("names actual restored and present sessions and notes without zero-reading noise",()=>{
    const empty={written:0,present:0,refused:0,queued:0,notes:0};
    expect(commitResultWords({...empty,sessions:2,sessionsPresent:1})).toBe("2 sessions restored · 1 session already in Durtal");
    expect(commitResultWords({...empty,notes:1,notesPresent:2})).toBe("1 note imported · 2 notes already in Durtal");
    expect(commitResultWords(empty)).toBe("Nothing new to import");
  });
});
