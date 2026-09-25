/**
 * Plain text ⇄ HTML helpers for rich-text inputs.
 * No dependencies, safe to import in client components.
 */

/** Escape text so that it is shown literally when inserted as HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert pasted plain text to HTML: a blank line starts a new paragraph,
 * a single newline becomes <br>. All text is escaped.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== "")
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Only web and mail links are allowed in user-entered rich text. */
export function isSafeLinkUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}
