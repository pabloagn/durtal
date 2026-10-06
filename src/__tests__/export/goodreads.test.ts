import { describe, expect, it } from "vitest";
import { goodreadsRow, goodreadsStars, roundsHalfStar, type GoodreadsBook } from "@/lib/export/goodreads";

/* The Goodreads file's rows (SLN-458): shelves, stars, dates, counts and the Book Id order */

function book(over: Partial<GoodreadsBook> = {}): GoodreadsBook {
  return {
    title: "The Recognitions",
    authors: [
      { name: "William Gaddis", sortName: "Gaddis, William" },
      { name: "A. N. Other", sortName: null },
      { name: "Third Hand", sortName: null },
    ],
    originalYear: 1955,
    rating: 4.5,
    createdOn: "2024-03-02",
    state: "read",
    inUpNext: false,
    readCount: 1,
    abandonedCount: 0,
    lastFinishedOn: "2025-01-09",
    lastFinishedPrecision: "day",
    lastReviewHtml: "<p>Long.</p><p>Worth <em>it</em>.</p>",
    lastAbandonedOn: null,
    lastAbandonedPrecision: null,
    edition: { isbn10: "0-14-018708-8", isbn13: "978-0-14-018708-6", publisher: "Penguin", binding: "paperback", pageCount: 956, publicationYear: 1993 },
    goodreadsIds: { latestEdition: null, anyEdition: null, identifier: null, url: null },
    ownedCopies: 2,
    ...over,
  };
}

describe("goodreadsRow", () => {
  it("fills Goodreads' columns from the book and its edition", () => {
    expect(goodreadsRow(book())).toMatchObject({
      "Book Id": "",
      Title: "The Recognitions",
      Author: "William Gaddis",
      "Author l-f": "Gaddis, William",
      "Additional Authors": "A. N. Other, Third Hand",
      ISBN: "0140187088",
      ISBN13: "9780140187086",
      "My Rating": 5,
      "Average Rating": "",
      Publisher: "Penguin",
      Binding: "Paperback",
      "Number of Pages": 956,
      "Year Published": 1993,
      "Original Publication Year": 1955,
      "Date Read": "2025/01/09",
      "Date Added": "2024/03/02",
      Bookshelves: "read",
      "Exclusive Shelf": "read",
      "My Review": "Long.\nWorth it.",
      Spoiler: "",
      "Private Notes": "",
      "Read Count": 1,
      "Owned Copies": 2,
    });
  });

  it("rounds a half star up and counts it, and keeps whole stars", () => {
    expect(goodreadsStars(4.5)).toBe(5);
    expect(goodreadsStars(0.5)).toBe(1);
    expect(goodreadsStars(3)).toBe(3);
    expect(goodreadsStars(null)).toBe(0);
    expect(roundsHalfStar(book())).toBe(true);
    expect(roundsHalfStar(book({ rating: 4 }))).toBe(false);
  });

  it("sends 0 for a rated book never finished nor abandoned: its rating may be a priority", () => {
    const queued = book({ state: "unread", inUpNext: true, readCount: 0, rating: 4.5, lastFinishedOn: null, lastReviewHtml: null });
    expect(goodreadsRow(queued)).toMatchObject({ "My Rating": 0, "Exclusive Shelf": "to-read", Bookshelves: "to-read", "Read Count": 0 });
    expect(roundsHalfStar(queued)).toBe(false);
    const open = book({ state: "reading", readCount: 0, rating: 3, lastFinishedOn: null });
    expect(goodreadsRow(open)!["My Rating"]).toBe(0);
    // An abandoned attempt carries the rating
    expect(goodreadsRow(book({ state: "abandoned", readCount: 0, abandonedCount: 1, rating: 2 }))!["My Rating"]).toBe(2);
  });

  it("puts only a day-precision date in Date Read", () => {
    expect(goodreadsRow(book({ lastFinishedPrecision: "month", lastFinishedOn: "2025-01-01" }))!["Date Read"]).toBe("");
    expect(goodreadsRow(book({ lastFinishedPrecision: "year", lastFinishedOn: "2025-01-01" }))!["Date Read"]).toBe("");
    expect(goodreadsRow(book({ lastFinishedPrecision: "unknown", lastFinishedOn: null }))!["Date Read"]).toBe("");
  });

  it("counts re-reads as finished readings", () => {
    expect(goodreadsRow(book({ readCount: 3 }))!["Read Count"]).toBe(3);
  });

  it("shelves an abandoned book as did-not-finish with its stop date, and a paused one as currently-reading and paused", () => {
    expect(
      goodreadsRow(book({ state: "abandoned", readCount: 0, abandonedCount: 2, lastAbandonedOn: "2024-05-04", lastAbandonedPrecision: "day", lastFinishedOn: null })),
    ).toMatchObject({ "Exclusive Shelf": "did-not-finish", Bookshelves: "did-not-finish", "Date Read": "2024/05/04", "Read Count": 0 });
    expect(goodreadsRow(book({ state: "paused" }))).toMatchObject({ "Exclusive Shelf": "currently-reading", Bookshelves: "currently-reading, paused" });
    expect(goodreadsRow(book({ state: "reading" }))).toMatchObject({ "Exclusive Shelf": "currently-reading", Bookshelves: "currently-reading" });
  });

  it("leaves out an unread book that is not in Up Next", () => {
    expect(goodreadsRow(book({ state: "unread", inUpNext: false, readCount: 0 }))).toBeNull();
  });

  it("takes the Book Id from the latest reading's edition, any edition, an identifier, the Goodreads link, in that order", () => {
    const ids = { latestEdition: "11", anyEdition: "22", identifier: "33", url: "https://www.goodreads.com/book/show/44-the-recognitions" };
    expect(goodreadsRow(book({ goodreadsIds: ids }))!["Book Id"]).toBe("11");
    expect(goodreadsRow(book({ goodreadsIds: { ...ids, latestEdition: null } }))!["Book Id"]).toBe("22");
    expect(goodreadsRow(book({ goodreadsIds: { ...ids, latestEdition: null, anyEdition: null } }))!["Book Id"]).toBe("33");
    expect(goodreadsRow(book({ goodreadsIds: { latestEdition: null, anyEdition: null, identifier: null, url: ids.url } }))!["Book Id"]).toBe("44");
    expect(goodreadsRow(book())!["Book Id"]).toBe("");
  });
});
