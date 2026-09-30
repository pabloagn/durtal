import { describe, expect, it } from "vitest";
import {
  cleanPublisherName,
  isbnPrefix,
  isbnPrefixLabel,
  publisherLooseKeys,
  publisherNameProblem,
  publisherSlug,
  relatedPublisherKey,
  sameBookTitle,
} from "@/lib/publishers/names";

describe("publisher loose keys", () => {
  it("matches spellings of one house", () => {
    const house = publisherLooseKeys("New York Review Books (NYRB)");
    expect(house).toEqual(["new york review", "nyrb"]);
    expect(publisherLooseKeys("New York Review of Books")).toEqual(["new york review"]);
    expect(publisherLooseKeys("New York Review Books")).toEqual(["new york review"]);
    expect(publisherLooseKeys("Penguin Books, Limited")).toEqual(["penguin"]);
    expect(publisherLooseKeys("New Directions Publishing Corporation")).toEqual([
      "new direction",
    ]);
    expect(publisherLooseKeys("Vintage/Ebury (a Division of Random")).toEqual([
      "vintage ebury",
    ]);
  });

  it("keeps words that tell houses apart", () => {
    expect(publisherLooseKeys("Penguin Classics")).toEqual(["penguin classic"]);
    expect(publisherLooseKeys("Penguin Random House")).toEqual(["penguin random house"]);
    expect(publisherLooseKeys("Éditions de Minuit")).toEqual(["edition de minuit"]);
  });
});

describe("ISBN publisher prefixes", () => {
  it.each([
    ["9781590178010", "978159017", "978-1-59017"],
    ["978-1-68137-136-8", "978168137", "978-1-68137"],
    ["0143039431", "978014", "978-0-14"],
  ])("finds the publisher part of %s", (isbn, digits, label) => {
    expect(isbnPrefix(isbn)).toEqual({ digits, label });
  });

  it("ignores values that are not ISBNs", () => {
    expect(isbnPrefix(null)).toBeNull();
    expect(isbnPrefix("")).toBeNull();
    expect(isbnPrefix("12345")).toBeNull();
  });

  it("hyphenates a stored prefix", () => {
    expect(isbnPrefixLabel("978159017")).toBe("978-1-59017");
    expect(isbnPrefixLabel("978014")).toBe("978-0-14");
  });
});

describe("publisher name guardrails", () => {
  it.each([
    ["Valancourt Books", null],
    ["Apocalypse Party", null],
    ["A&C Black", null],
    ["Faber & Faber", null],
    ["Éditions de Minuit", null],
    ["Random House Publishing Services", "Looks like a distributor"],
    ["Distributed by Consortium", "Looks like a distributor"],
    ["CreateSpace Independent Publishing Platform", "A self-publishing or print-on-demand platform"],
    ["Independently published", "A self-publishing or print-on-demand platform"],
    ["Unknown", "A placeholder, not a publisher"],
    ["[s.n.]", "A placeholder, not a publisher"],
    ["Vintage/Ebury (a Division of Random", "Names a parent company"],
    ["Penguin Books (an imprint of", "Names a parent company"],
    ["Oxford University Press (", "Looks cut off"],
    ["Hamish Hamilton and", "Looks cut off"],
    ["London : Penguin", "Holds more than one name or a place"],
    ["www.example.com", "Looks like a web or email address"],
    ["1984", "Not a name"],
    ["AB 123456 789", "Mostly numbers"],
  ])("%s → %s", (name, problem) => {
    expect(publisherNameProblem(name)).toBe(problem);
  });

  it("holds a publisher named after the book's author", () => {
    expect(publisherNameProblem("Jane Doe", ["Jane Doe"])).toBe(
      "Same as the author: may be self-published",
    );
  });

  it.each([
    ["Canongate Books Ltd", "Canongate Books"],
    ["Dedalus Limited", "Dedalus"],
    ["VALANCOURT BOOKS", "Valancourt Books"],
    ["Serpent's Tail Limited,", "Serpent's Tail"],
    ["Profile Books Limited", "Profile Books"],
    ["New Directions Publishing Corporation", "New Directions Publishing"],
  ])("cleans %s to %s", (raw, clean) => {
    expect(cleanPublisherName(raw)).toBe(clean);
  });

  it("finds a house of the same family", () => {
    const houses = ["bloomsbury", "penguin random house", "new direction", "feminist", "black coat", "university california", "modern library", "pali text society"];
    expect(relatedPublisherKey("bloomsbury paperback", houses)).toBe("bloomsbury");
    expect(relatedPublisherKey("random house", houses)).toBe("penguin random house");
    expect(relatedPublisherKey("random house world", houses)).toBe("penguin random house");
    expect(relatedPublisherKey("literatura random house", houses)).toBe("penguin random house");
    expect(relatedPublisherKey("feminist at city university new york", houses)).toBe("feminist");
    expect(relatedPublisherKey("feminist at city university new york", ["new york review"])).toBeNull();
    for (const free of ["valancourt", "new", "c black", "university oklahoma", "modern language association america", "text"])
      expect(relatedPublisherKey(free, houses), free).toBeNull();
  });

  it("holds junk that only looks like a name", () => {
    expect(publisherNameProblem("：　Ｖｉｎｔａｇｅ")).toBe("Looks cut off");
    expect(publisherNameProblem("Courier Corporation")).toBe(
      "A parent or distributor label that sources put on other publishers' books",
    );
  });

  it.each([
    ["Dubliners: A Norton Critical Edition", "Dubliners", true],
    ["The Complete Tales and Poems of Edgar Allan Poe", "The Complete Tales and Poems of Edgar Allan Poe", true],
    ["Tales of Mystery and Imagination", "Mystery and Imagination: Tales", true],
    ["Sports Nutrition: A Handbook for Professionals", "Light in August", false],
  ])("compares edition %s with work %s", (edition, work, same) => {
    expect(sameBookTitle(edition, work)).toBe(same);
  });

  it("makes stable slugs", () => {
    expect(publisherSlug("Éditions de Minuit", "1234567890")).toBe("editions-de-minuit-12345678");
  });
});
