import {
  duplicateMetadataKey,
  ebookFlags,
  identifierKeys,
  matchFingerprint,
} from "./keys";
import { MATCH_MODEL } from "./model";
import { prepareMatchEbook, scorePair } from "./score";
import { editionEffect, usableFile } from "./editions";
import type { MatchCatalogue } from "./catalogue";
import type {
  MatchCandidate,
  MatchEbook,
  MatchResult,
  MatchTier,
  PairScore,
} from "./types";

const nativeCount = (ebook: MatchEbook) =>
  new Set(
    ebook.files
      .filter((file) => usableFile(file) && file.availability === "native")
      .map((file) => file.format),
  ).size;
const preferredDuplicate = (a: MatchEbook, b: MatchEbook) =>
  nativeCount(b) - nativeCount(a) ||
  Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  a.id.localeCompare(b.id);
/** Duplicate is a review proposal, never a deletion or consolidation. Require agreeing text identity. */
export function duplicateTarget(
  ebook: MatchEbook,
  catalogue: MatchCatalogue,
): string | null {
  const key = duplicateMetadataKey(ebook);
  if (!key) return null;
  const ids = identifierKeys(ebook.isbns, ebook.identifiers);
  const matches = (catalogue.duplicateGroups.get(key) ?? [])
    .filter((other) => {
      if (
        other.id === ebook.id ||
        other.matchState === "excluded" ||
        preferredDuplicate(other, ebook) >= 0
      )
        return false;
      const sharedIsbn = identifierKeys(
        other.isbns,
        other.identifiers,
      ).isbns.some(
        (isbn) => ids.isbns.includes(isbn) && !catalogue.sharedIsbns.has(isbn),
      );
      return (
        sharedIsbn ||
        other.files.some((a) => ebook.files.some((b) => a.format === b.format))
      );
    })
    .sort(preferredDuplicate);
  return matches[0]?.id ?? null;
}
function eligible(score: PairScore) {
  return (
    !score.flags.length && !score.vetoes.length && !score.identifierConflict
  );
}
/** No I/O. Persisting a result or converting its effect into an executable plan is a separate boundary. */
export function matchOne(
  ebook: MatchEbook,
  catalogue: MatchCatalogue,
  options: { rematch?: boolean } = {},
): MatchResult {
  const fingerprint = matchFingerprint(ebook);
  const base: MatchResult = {
    ebookId: ebook.id,
    fingerprint,
    modelVersion: MATCH_MODEL.version,
    tier: null,
    skipped: null,
    autoLink: false,
    duplicateOfId: null,
    flags: ebookFlags(ebook),
    reasons: [],
    candidates: [],
  };
  if (ebook.instanceId || ebook.matchState === "linked")
    return { ...base, skipped: "linked" };
  if (
    ebook.matchState !== "pending" &&
    (!options.rematch || ebook.matchFingerprint === fingerprint)
  )
    return { ...base, skipped: "unchanged_decision" };
  const duplicateOfId = duplicateTarget(ebook, catalogue);
  if (duplicateOfId)
    return {
      ...base,
      tier: "duplicate",
      duplicateOfId,
      reasons: [
        {
          code: "duplicate",
          text: "Another ebook has the same title, authors, language and matching format or ISBN",
        },
      ],
    };
  const prepared = prepareMatchEbook(ebook, catalogue);
  const scores = catalogue.works
    .map((work) => scorePair(ebook, work, catalogue, prepared))
    .sort(
      (a, b) => b.weightBits - a.weightBits || a.workId.localeCompare(b.workId),
    );
  const best = scores[0];
  const margin =
    best && scores[1] ? best.weightBits - scores[1].weightBits : null;
  let tier: MatchTier = "not_in_durtal";
  // Non-books cannot gain an automatic link from a coincidentally strong title or identifier.
  if (
    base.flags.some((flag) =>
      ["sample", "periodical", "article"].includes(flag),
    )
  )
    tier = "not_a_book";
  else if (
    best?.identifierConflict ||
    identifierKeys(ebook.isbns, ebook.identifiers).isbns.some((isbn) =>
      catalogue.sharedIsbns.has(isbn),
    )
  )
    tier = "conflict";
  else if (best) {
    const exact =
      best.identifierEditions.length === 1 &&
      best.identifierMethods.length > 0 &&
      (best.titleSimilarity >= 0.8 ||
        best.authorLevel === "identity" ||
        best.authorLevel === "compatible");
    const strong =
      best.probability >= MATCH_MODEL.thresholds.strong &&
      (margin === null || margin >= MATCH_MODEL.thresholds.margin);
    if (exact && eligible(best)) tier = "exact";
    else if (strong && eligible(best) && best.titleSimilarity >= 0.5)
      tier = "strong";
    else if (best.probability >= MATCH_MODEL.thresholds.likely) tier = "likely";
    else if (best.probability >= MATCH_MODEL.thresholds.candidate)
      tier = "to_choose";
    else if (
      scores.some((score) =>
        ["identity", "compatible"].includes(score.authorLevel),
      )
    )
      tier = "same_author";
  }
  const proposed =
    tier === "same_author"
      ? scores.filter((score) =>
          ["identity", "compatible"].includes(score.authorLevel),
        )
      : tier === "conflict"
        ? scores.filter(
            (score) =>
              score.identifierMethods.length ||
              score.probability >= MATCH_MODEL.thresholds.candidate,
          )
        : scores.filter(
            (score) => score.probability >= MATCH_MODEL.thresholds.candidate,
          );
  const candidates: MatchCandidate[] = proposed
    .slice(0, 3)
    .map((score, i) => ({
      ...score,
      rank: i + 1,
      marginBits: i === 0 ? margin : null,
      effect: editionEffect(
        ebook,
        catalogue.byWorkId.get(score.workId)!,
        catalogue,
      ),
    }));
  const first = candidates[0];
  const autoLink =
    (tier === "exact" || tier === "strong") &&
    !!first?.effect.ready &&
    eligible(first) &&
    (margin === null || margin >= MATCH_MODEL.thresholds.margin);
  const reasons = best?.reasons.length
    ? best.reasons
    : [
        {
          code: tier,
          text:
            tier === "not_a_book"
              ? `The file is flagged ${prepared.flags.join(", ")}`
              : tier === "conflict"
                ? "Its ISBN is not identifying; review the file metadata"
                : "No catalogue title or author supplies a candidate",
        },
      ];
  return {
    ...base,
    tier,
    autoLink,
    candidates,
    flags: prepared.flags,
    reasons,
  };
}
export function matchInMemory(
  ebooks: readonly MatchEbook[],
  catalogue: MatchCatalogue,
  options: { rematch?: boolean } = {},
): MatchResult[] {
  return [...ebooks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((ebook) => matchOne(ebook, catalogue, options));
}
