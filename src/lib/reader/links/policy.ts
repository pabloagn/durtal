export type LinkPolicy =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string; scheme: "http:" | "https:" | "mailto:" }
  | { kind: "blocked" };

/** Classify book-relative references before resolution, and resolved URLs again. */
export function classifyReaderLink(value: string): LinkPolicy {
  // URL parsers discard these characters, which can conceal an unsafe scheme.
  if (/[\u0000-\u001f\u007f\\]/u.test(value)) return { kind: "blocked" };
  const href = value.trim();
  if (!href) return { kind: "blocked" };
  const candidate = href.startsWith("//") ? `https:${href}` : href;
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(candidate)?.[0].toLowerCase();
  if (!scheme) {
    // A colon in the first path component is not a book-relative reference.
    if (candidate.split(/[/?#]/, 1)[0].includes(":"))
      return { kind: "blocked" };
    return { kind: "internal", href };
  }
  if (scheme !== "http:" && scheme !== "https:" && scheme !== "mailto:")
    return { kind: "blocked" };
  try {
    const url = new URL(candidate);
    if (url.protocol !== scheme || url.username || url.password)
      return { kind: "blocked" };
    if (scheme === "mailto:") {
      if (!url.pathname || /%0[ad]/i.test(url.href)) return { kind: "blocked" };
    } else if (!/^https?:\/\//i.test(candidate) || !url.hostname)
      return { kind: "blocked" };
    return { kind: "external", href: url.href, scheme };
  } catch {
    return { kind: "blocked" };
  }
}

export const EXTERNAL_WINDOW_FEATURES = "noopener,noreferrer";
