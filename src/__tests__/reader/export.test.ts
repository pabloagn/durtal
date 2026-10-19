import { describe, expect, it, vi } from "vitest";
import {
  annotationsToMarkdown,
  annotationsToW3C,
  annotationExportFilename,
} from "@/lib/reader/export";
import { annotation, at, id, locator } from "./fixtures/annotation";
const input = {
  book: { id: id(2), title: "Là-bas", authors: ["J.-K. Huysmans"] },
  exportedAt: at,
  annotations: [
    annotation(),
    annotation({
      id: id(5),
      kind: "bookmark",
      text: null,
      note: null,
      color: null,
      locator: {
        ...locator,
        progression: 0.3,
        text: { highlight: "one two three four five six seven eight nine" },
      },
    }),
  ],
};

describe("offline pure annotation exports", () => {
  it("serializes chapters, passages, notes, page labels and eight-word bookmarks", () => {
    expect(annotationsToMarkdown(input)).toBe(
      "# Là-bas\n\nJ.-K. Huysmans\n\nExported 2026-10-09T12:00:00.000000Z\n\n## The Black Mass\n\n> The quiet glass.\n\np. 212\n\nMy thought\n\n### Bookmarks\n\n- p. 212 · one two three four five six seven eight\n",
    );
  });
  it("keeps marks in book order, a heading over each run under one chapter (SLN-1001)", () => {
    const at = (n: number, sectionIndex: number, chapter: string | null, text: string) =>
      annotation({ id: id(20 + n), chapter, text, note: null,
        locator: { ...locator, sectionIndex, progression: 0.5, cfi: undefined, pageLabel: undefined, totalProgression: n / 10, tocLabel: undefined } });
    const markdown = annotationsToMarkdown({
      ...input,
      // Given out of order: two chapterless marks fall on either side of Chapter Two
      annotations: [at(5, 5, null, "Late, unnamed"), at(3, 3, "Chapter Two", "In two"), at(1, 1, null, "Early, unnamed"),
        at(4, 4, "Chapter Two", "Still in two")],
    });
    const lines = markdown.split("\n").filter((line) => line.startsWith("## ") || line.startsWith("> "));
    expect(lines).toEqual(["## No chapter", "> Early, unnamed", "## Chapter Two", "> In two", "> Still in two",
      "## No chapter", "> Late, unnamed"]);
  });
  it("preserves orphaned text and notes and labels approximations honestly", () => {
    const markdown = annotationsToMarkdown({
      ...input,
      annotations: [
        annotation({ anchorState: "orphaned" }),
        annotation({
          id: id(8),
          anchorState: "approximate",
          locator: { ...locator, pageLabel: undefined },
        }),
      ],
    });
    expect(markdown).toContain("Could not be placed · original p. 212");
    expect(markdown).toContain("About 44%");
    expect(markdown).toContain("My thought");
  });
  it("omits tombstones and other books and escapes plain text markup", () => {
    const markdown = annotationsToMarkdown({
      ...input,
      annotations: [
        annotation({ deletedAt: at }),
        annotation({ ebookId: id(9) }),
        annotation({
          id: id(8),
          text: "<script>\n# injected",
          note: "[link](bad)",
        }),
      ],
    });
    expect(markdown.match(/> /g)).toHaveLength(2);
    expect(markdown).toContain("\\<script\\>");
    expect(markdown).toContain("\\[link\\](bad)");
  });
  it("produces standards-valid bodies and exact quote/fragment selectors without bodyValue", () => {
    const page = annotationsToW3C(input),
      item = page.items[0];
    expect(page["@context"][0]).toBe("http://www.w3.org/ns/anno.jsonld");
    expect(page.type).toBe("AnnotationPage");
    expect(item).not.toHaveProperty("bodyValue");
    expect(item.body).toEqual([
      {
        type: "TextualBody",
        value: "color:ochre",
        purpose: "tagging",
        format: "text/plain",
      },
      {
        type: "TextualBody",
        value: "style:highlight",
        purpose: "tagging",
        format: "text/plain",
      },
      {
        type: "TextualBody",
        value: "My thought",
        purpose: "commenting",
        format: "text/plain",
      },
    ]);
    expect(item.target.selector).toEqual([
      {
        type: "TextQuoteSelector",
        exact: "The quiet glass.",
        prefix: "Before. ",
        suffix: " After.",
      },
      {
        type: "FragmentSelector",
        value: locator.cfi,
        conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
      },
    ]);
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });
  it("exports a PDF page, quote style and original orphaned passage without a gold tag", () => {
    const page = annotationsToW3C({
      ...input,
      annotations: [
        annotation({
          style: "quote",
          color: null,
          anchorState: "orphaned",
          locator: { ...locator, cfi: undefined, pdf: { page: 12 } },
        }),
      ],
    });
    expect(page.items[0].target.selector?.[1]).toMatchObject({
      value: "page=12",
      conformsTo: "http://tools.ietf.org/rfc/rfc3778",
    });
    expect(page.items[0]["durtal:quotedText"]).toBe("The quiet glass.");
    expect(
      page.items[0].body.some((body) => body.value.startsWith("color:")),
    ).toBe(false);
  });
  it("does not fetch, use wall time or access storage", () => {
    const fetch = vi.fn(() => {
      throw new Error("Network unavailable");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(annotationsToMarkdown(input)).toBe(annotationsToMarkdown(input));
      expect(annotationsToW3C(input).items).toHaveLength(2);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("makes safe filenames without breaking Unicode characters", () => {
    expect(annotationExportFilename("/Là-bas: notes?", "w3c")).toBe(
      "Là-bas notes.annotations.json",
    );
    expect(annotationExportFilename("...", "markdown")).toBe("eBook.md");
    expect(
      Array.from(
        annotationExportFilename("🙂".repeat(130), "markdown").slice(0, -3),
      ),
    ).toHaveLength(120);
  });
});
