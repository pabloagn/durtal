import { describe, expect, it } from "vitest";
import { unreadPileText } from "@/lib/reading/charts";

// SLN-802: the pile read "2 books you own and have not read, 0 pages" over
// "2 without a page count"
describe("the unread pile's line", () => {
  it("leaves out pages and time when no book has a page count", () => {
    expect(unreadPileText({ books: 2, pages: 0, withoutPages: 2, years: 0 })).toBe("2 books you own and have not read.");
    expect(unreadPileText({ books: 1, pages: 0, withoutPages: 1, years: null })).toBe("1 book you own and have not read.");
  });

  it("says which books the pages count when some have none", () => {
    expect(unreadPileText({ books: 12, pages: 3_420, withoutPages: 2, years: 1.5 })).toBe(
      "12 books you own and have not read, 3,420 pages in the 10 with a page count: at your pace over the last three years, about 1.5 years to read those.",
    );
    expect(unreadPileText({ books: 3, pages: 210, withoutPages: 1, years: null })).toBe("3 books you own and have not read, 210 pages in the 2 with a page count.");
    expect(unreadPileText({ books: 2, pages: 720, withoutPages: 1, years: null })).toBe("2 books you own and have not read, 720 pages in the one with a page count.");
  });

  it("keeps the whole line when every book has a page count", () => {
    expect(unreadPileText({ books: 4, pages: 1_200, withoutPages: 0, years: 2 })).toBe(
      "4 books you own and have not read, 1,200 pages: at your pace over the last three years, about 2 years to read them all.",
    );
    expect(unreadPileText({ books: 1, pages: 1, withoutPages: 0, years: null })).toBe("1 book you own and have not read, 1 page.");
  });
});
