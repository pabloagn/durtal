import { describe, expect, it } from "vitest";
import { bookLinksSchema, parseBookLink } from "@/lib/validations/book-links";
import { createWorkSchema } from "@/lib/validations/works";
import { parseBookLinkValues } from "@/components/books/book-links-fields";

describe("parseBookLink", () => {
  it.each([
    [
      "goodreadsUrl",
      "https://www.goodreads.com/book/show/7299.Fictions",
      "https://www.goodreads.com/book/show/7299.Fictions",
    ],
    [
      "goodreadsUrl",
      "  goodreads.com/book/show/7299  ",
      "https://goodreads.com/book/show/7299",
    ],
    [
      "goodreadsUrl",
      "http://www.goodreads.com/book/show/7299",
      "https://www.goodreads.com/book/show/7299",
    ],
    [
      "storygraphUrl",
      "https://app.thestorygraph.com/books/0a1b2c3d",
      "https://app.thestorygraph.com/books/0a1b2c3d",
    ],
    [
      "storygraphUrl",
      "HTTPS://APP.THESTORYGRAPH.COM/books/x?ref=1#top",
      "https://app.thestorygraph.com/books/x?ref=1#top",
    ],
  ] as const)("accepts %s %s", (field, raw, expected) => {
    expect(parseBookLink(field, raw)).toEqual({ ok: true, value: expected });
  });

  it.each([null, undefined, "", "   "])("clears the link for %j", (raw) => {
    expect(parseBookLink("goodreadsUrl", raw)).toEqual({
      ok: true,
      value: null,
    });
  });

  it.each([
    ["goodreadsUrl", "https://evilgoodreads.com/book/show/1"],
    ["goodreadsUrl", "https://goodreads.com.evil.example/book"],
    ["goodreadsUrl", "https://app.thestorygraph.com/books/1"],
    ["storygraphUrl", "https://www.goodreads.com/book/show/1"],
    ["goodreadsUrl", "javascript:alert(1)"],
    ["goodreadsUrl", "data:text/html,hi"],
    ["goodreadsUrl", "ftp://goodreads.com/book"],
    ["goodreadsUrl", "https://user:pass@goodreads.com/book"],
    ["goodreadsUrl", "not a url at all"],
    ["goodreadsUrl", `https://goodreads.com/${"a".repeat(2100)}`],
  ] as const)("rejects %s %s", (field, raw) => {
    expect(parseBookLink(field, raw).ok).toBe(false);
  });

  it("is stable when a saved link is checked again", () => {
    const first = parseBookLink("goodreadsUrl", "goodreads.com/book/show/1");
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(parseBookLink("goodreadsUrl", first.value)).toEqual(first);
    }
  });
});

describe("book link schemas", () => {
  it("normalises valid links and leaves omitted fields alone", () => {
    expect(
      bookLinksSchema.parse({ goodreadsUrl: "goodreads.com/book/show/1" }),
    ).toEqual({ goodreadsUrl: "https://goodreads.com/book/show/1" });
    expect(bookLinksSchema.parse({})).toEqual({});
    expect(bookLinksSchema.parse({ storygraphUrl: null })).toEqual({
      storygraphUrl: null,
    });
  });

  it("rejects a wrong site in work creation", () => {
    const base = {
      title: "Fictions",
      authorIds: [{ authorId: "00000000-0000-4000-8000-000000000000" }],
    };
    expect(createWorkSchema.safeParse(base).success).toBe(true);
    expect(
      createWorkSchema.safeParse({
        ...base,
        storygraphUrl: "https://example.com/books/1",
      }).success,
    ).toBe(false);
  });

  it("parses dialog values and reports the first error", () => {
    expect(
      parseBookLinkValues({
        goodreadsUrl: "",
        storygraphUrl: "app.thestorygraph.com/books/1",
      }),
    ).toEqual({
      ok: true,
      links: {
        goodreadsUrl: null,
        storygraphUrl: "https://app.thestorygraph.com/books/1",
      },
    });
    expect(
      parseBookLinkValues({
        goodreadsUrl: "https://example.com",
        storygraphUrl: "",
      }),
    ).toEqual({ ok: false, error: "Use a link to goodreads.com" });
  });
});
