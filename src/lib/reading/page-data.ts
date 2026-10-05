import { copyWhereabouts, homeOptions, isAtHand, type CopyPlace } from "./at-hand";
import { languageName } from "@/lib/utils/language";

/*
 * What the book page hands its reading control, section and dialogs
 * (SLN-447): the book's editions with their copies and where each is, and
 * the homes. Built on the server, so dates and places are written once.
 */

export interface CopyOption extends CopyPlace {
  id: string;
  format: string | null;
  /** "Paperback · On your shelf in Amsterdam, Study, shelf 3" */
  line: string;
}

export interface EditionOption {
  id: string;
  title: string;
  /** "English · Penguin, 2003 · 480 p." */
  label: string;
  pageCount: number | null;
  language: string | null;
  translators: string[];
  cover: string | null;
  /** A copy in the collection (not deaccessioned) */
  owned: boolean;
  copies: CopyOption[];
}

export interface HomeOption {
  id: string;
  name: string;
}

interface EditionRow {
  id: string;
  title: string | null;
  language: string | null;
  pageCount: number | null;
  publicationYear: number | null;
  publisher?: string | null;
  coverS3Key: string | null;
  thumbnailS3Key: string | null;
  publisherLinks?: { publisher: { name: string } | null }[];
  contributors?: { role: string; author: { name: string } | null }[];
  instances: {
    id: string;
    status: string;
    format: string | null;
    locationId: string;
    lentTo: string | null;
    lentDate: string | null;
    location: { name: string; type: string } | null;
    subLocation: { name: string } | null;
  }[];
}

const FORMAT_WORDS: Record<string, string> = {
  hardcover: "Hardback",
  paperback: "Paperback",
  epub: "E-book",
  pdf: "PDF",
  ebook: "E-book",
  audiobook: "Audiobook",
};

/** "Paperback", "E-book"; an unknown format as it is stored */
export function formatWord(format: string | null) {
  if (!format) return "Copy";
  return FORMAT_WORDS[format] ?? format.charAt(0).toUpperCase() + format.slice(1).replace(/_/g, " ");
}

/** The book's editions for the reading dialogs, owned ones first, at-hand copies first */
export function readingEditions(editions: EditionRow[], { today, homeId }: { today: string; homeId: string | null }): EditionOption[] {
  const options = editions.map((e) => {
    const copies = e.instances
      .filter((i) => i.status !== "deaccessioned")
      .map((i): CopyOption => {
        const place: CopyPlace = {
          status: i.status,
          locationId: i.locationId,
          locationType: i.location?.type ?? null,
          locationName: i.location?.name ?? null,
          subLocationName: i.subLocation?.name ?? null,
          lentTo: i.lentTo,
          lentDate: i.lentDate,
        };
        return { ...place, id: i.id, format: i.format, line: `${formatWord(i.format)} · ${copyWhereabouts(place, { today })}` };
      })
      .sort((a, b) => Number(isAtHand(b, homeId)) - Number(isAtHand(a, homeId)));
    const publisher = e.publisherLinks?.find((l) => l.publisher)?.publisher?.name ?? e.publisher ?? null;
    const label = [
      languageName(e.language) ?? e.language,
      [publisher, e.publicationYear].filter(Boolean).join(", ") || null,
      e.pageCount ? `${e.pageCount} p.` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: e.id,
      title: e.title ?? "",
      label: label || e.title || "Edition",
      pageCount: e.pageCount,
      language: e.language,
      translators: (e.contributors ?? []).filter((c) => c.role === "translator" && c.author).map((c) => c.author!.name),
      cover: e.thumbnailS3Key ?? e.coverS3Key,
      owned: copies.length > 0,
      copies,
    };
  });
  return options.sort((a, b) => Number(b.owned) - Number(a.owned));
}

/** The "I'm at" homes */
export function readingHomes(locations: { id: string; name: string; type: string; isActive: boolean }[]): HomeOption[] {
  return homeOptions(locations).map(({ id, name }) => ({ id, name }));
}
