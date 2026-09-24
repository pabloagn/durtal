import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "hr",
  "br",
  "img",
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "target", "rel"],
  img: ["src", "alt", "width", "height"],
  pre: ["class"],
  code: ["class"],
};

export function sanitizeCommentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https"],
  });
}

/**
 * Sanitize HTML in book descriptions (from Google Books, Open Library, ISBNdb, etc).
 * Allows basic formatting tags only — no scripts, iframes, or event handlers.
 */
export function sanitizeDescriptionHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["b", "strong", "i", "em", "br", "p", "ul", "ol", "li", "a"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https"],
  });
}

/**
 * Strip all HTML tags from a string and return clean plain text.
 * Converts block-level tags and <br> to newlines, collapses whitespace.
 * Lightweight — no external dependency, safe to use client-side.
 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
