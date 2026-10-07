import type { ByteSource } from "../source";
import { openZip } from "../zip";
import { firstDescendant, parseXml, textOf } from "./xml";
import { emptyInspection, type Inspection } from "./types";

/*
 * Comic book zips (SLN-494): the images in natural order (page 2 before page
 * 10), the first as the cover, and ComicInfo.xml when present. A comic has
 * no text to count.
 */

const IMAGE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A comic's pages, in reading order */
export function comicPages(names: readonly string[]): string[] {
  return names.filter((n) => IMAGE.test(n) && !n.startsWith("__MACOSX/") && !/(^|\/)\./.test(n)).sort(natural.compare);
}

export async function inspectCbz(source: ByteSource): Promise<Inspection> {
  let zip;
  try {
    zip = await openZip(source);
  } catch (error) {
    return emptyInspection("cbz", { problem: (error as Error).message });
  }
  const pages = comicPages(zip.names);
  if (pages.length === 0) return emptyInspection("cbz", { problem: "Damaged CBZ: no images" });

  const infoName = zip.names.find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
  const info = infoName ? parseXml(await zip.text(infoName).catch(() => "")) : null;
  const field = (local: string) => (info ? textOf(firstDescendant(info, local)) || null : null);
  const number = field("number");
  const year = field("year");
  const writers = (field("writer") ?? "").split(/\s*,\s*/).filter(Boolean);
  const gtin = field("gtin");

  return emptyInspection("cbz", {
    metadata: {
      title: field("title"),
      series: field("series"),
      seriesIndex: number && Number.isFinite(Number(number)) ? Number(number) : null,
      authors: writers.map((name) => ({ name, role: "aut" })),
      date: year ? [year, field("month"), field("day")].filter(Boolean).map((p, i) => (i ? p!.padStart(2, "0") : p)).join("-") : null,
      language: field("languageiso"),
      publisher: field("publisher"),
      description: field("summary"),
      identifiers: gtin ? [{ scheme: "isbn", value: gtin }] : [],
    },
    cover: { kind: "bytes", load: () => zip.bytes(pages[0]) },
    manifest: zip.directory ? { zip: { ...zip.directory, opfPath: null } } : {},
    text: { kind: "none", reason: "Comic book: no text to count" },
    details: { pages: pages.length, comicInfo: !!info },
  });
}
