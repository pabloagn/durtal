import { describe, expect, it } from "vitest";
import { findClashes, holdForReview, oneEbookPerWork } from "@/lib/ebooks/match/clashes";
import { matchInMemory } from "@/lib/ebooks/match/tiers";
import { catalogue, copy, ebook, edition, work } from "./fixtures";

/* SLN-657: one book, one e-book. A clash only ever takes an automatic link away. */

const files = (sha: string) => [{ id: `file-${sha}`, sha256: sha.repeat(64), format: "epub", sizeBytes: 1000, status: "stored", drm: null, availability: "native" as const }];

describe("one book, one e-book", () => {
  it("links a lone sure e-book by itself and leaves it untouched", () => {
    const cat = catalogue({ works: [work({ editions: [edition()] })] });
    const results = matchInMemory([ebook()], cat);
    expect(results[0].autoLink).toBe(true);
    expect(findClashes(results, cat).size).toBe(0);
    expect(oneEbookPerWork(results, cat)).toEqual(results);
  });

  it("sends two e-books proposing one book to review, both with the reason, tiers and candidates as scored", () => {
    const cat = catalogue({ works: [work({ editions: [edition()] })] });
    const results = matchInMemory([ebook({ id: "ebook-1", files: files("a") }), ebook({ id: "ebook-2", language: "fr", files: files("b") })], cat);
    expect(results.filter((r) => r.autoLink)).toHaveLength(2);
    const sent = oneEbookPerWork(results, cat);
    expect(sent.map((r) => r.autoLink)).toEqual([false, false]);
    expect(sent.map((r) => r.tier)).toEqual(results.map((r) => r.tier));
    for (const result of sent) {
      expect(result.candidates[0].reasons[0].code).toBe("several_ebooks");
      expect(result.candidates[0].effect).toEqual(results.find((r) => r.ebookId === result.ebookId)!.candidates[0].effect);
    }
  });

  it("sends an e-book to review when its book already has one, but not for its own link", () => {
    const linked = catalogue({
      works: [work({ editions: [edition()], copies: [copy({ id: "copy-1", linkedEbookId: "ebook-9" })] })],
      digitalLocationIds: ["ebooks-location"],
    });
    const [result] = matchInMemory([ebook()], linked);
    expect(findClashes([result], linked).get("ebook-1")).toEqual(["has_ebook"]);
    const own = catalogue({
      works: [work({ editions: [edition()], copies: [copy({ id: "copy-1", linkedEbookId: "ebook-1" })] })],
      digitalLocationIds: ["ebooks-location"],
    });
    expect(findClashes(matchInMemory([ebook()], own), own).size).toBe(0);
  });

  it("names an omnibus as scoring for several books", () => {
    const cat = catalogue({
      works: [work({ id: "work-1", title: "Nadja" }), work({ id: "work-2", title: "Arcane 17" })],
    });
    const results = matchInMemory([ebook({ title: "Nadja and Arcane 17" })], cat);
    expect(results[0].flags).toContain("omnibus");
    expect(findClashes(results, cat).get("ebook-1")).toContain("several_works");
  });

  it("holds an e-book a wider look sent to review, and never a skipped one", () => {
    const cat = catalogue({ works: [work({ editions: [edition()] })] });
    const reason = { code: "wider", text: "Sent to review elsewhere" };
    const [result] = holdForReview(matchInMemory([ebook()], cat), new Map([["ebook-1", reason]]));
    expect(result.autoLink).toBe(false);
    expect(result.reasons[0]).toEqual(reason);
    const [linked] = matchInMemory([ebook({ instanceId: "copy-1", matchState: "linked" })], cat);
    expect(holdForReview([linked], new Map([["ebook-1", reason]]))).toEqual([linked]);
  });
});
