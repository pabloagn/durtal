// Zod-free, so client components can import it without loading zod.

/**
 * A recommender's website: trimmed, `https://` added when missing, `http`
 * upgraded. Empty clears it. Only public web addresses are kept.
 */
export function parseWebsite(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const input = (raw ?? "").trim();
  if (!input) return { ok: true, value: null };
  if (input.length > 2048) return { ok: false, error: "Website is too long" };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return { ok: false, error: "Enter a full website address" };
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.includes(".")
  ) {
    return {
      ok: false,
      error: "Enter a web address such as https://youtube.com/@name",
    };
  }
  return { ok: true, value: url.toString() };
}

/** Display form of a website: host and path without the scheme, e.g. "youtube.com/@Lifeonbooks". */
export function websiteLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}
