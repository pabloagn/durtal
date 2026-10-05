import { createHash } from "node:crypto";

/*
 * The passage of the day (SLN-453): one of his quotes, the same all day on
 * every device. The candidates are his favourite quotes when there are at
 * least FAVOURITES_ONLY of them, else all his quotes with the favourites
 * first. Each group is in the order of the SHA-256 of the quote's id, and the
 * day picks the candidate at (days since 1970-01-01) modulo their number: so
 * while his quotes do not change, N candidates never repeat within N days.
 */

/** With this many favourite quotes, only favourites are candidates */
export const FAVOURITES_ONLY = 30;

export interface PassageCandidate {
  id: string;
  isFavourite: boolean;
}

const hashOf = (id: string) => createHash("sha256").update(id, "utf8").digest("hex");
const byHash = <T extends PassageCandidate>(quotes: T[]) =>
  quotes
    .map((q) => ({ q, h: hashOf(q.id) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.q);

/** The candidates in their fixed order */
export function passageCandidates<T extends PassageCandidate>(quotes: T[]): T[] {
  const favourites = byHash(quotes.filter((q) => q.isFavourite));
  if (favourites.length >= FAVOURITES_ONLY) return favourites;
  return [...favourites, ...byHash(quotes.filter((q) => !q.isFavourite))];
}

/** Whole days from 1970-01-01 to a "YYYY-MM-DD" reading day */
export function daysSinceEpoch(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * The passage of `day`; `offset` steps to the next candidates in the same
 * order ("Another", in the browser only). Null without quotes.
 */
export function choosePassage<T extends PassageCandidate>(quotes: T[], day: string, offset = 0): T | null {
  const candidates = passageCandidates(quotes);
  if (!candidates.length) return null;
  const n = candidates.length;
  return candidates[(((daysSinceEpoch(day) + offset) % n) + n) % n];
}
