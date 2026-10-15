import type { ReaderAnnotation } from "./annotations";
import { compareBookPlaces } from "./book-order";

export interface AnnotationExportBook {
  id: string;
  title: string;
  authors: readonly string[];
}
export interface AnnotationExportInput {
  book: AnnotationExportBook;
  annotations: readonly ReaderAnnotation[];
  exportedAt: string;
}
const escapeMarkdown = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/([`*_{}\[\]<>#!|])/g, "\\$1");

function exportAnnotations(input: AnnotationExportInput) {
  return input.annotations
    .filter((item) => item.ebookId === input.book.id && !item.deletedAt)
    .slice()
    .sort(
      (a, b) => compareBookPlaces(a.locator, b.locator) || a.id.localeCompare(b.id),
    );
}

function location(item: ReaderAnnotation) {
  const place = item.locator.pageLabel
    ? `p. ${item.locator.pageLabel}`
    : `${Math.round(item.progression * 10000) / 100}%`;
  if (item.anchorState === "orphaned")
    return `Could not be placed · original ${place}`;
  return item.anchorState === "approximate" ? `About ${place}` : place;
}

/** No Date.now, fetch, clipboard, storage or DOM: all inputs are explicit. */
export function annotationsToMarkdown(input: AnnotationExportInput): string {
  const lines = [
    `# ${escapeMarkdown(input.book.title)}`,
    "",
    escapeMarkdown(input.book.authors.join(", ")),
    "",
    `Exported ${escapeMarkdown(input.exportedAt)}`,
    "",
  ];
  const groups = new Map<string, ReaderAnnotation[]>();
  for (const item of exportAnnotations(input)) {
    const chapter = item.chapter ?? item.locator.tocLabel ?? "No chapter";
    const group = groups.get(chapter) ?? [];
    group.push(item);
    groups.set(chapter, group);
  }
  for (const [chapter, items] of groups) {
    lines.push(`## ${escapeMarkdown(chapter)}`, "");
    for (const item of items.filter((mark) => mark.kind === "highlight")) {
      lines.push(
        ...(item.text ?? "")
          .split(/\r?\n/)
          .map((line) => `> ${escapeMarkdown(line)}`),
        "",
        escapeMarkdown(location(item)),
        "",
      );
      if (item.note) lines.push(escapeMarkdown(item.note), "");
    }
    const bookmarks = items.filter((mark) => mark.kind === "bookmark");
    if (bookmarks.length) {
      lines.push("### Bookmarks", "");
      for (const item of bookmarks) {
        const label = (item.locator.text?.highlight ?? "")
          .trim()
          .split(/\s+/)
          .slice(0, 8)
          .join(" ");
        lines.push(
          `- ${escapeMarkdown(location(item))}${label ? ` · ${escapeMarkdown(label)}` : ""}`,
        );
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** bodyValue and body MUST NOT coexist. Use proper tagging/commenting bodies.
 * Stable URNs identify immutable files; expiring delivery URLs never enter exports.
 * Original passage and anchor state use explicitly namespaced extension properties.
 */
export function annotationsToW3C(input: AnnotationExportInput) {
  return {
    "@context": ["http://www.w3.org/ns/anno.jsonld", { durtal: "urn:durtal:" }],
    id: `urn:durtal:annotation-export:${input.book.id}:${encodeURIComponent(input.exportedAt)}`,
    type: "AnnotationPage",
    generated: input.exportedAt,
    items: exportAnnotations(input).map((item) => {
      const bodies: {
        type: "TextualBody";
        value: string;
        purpose: "tagging" | "commenting";
        format: "text/plain";
      }[] = [];
      if (item.color)
        bodies.push({
          type: "TextualBody",
          value: `color:${item.color}`,
          purpose: "tagging",
          format: "text/plain",
        });
      bodies.push({
        type: "TextualBody",
        value: `style:${item.style}`,
        purpose: "tagging",
        format: "text/plain",
      });
      if (item.note)
        bodies.push({
          type: "TextualBody",
          value: item.note,
          purpose: "commenting",
          format: "text/plain",
        });
      const selectors: (
        | {
            type: "TextQuoteSelector";
            exact: string;
            prefix?: string;
            suffix?: string;
          }
        | { type: "FragmentSelector"; value: string; conformsTo: string }
      )[] = [];
      const quote = item.locator.text;
      if (quote?.highlight)
        selectors.push({
          type: "TextQuoteSelector",
          exact: quote.highlight,
          ...(quote.before ? { prefix: quote.before } : {}),
          ...(quote.after ? { suffix: quote.after } : {}),
        });
      if (item.locator.pdf)
        selectors.push({
          type: "FragmentSelector",
          value: `page=${item.locator.pdf.page}`,
          conformsTo: "http://tools.ietf.org/rfc/rfc3778",
        });
      else if (item.locator.cfi)
        selectors.push({
          type: "FragmentSelector",
          value: item.locator.cfi,
          conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
        });
      return {
        id: `urn:uuid:${item.id}`,
        type: "Annotation",
        motivation: item.kind === "bookmark" ? "bookmarking" : "highlighting",
        created: item.createdAt,
        modified: item.updatedAt,
        body: bodies,
        target: {
          type: "SpecificResource",
          source: `urn:durtal:ebook-file:${item.fileId}`,
          ...(selectors.length ? { selector: selectors } : {}),
        },
        "durtal:anchorState": item.anchorState,
        ...(item.text !== null ? { "durtal:quotedText": item.text } : {}),
      };
    }),
  };
}

export function annotationExportFilename(
  title: string,
  format: "markdown" | "w3c",
) {
  const name =
    Array.from(
      title
        .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
        .trim()
        .replace(/\s+/g, " "),
    )
      .slice(0, 120)
      .join("")
      .replace(/[. ]+$/, "") || "eBook";
  return `${name}${format === "markdown" ? ".md" : ".annotations.json"}`;
}
