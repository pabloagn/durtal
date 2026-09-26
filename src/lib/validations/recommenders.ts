import { z } from "zod/v4";

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

export const recommenderInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  url: z
    .string()
    .nullable()
    .optional()
    .transform((raw, ctx) => {
      const result = parseWebsite(raw);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.error });
        return z.NEVER;
      }
      return result.value;
    }),
});

export type RecommenderInput = z.input<typeof recommenderInputSchema>;

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
