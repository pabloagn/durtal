import { z } from "zod";
import { SOURCE_PROFILE_VERSION, sourceProfile, type SourceField, type SourceProfile } from "./source-profiles";

export const sourceQualitySchema = z.object({
  version: z.literal(SOURCE_PROFILE_VERSION),
  profile: z.enum(["article", "publisher", "open-library", "bnf-sru"]),
  status: z.enum(["usable", "partial", "blocked", "identity_mismatch", "extraction_failed"]),
  present: z.array(z.enum(["mainText", "record", "title", "description", "contributors", "identifiers", "publication", "language", "extent"])),
  missing: z.array(z.enum(["mainText", "record", "title", "description", "contributors", "identifiers", "publication", "language", "extent"])),
  coverage: z.enum(["record", "article", "partial", "snippet"]),
  reasons: z.array(z.string().max(100)),
});
export type SourceQuality = z.infer<typeof sourceQualitySchema>;
export interface SourceIdentity {
  titles: readonly string[];
  authors: readonly string[];
}
export interface SourceContent {
  text: string;
  title?: string | null;
  /** Only the primary record's identity, not related products or menus. */
  identityText?: string;
  fields?: readonly SourceField[];
  partial?: boolean;
}

const fold = (value: string) =>
  ` ${value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
const contains = (text: string, value: string) => value.trim() !== "" && text.includes(fold(value));

export function matchesSourceIdentity(text: string, identity: SourceIdentity): boolean {
  const haystack = fold(text);
  return identity.titles.some((t) => contains(haystack, t)) && (!identity.authors.length || identity.authors.some((a) => contains(haystack, a)));
}

/** Fail closed on interstitial text, including cached HTTP-200 responses. */
export function blockedSourceText(text: string): boolean {
  const beginning = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2200);
  return /verify (?:that )?you (?:are|are a) human|human verification|verification failed|checking your browser|enable javascript and cookies to continue|^\s*just a moment[.!]?\s*$|^\s*access denied\b|^\s*request rejected\b|sign in to (?:read|continue)|log in to (?:read|continue)|subscribe to (?:read|continue)|accept cookies to continue/i.test(
    beginning,
  );
}

export function assessSourceContent(
  content: SourceContent | null,
  url: string,
  options: {
    profile?: SourceProfile;
    identity?: SourceIdentity;
    snippet?: boolean;
  } = {},
): SourceQuality {
  const profile = options.snippet ? sourceProfile("https://snippet.invalid") : (options.profile ?? sourceProfile(url));
  const present = [...new Set(content?.fields ?? (content?.text.trim() ? ["mainText" as const] : []))];
  const missing = profile.supported.filter((field) => !present.includes(field));
  const base: Omit<SourceQuality, "status" | "reasons"> = {
    version: SOURCE_PROFILE_VERSION,
    profile: profile.key,
    present,
    missing,
    coverage: options.snippet ? "snippet" : content?.partial ? "partial" : profile.key === "article" ? "article" : "record",
  };
  if (!content?.text.trim()) return { ...base, status: "extraction_failed", reasons: ["no_content"] };
  if (blockedSourceText(content.text)) return { ...base, status: "blocked", reasons: ["interstitial"] };
  if (options.identity && !matchesSourceIdentity(content.identityText ?? `${content.title ?? ""}\n${content.text}`, options.identity))
    return {
      ...base,
      status: "identity_mismatch",
      reasons: ["primary_identity_mismatch"],
    };
  const words = fold(content.text).trim().split(/\s+/);
  const navigation =
    /^(?:home|menu|search|log|in|sign|up|catalogue|catalog|general|account|privacy|cookies|terms|contact|help|next|back|subscribe|buy|cart|checkout|bnf|format|encoding|notice|tools|fermer|outils|unimarc|intermarc|utf|bibliographiques|linked|records|links|de|la|le|les|des|du|et|to|the|and|a|of|your|for|on|at|en|fr|xml|my)$/;
  if (words.every((w) => navigation.test(w)))
    return {
      ...base,
      status: "extraction_failed",
      reasons: ["navigation_only"],
    };
  const requiredMissing = profile.required.filter((field) => !present.includes(field));
  if (
    ((profile.key === "bnf-sru" || profile.key === "open-library") && !present.includes("record")) ||
    (profile.key === "publisher" && !present.includes("title")) ||
    (profile.key === "article" && !present.includes("mainText"))
  )
    return {
      ...base,
      status: "extraction_failed",
      reasons: ["no_primary_record"],
    };
  const partial = Boolean(options.snippet || content.partial || requiredMissing.length || (missing.length && profile.key !== "article"));
  return {
    ...base,
    coverage: partial ? (options.snippet ? "snippet" : "partial") : base.coverage,
    status: partial ? "partial" : "usable",
    reasons: requiredMissing.map((field) => `missing_${field}`),
  };
}

export const usableSourceQuality = (quality: SourceQuality) => quality.status === "usable" || quality.status === "partial";
