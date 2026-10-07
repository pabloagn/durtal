import { Parser } from "htmlparser2";
import { normalizeLanguage } from "@/lib/utils/language";
import { detectLanguage } from "./language";

/*
 * A book's body text and its counts (SLN-494; the function agreed with the
 * book enrichment epic). Pure: the inspectors read the file and hand over
 * its documents, its plain text or its PDF pages. Words are counted with
 * Intl.Segmenter, so Chinese and Japanese count correctly.
 *
 * TEXT_TOOL_VERSION goes up whenever the counts would change, so the
 * enrichment epic can recompute them.
 */

export const TEXT_TOOL_VERSION = 1;

/** Words a print page holds, for books with no page list */
const WORDS_PER_PAGE = 250;
/** A PDF with fewer words a page is scanned: no text to count */
const SCANNED_WORDS_PER_PAGE = 20;

export type TextSource =
  /** XHTML or HTML documents in reading order, each body or front and back matter */
  | { kind: "html"; parts: { html: string; matter: "body" | "front-back" }[]; printPages?: number | null }
  | { kind: "plain"; text: string }
  /** A PDF's text, page by page */
  | { kind: "pages"; pages: string[] }
  /** No text can be read: the reason in plain words */
  | { kind: "none"; reason: string };

export interface BodyText {
  bodyText: string;
  wordCount: number | null;
  /** Characters of the body text, with each run of white space counted once */
  charCount: number | null;
  frontBackWordCount: number | null;
  pageEstimate: number | null;
  language: string | null;
  toolVersion: number;
  /** Why the counts are null */
  reason: string | null;
}

/** Elements whose text is never read */
const SKIPPED = new Set(["script", "style", "rt", "rp", "head", "title", "template", "noscript", "svg", "math"]);
/** Elements that end a run of text */
const BLOCKS = new Set([
  "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "article", "aside",
  "header", "footer", "tr", "td", "th", "dt", "dd", "pre", "hr", "figcaption", "table", "ul", "ol", "dl", "body",
]);
const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr", "source", "embed", "param", "track"]);

const isHidden = (attributes: Record<string, string>) =>
  "hidden" in attributes ||
  attributes["aria-hidden"] === "true" ||
  /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes.style ?? "");

/** The visible text of an (X)HTML document: no scripts, styles, ruby annotations or hidden elements */
export function htmlText(html: string): string {
  const out: string[] = [];
  // How many open elements skip their text; the stack says which ones do
  let skipping = 0;
  const stack: boolean[] = [];
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const tag = name.toLowerCase().replace(/^.*:/, "");
        const skip = skipping > 0 || SKIPPED.has(tag) || isHidden(attributes);
        if (BLOCKS.has(tag)) out.push("\n");
        if (VOID.has(tag)) return;
        stack.push(skip);
        if (skip) skipping++;
      },
      ontext(text) {
        if (skipping === 0) out.push(text);
      },
      onclosetag(name) {
        const tag = name.toLowerCase().replace(/^.*:/, "");
        if (BLOCKS.has(tag)) out.push("\n");
        if (VOID.has(tag)) return;
        const skipped = stack.pop();
        if (skipped) skipping--;
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  return out
    .join("")
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

/** Words, by Intl.Segmenter: a word is a word-like segment */
export function countWords(text: string, language?: string | null): number {
  if (!text) return 0;
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(language ?? undefined, { granularity: "word" });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  }
  let words = 0;
  for (const segment of segmenter.segment(text)) if (segment.isWordLike) words++;
  return words;
}

const charCount = (text: string) => [...text.replace(/\s+/g, " ").trim()].length;

function noText(reason: string, language: string | null): BodyText {
  return {
    bodyText: "",
    wordCount: null,
    charCount: null,
    frontBackWordCount: null,
    pageEstimate: null,
    language,
    toolVersion: TEXT_TOOL_VERSION,
    reason,
  };
}

/** The body text and its counts. `declaredLanguage` is the file's own, as written. */
export function extractBodyText(source: TextSource, declaredLanguage?: string | null): BodyText {
  const declared = normalizeLanguage(declaredLanguage);
  if (source.kind === "none") return noText(source.reason, declared);

  let body: string;
  let frontBack = "";
  let printPages: number | null = null;
  if (source.kind === "html") {
    const texts = source.parts.map((part) => ({ matter: part.matter, text: htmlText(part.html) }));
    body = texts.filter((t) => t.matter === "body").map((t) => t.text).join("\n\n");
    frontBack = texts.filter((t) => t.matter === "front-back").map((t) => t.text).join("\n\n");
    printPages = source.printPages && source.printPages > 0 ? source.printPages : null;
  } else if (source.kind === "plain") {
    body = source.text.replace(/\r\n?/g, "\n").trim();
  } else {
    body = source.pages.map((page) => page.trim()).join("\n\n").trim();
    printPages = source.pages.length || null;
  }

  const language = detectLanguage(body) ?? declared;
  const wordCount = countWords(body, language);
  if (source.kind === "pages" && wordCount < SCANNED_WORDS_PER_PAGE * Math.max(1, source.pages.length))
    return noText(`Scanned PDF: fewer than ${SCANNED_WORDS_PER_PAGE} words a page`, declared);
  if (wordCount === 0) return noText("No text in the file", declared);
  return {
    bodyText: body,
    wordCount,
    charCount: charCount(body),
    frontBackWordCount: countWords(frontBack, language),
    pageEstimate: printPages ?? Math.ceil(wordCount / WORDS_PER_PAGE),
    language,
    toolVersion: TEXT_TOOL_VERSION,
    reason: null,
  };
}
