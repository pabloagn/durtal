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
 * An author bio for storage: sanitized like a book description, or null when
 * it has no visible text. `undefined` (the field was not sent) stays undefined.
 */
export function cleanBioForStorage(
  bio: string | null | undefined,
): string | null | undefined {
  if (bio == null) return bio;
  const clean = sanitizeDescriptionHtml(bio).trim();
  return stripHtmlToText(clean) ? clean : null;
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

/**
 * Text without control characters. Library records mark the words a sort
 * skips with hidden ones ("\u0098The\u009c loser"); tabs and line breaks stay.
 */
export function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}
