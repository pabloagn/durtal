import { z } from "zod/v4";

// External catalogue pages for a book. Work-level: every edition shares them.
export const BOOK_LINK_SITES = {
  goodreadsUrl: {
    label: "Goodreads",
    host: "goodreads.com",
    placeholder: "https://www.goodreads.com/book/show/…",
  },
  storygraphUrl: {
    label: "The StoryGraph",
    host: "thestorygraph.com",
    placeholder: "https://app.thestorygraph.com/books/…",
  },
} as const;

export type BookLinkField = keyof typeof BOOK_LINK_SITES;

export type BookLinkResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

const MAX_URL_LENGTH = 2048;

/**
 * Check a pasted book link and return its canonical https form.
 * Empty input clears the link. A missing scheme or http is upgraded to https.
 * The host must be the site's own domain or one of its subdomains.
 */
export function parseBookLink(
  field: BookLinkField,
  raw: string | null | undefined,
): BookLinkResult {
  const site = BOOK_LINK_SITES[field];
  const input = (raw ?? "").trim();
  if (input === "") return { ok: true, value: null };
  if (input.length > MAX_URL_LENGTH) {
    return { ok: false, error: `${site.label} link is too long` };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return { ok: false, error: `Enter a full ${site.label} link` };
  }
  if (url.protocol === "http:") url.protocol = "https:";
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (host !== site.host && !host.endsWith(`.${site.host}`))
  ) {
    return { ok: false, error: `Use a link to ${site.host}` };
  }
  return { ok: true, value: url.toString() };
}

function bookLinkField(field: BookLinkField) {
  return z
    .string()
    .nullable()
    .transform((raw, ctx) => {
      const result = parseBookLink(field, raw);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.error });
        return z.NEVER;
      }
      return result.value;
    });
}

export const bookLinksSchema = z.object({
  goodreadsUrl: bookLinkField("goodreadsUrl").optional(),
  storygraphUrl: bookLinkField("storygraphUrl").optional(),
});
