import { describe, expect, it } from "vitest";
import { selectGoodreadsId, unresolvedGoodreadsIds, goodreadsAuthorLastFirst, goodreadsRow, goodreadsStars, roundsHalfStar, type GoodreadsBook } from "@/lib/export/goodreads";

/* The Goodreads file's rows (SLN-458): shelves, stars, dates, counts and the Book Id order */

function book(over: Partial<GoodreadsBook> = {}): GoodreadsBook {
  return {
    title: "The Recognitions",
    authors: [
      { name: "William Gaddis", sortName: "Gaddis, William", firstName: "William", lastName: "Gaddis" },
      { name: "A. N. Other", sortName: null, firstName: null, lastName: null },
      { name: "Third Hand", sortName: null, firstName: null, lastName: null },
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

describe("goodreadsAuthorLastFirst", () => {
  const cases: { label: string; author: Partial<GoodreadsBook["authors"][number]>; expected: string }[] = [
    { label: "stored sort name takes precedence", author: { sortName: "  Custom, Élodie  ", firstName: "Other", lastName: "Name" }, expected: "Custom, Élodie" },
    { label: "blank sort name uses both explicit components", author: { sortName: " \t ", firstName: "  Gabriel  ", lastName: "  García Márquez  " }, expected: "García Márquez, Gabriel" },
    { label: "surname particles stay together", author: { firstName: "María", lastName: "de la Cruz" }, expected: "de la Cruz, María" },
    { label: "first-name-only mononym has no comma", author: { firstName: " Björk " }, expected: "Björk" },
    { label: "last-name-only mononym has no comma", author: { lastName: " Molière " }, expected: "Molière" },
    { label: "blank first name is absent", author: { firstName: "\t", lastName: "Li" }, expected: "Li" },
    { label: "blank last name is absent", author: { firstName: "李", lastName: " " }, expected: "李" },
    { label: "internal spacing and punctuation are preserved", author: { firstName: "A.  N.", lastName: "de  la Cruz-Smith" }, expected: "de  la Cruz-Smith, A.  N." },
    { label: "display name is not guessed into components", author: { name: "Ludwig van Beethoven" }, expected: "Ludwig van Beethoven" },
    { label: "blank components preserve display name byte-for-byte", author: { name: "  Prince  ", sortName: " ", firstName: " ", lastName: "\t" }, expected: "  Prince  " },
    { label: "an empty display name stays empty", author: { name: "" }, expected: "" },
  ];
  it.each(cases)("$label", ({ author, expected }) => {
    expect(goodreadsAuthorLastFirst({ name: "Display Name", sortName: null, firstName: null, lastName: null, ...author })).toBe(expected);
  });
});

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

  it("changes only Author l-f and does not mutate author metadata", () => {
    const before = book();
    const updated = book({ authors: before.authors.map((author, index) => index === 0
      ? { ...author, sortName: " ", firstName: " William ", lastName: " de la Cruz " }
      : { ...author }) });
    const metadata = JSON.stringify(updated.authors);
    updated.authors.forEach(Object.freeze);
    Object.freeze(updated.authors);
    expect(goodreadsRow(updated)).toEqual({ ...goodreadsRow(before), "Author l-f": "de la Cruz, William" });
    expect(JSON.stringify(updated.authors)).toBe(metadata);
    expect(goodreadsRow(book({ authors: [] }))!["Author l-f"]).toBe("");
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

  it("leaves out an unread book that is not in Up next", () => {
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


describe("Goodreads Book Id selection", () => {
  const ids = { latestEdition: null, anyEdition: null, identifier: null, url: null };
  it.each([
    { name: "exact provenance wins over legitimate edition choices", change: { provenance: ["0009007199254740993"], anyEdition: ["11", "22"] }, expected: { id: "0009007199254740993", warning: null } },
    { name: "conflicting provenance never falls through", change: { provenance: ["11", "22"], latestEdition: "33" }, expected: { id: "", warning: "ambiguous" } },
    { name: "cross-book conflict defeats exact provenance", change: { provenance: ["00011"], conflicted: ["11"] }, expected: { id: "", warning: "conflict" } },
    { name: "latest edition wins before later tiers", change: { latestEdition: "11", anyEdition: ["22", "33"] }, expected: { id: "11", warning: null } },
    { name: "an ambiguous applicable tier does not fall through", change: { anyEdition: ["11", "22"], identifier: "33" }, expected: { id: "", warning: "ambiguous" } },
    { name: "repeated same-ID observations stay unambiguous", change: { identifier: ["0011", "11", "0011"] }, expected: { id: "0011", warning: null } },
    { name: "invalid values do not hide a valid lower tier", change: { latestEdition: "invalid", url: "https://www.goodreads.com/book/show/0012.Title" }, expected: { id: "0012", warning: null } },
    { name: "no ID is a normal blank, not a warning", change: {}, expected: { id: "", warning: null } },
  ])("$name", ({ change, expected }) => {
    expect(selectGoodreadsId({ ...ids, ...change })).toEqual(expected);
  });
  it("keeps all other cells and counts only exported unresolved books", () => {
    const original = book({ goodreadsIds: { ...ids, latestEdition: "11" } });
    const unresolved = book({ goodreadsIds: { ...ids, identifier: ["11", "22"] } });
    expect(goodreadsRow(unresolved)).toEqual({ ...goodreadsRow(original), "Book Id": "" });
    expect(unresolvedGoodreadsIds([original, unresolved, { ...unresolved, state: "unread", inUpNext: false }])).toBe(1);
  });
});
