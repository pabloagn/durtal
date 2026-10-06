import { describe, expect, it } from "vitest";
import { commonplaceMarkdown, type CommonplaceNote } from "@/lib/export/commonplace";

/* The commonplace book as Markdown (SLN-458) */

const note = (over: Partial<CommonplaceNote>): CommonplaceNote => ({
  workId: "w1",
  title: "Nadja",
  author: "André Breton",
  kind: "quote",
  body: "Who am I?",
  thought: null,
  page: null,
  endPage: null,
  pageRoman: false,
  chapter: null,
  percent: null,
  isFavourite: false,
  edition: null,
  ...over,
});

describe("commonplaceMarkdown", () => {
  it("heads each book with its title and author, then its passages in order with page, chapter, star and thought", () => {
    const md = commonplaceMarkdown(
      [
        note({ page: 11, chapter: "1", body: "Who am I?\nIf this once\n\nI were to rely on a proverb", isFavourite: true, thought: "The opening." }),
        note({ kind: "note", page: 40, body: "Compare with *L'Amour fou*." }),
        note({ workId: "w2", title: "Watt", author: "Samuel Beckett", percent: 44.4, body: "# not a heading\n- not a list" }),
      ],
      "2026-10-06",
    );
    expect(md).toBe(
      [
        "# Commonplace book",
        "",
        "Exported from Durtal on 6 October 2026: 2 quotes and 1 note from 2 books.",
        "",
        "## Nadja",
        "",
        "André Breton",
        "",
        "> Who am I?",
        "> If this once",
        ">",
        "> I were to rely on a proverb",
        "",
        "p. 11 · ch. 1 · ★ Favourite",
        "",
        "The opening.",
        "",
        "Note · p. 40",
        "",
        "Compare with \\*L'Amour fou\\*.",
        "",
        "## Watt",
        "",
        "Samuel Beckett",
        "",
        "> \\# not a heading",
        "> \\- not a list",
        "",
        "44%",
        "",
      ].join("\n"),
    );
  });

  it("cites a page range, roman pages and the edition as the pages do (SLN-480)", () => {
    const edition = { label: "Gallimard, 1928", title: "Nadja", publisher: "Gallimard", year: 1928, translators: [] };
    const md = commonplaceMarkdown(
      [
        note({ page: 212, endPage: 213, chapter: "7", edition }),
        note({ page: 14, endPage: 16, pageRoman: true }),
      ],
      "2026-10-06",
    );
    expect(md).toContain("\npp. 212–213 · Gallimard, 1928 · ch. 7\n");
    expect(md).toContain("\npp. xiv–xvi\n");
  });

  it("keeps links, HTML, tables, numbered lines and rules as text, with no backslash before a digit", () => {
    const body = "See [the map](http://x.y) <b>here</b> & ~~there~~\n1) first\n2026. A year\n---\na | b";
    const md = commonplaceMarkdown([note({ body, title: "A <b> [title]" })], "2026-10-06");
    expect(md).toContain("## A \\<b\\> \\[title\\]");
    expect(md).toContain("> See \\[the map\\](http://x.y) \\<b\\>here\\</b\\> \\& \\~\\~there\\~\\~\n> 1\\) first\n> 2026\\. A year\n> \\---\n> a \\| b");
  });

  it("keeps a poem's indented verse as indented text, never a code block", () => {
    const md = commonplaceMarkdown([note({ body: "The first line\n\n    an indented verse\n\tand a tabbed one" })], "2026-10-06");
    expect(md).toContain("> The first line\n>\n> \u00a0\u00a0\u00a0\u00a0an indented verse\n> \u00a0\u00a0\u00a0\u00a0and a tabbed one");
  });

  it("keeps a line of only spaces between stanzas as a stanza break", () => {
    const md = commonplaceMarkdown([note({ body: "The first stanza\n   \n\t\nThe second" })], "2026-10-06");
    expect(md).toContain("> The first stanza\n>    \n> \t\n> The second");
  });

  it("says so when there is nothing", () => {
    expect(commonplaceMarkdown([], "2026-10-06")).toBe("# Commonplace book\n\nExported from Durtal on 6 October 2026: No quotes or notes.\n");
  });
});
