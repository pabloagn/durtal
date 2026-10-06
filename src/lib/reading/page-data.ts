import { copyWhereabouts, homeOptions, isAtHand, type CopyPlace } from "./at-hand";
import { editionLabels, labelEditionOf } from "./edition-label";
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
  /** For pickers: "English · Penguin Classics, 2003, tr. Edith Grossman · 480 p." */
  label: string;
  /** Its short name among the book's editions (SLN-480): "Penguin Classics, 2003, tr. Edith Grossman" */
  short: string;
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
  binding?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  coverS3Key: string | null;
  thumbnailS3Key: string | null;
  publisherLinks?: { publisher: { name: string } | null }[];
  contributors?: { role: string; sortOrder?: number; author: { name: string } | null }[];
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
  epub: "eBook",
  pdf: "PDF",
  ebook: "eBook",
  audiobook: "Audiobook",
};

/** "Paperback", "eBook"; an unknown format as it is stored */
export function formatWord(format: string | null) {
  if (!format) return "Copy";
  return FORMAT_WORDS[format] ?? format.charAt(0).toUpperCase() + format.slice(1).replace(/_/g, " ");
}

/**
 * The book's editions for the reading dialogs, owned ones first, at-hand
 * copies first. Each is named as editionLabels names it, so every edition
 * picker in the tracker names the translator; the picker's label keeps the
 * language first and the page count last.
 */
export function readingEditions(
  editions: EditionRow[],
  { today, homeId, workTitle }: { today: string; homeId: string | null; workTitle: string },
): EditionOption[] {
  const shorts = editionLabels(
    editions.map((e) => labelEditionOf({ ...e, title: e.title ?? "" })),
    workTitle,
    { language: false },
  );
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
    const short = shorts.get(e.id)!;
    const label = [languageName(e.language) ?? e.language, short, e.pageCount ? `${e.pageCount} p.` : null].filter(Boolean).join(" · ");
    return {
      id: e.id,
      title: e.title ?? "",
      label,
      short,
      pageCount: e.pageCount,
      language: e.language,
      translators: (e.contributors ?? [])
        .filter((c) => c.role === "translator" && c.author)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((c) => c.author!.name),
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
