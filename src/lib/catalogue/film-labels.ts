import { FILM_RELEASE_FORMAT_LABELS } from "./films";
import { HOLDING_STATUS_LABELS, type HoldingStatus } from "./holdings";
import type { FILM_HOLDING_MEDIA, FILM_RELEASE_FORMATS } from "./films";
import type { Attribution } from "./credits";

export type FilmReleaseFormat = (typeof FILM_RELEASE_FORMATS)[number];
export type FilmMedium = (typeof FILM_HOLDING_MEDIA)[number];
// Shared by every collection; kept here for the film screens' imports
export { FILM_RELEASE_FORMAT_LABELS, HOLDING_STATUS_LABELS };
export type { HoldingStatus };

export const FILM_MEDIUM_LABELS: Record<FilmMedium, string> = {
  physical: "Physical",
  digital: "Digital",
};

/**
 * The film credit roles in the order a film's credits read: who directed and
 * wrote it, who plays in it, then the crew. Each has the heading of one
 * person and of several.
 */
export const FILM_CREDIT_ROLES = {
  "film.director": { one: "Director", many: "Directors" },
  "film.screenwriter": { one: "Screenwriter", many: "Screenwriters" },
  "film.story": { one: "Story", many: "Story" },
  "film.cast": { one: "Cast", many: "Cast" },
  "film.producer": { one: "Producer", many: "Producers" },
  "film.cinematographer": { one: "Cinematographer", many: "Cinematographers" },
  "film.editor": { one: "Editor", many: "Editors" },
  "film.composer": { one: "Composer", many: "Composers" },
  "film.production_designer": {
    one: "Production designer",
    many: "Production designers",
  },
  "film.costume_designer": {
    one: "Costume designer",
    many: "Costume designers",
  },
} as const;
export type FilmCreditRole = keyof typeof FILM_CREDIT_ROLES;
export const FILM_CREDIT_ROLE_IDS = Object.keys(FILM_CREDIT_ROLES) as FilmCreditRole[];

/** A role's heading for this many people: "Director", "Directors" */
export function creditHeading(roleId: string, count: number) {
  const role = FILM_CREDIT_ROLES[roleId as FilmCreditRole];
  if (!role) return roleId;
  return count === 1 ? role.one : role.many;
}

/** What a credit shows: the person, the name it was credited as, or why none */
export function filmCreditName(credit: {
  person?: { name: string } | null;
  name?: string | null;
  creditedAs: string | null;
  attribution: string;
}) {
  return (
    credit.person?.name ??
    credit.name ??
    credit.creditedAs ??
    (credit.attribution === "anonymous" ? "Anonymous" : "Unknown")
  );
}

/** "2h 11m", "58m", "1h", "1h 49m 30s": a runtime in seconds; null when unknown */
export function formatRuntime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h ? `${h}h` : null, m ? `${m}m` : null, s ? `${s}s` : null]
    .filter(Boolean)
    .join(" ");
}

/** A stored runtime as the text of its field: minutes, or h:mm:ss when it has seconds */
export function runtimeText(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "";
  if (seconds % 60 === 0) return String(seconds / 60);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * A runtime as typed, in seconds: "131" (minutes), "131m", "2h 11m", "2h",
 * "2:11" (hours and minutes) or "1:49:30". Null when the field is empty, NaN
 * when it cannot be read.
 */
export function parseRuntime(text: string) {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  let match = /^(\d+)\s*(?:m|min|mins|minutes)?$/.exec(value);
  if (match) return Number(match[1]) * 60;
  match = /^(\d+)\s*h(?:\s*(\d+)\s*(?:m|min|mins|minutes)?)?$/.exec(value);
  if (match) return Number(match[1]) * 3600 + Number(match[2] ?? 0) * 60;
  match = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(value);
  if (match)
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  return Number.NaN;
}

/** "2 physical copies, 1 digital copy": what is held; null when nothing */
export function filmHoldingsText({
  physical,
  digital,
}: {
  physical: number;
  digital: number;
}) {
  const copies = (n: number) => (n === 1 ? "copy" : "copies");
  const parts = [
    physical ? `${physical} physical ${copies(physical)}` : null,
    digital ? `${digital} digital ${copies(digital)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Where a release was: its country, its own territory, or worldwide */
export function releaseTerritory(release: {
  countryName: string | null;
  territoryLabel: string | null;
}) {
  return release.countryName ?? release.territoryLabel ?? "Worldwide";
}

/** A version as people name it: its label, or "Unnamed version" */
export function versionName(version: { label: string | null }) {
  return version.label ?? "Unnamed version";
}

// ── The credits editor ──────────────────────────────────────────────────────

export interface FilmCreditEntry {
  /** A key for the list while it is edited */
  key: string;
  /** The stored credit, kept across edits */
  id?: string;
  personId: string | null;
  name: string | null;
  roleId: FilmCreditRole;
  creditedAs: string;
  /** "Blair / Blair-Thing": one performer may play several characters */
  characters: string;
  attribution: Attribution;
  notes: string | null;
}

/** "Blair / Blair-Thing" as the list of characters it names */
export function readCharacters(text: string) {
  return text
    .split("/")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The credits the server stores, in the editor's order */
export function creditInput(entries: FilmCreditEntry[]) {
  return entries.map((c) => ({
    ...(c.id ? { id: c.id } : {}),
    personId: c.personId,
    roleId: c.roleId,
    creditedAs: c.creditedAs.trim() || null,
    // A credit with neither a person nor a name records an unknown one
    attribution:
      !c.personId && !c.creditedAs.trim() && c.attribution !== "anonymous"
        ? ("unknown" as const)
        : c.attribution,
    characters: c.roleId === "film.cast" ? readCharacters(c.characters) : [],
    notes: c.notes,
  }));
}
