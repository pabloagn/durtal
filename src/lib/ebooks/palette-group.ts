import type { WorkKind } from "@/lib/catalogue/kinds";
import type { WorkEbookDTO } from "./catalogue-dto";

export interface PaletteBookRead {
  readonly id: string;
  readonly kind: WorkKind;
  readonly ebook: WorkEbookDTO | null;
}

export interface PaletteUnlinkedEbook {
  readonly ebook: WorkEbookDTO;
  readonly matchState: "pending" | "linked" | "standalone" | "excluded";
}

export interface PaletteEbookItem {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly readerPath: string | null;
}

/** Pure grouping of query results: no matching, eligibility checks or extra fetches. */
export function ebookPaletteGroup(input: {
  readonly works: readonly PaletteBookRead[];
  readonly ebooks: readonly PaletteUnlinkedEbook[];
  readonly recent: WorkEbookDTO | null;
  readonly emptyQuery: boolean;
}): {
  bookReaderPaths: ReadonlyMap<string, string>;
  ebooks: readonly PaletteEbookItem[];
  continueReading: PaletteEbookItem | null;
} {
  const bookReaderPaths = new Map<string, string>();
  for (const work of input.works) {
    if (work.kind === "book" && work.ebook?.readable && work.ebook.readerPath)
      bookReaderPaths.set(work.id, work.ebook.readerPath);
  }
  const seen = new Set<string>();
  const ebooks: PaletteEbookItem[] = [];
  for (const row of input.ebooks) {
    if (row.matchState !== "pending" && row.matchState !== "standalone")
      continue;
    const ebook = row.ebook;
    if (seen.has(ebook.id)) continue;
    seen.add(ebook.id);
    ebooks.push({
      id: ebook.id,
      title: ebook.title,
      href: `/ebooks/${ebook.id}`,
      readerPath: ebook.readable ? ebook.readerPath : null,
    });
    if (ebooks.length === 5) break;
  }
  const recent = input.recent;
  const continueReading =
    input.emptyQuery && recent?.readable && recent.readerPath
      ? {
          id: recent.id,
          title: `Continue reading ${recent.title}`,
          href: recent.readerPath,
          readerPath: recent.readerPath,
        }
      : null;
  return { bookReaderPaths, ebooks, continueReading };
}
