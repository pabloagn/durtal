import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractedPage, MainTextExtractor } from "./evidence-store";

/**
 * The main-text extractor of the evidence store (SLN-468): Mozilla's
 * Readability on a linkedom document, the two packages Joris approved. Every
 * caller goes through `extractMainText`; its name and version go into each
 * stored page's payload, so a quote can be traced to the code that cut it.
 */

/** Elements that start a new paragraph of the main text */
const BLOCKS = "p, div, section, article, header, footer, aside, h1, h2, h3, h4, h5, h6, li, dd, dt, blockquote, pre, figcaption, table, tr, td, th, ul, ol, dl, br, hr";
/** Unicode's paragraph separator marks the breaks while the text is read out */
const BREAK = " ";

/** The main text, paragraphs joined by a blank line, each paragraph's white space collapsed */
function paragraphsOf(contentHtml: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`);
  for (const block of document.body.querySelectorAll(BLOCKS)) {
    block.before(BREAK);
    block.after(BREAK);
  }
  return (document.body.textContent ?? "")
    .split(BREAK)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function extractMainText(html: string, url: string): ExtractedPage | null {
  let { document } = parseHTML(html);
  // A fragment with no <html> element: linkedom would make its first tag the root
  if (document.documentElement?.tagName !== "HTML") ({ document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`));
  // With no <body> tag, linkedom adds an empty one and leaves the page beside it: move the page in, as a browser does
  for (const node of [...document.documentElement.childNodes])
    if (node !== document.head && node !== document.body) document.body.append(node);
  // Read from the head first: Readability changes the document it parses
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim();
  let canonicalUrl: string | null = null;
  try {
    canonicalUrl = canonical ? new URL(canonical, url).href : null;
  } catch {
    canonicalUrl = null;
  }
  const language = document.documentElement.getAttribute("lang")?.trim() || null;
  const article = new Readability(document as unknown as Document).parse();
  if (!article?.content) return null;
  const text = paragraphsOf(article.content);
  if (!text) return null;
  return {
    text,
    title: article.title?.trim() || null,
    byline: article.byline?.trim() || null,
    publishedOn: article.publishedTime?.trim() || null,
    language: article.lang?.trim() || language,
    canonicalUrl,
  };
}

export const mainTextExtractor: MainTextExtractor = {
  name: "readability",
  version: "@mozilla/readability 0.6.0, linkedom 0.18.13",
  extract: extractMainText,
};
