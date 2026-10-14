import { formatLabel, formatRank, type EbookFormat } from "./formats";
import type { CatalogueContinue, EbookAvailability } from "./read-target";
import type { ContinueAnchor, ContinueDescriptor } from "./continue-target";
import type { DurtalLocator } from "@/lib/reader/engine";

/** Preserve the full anchor contract while excluding unexpected persisted fields. */
function locatorDTO(locator: DurtalLocator): DurtalLocator {
  return {
    v: locator.v,
    fileHash: locator.fileHash,
    href: locator.href,
    sectionIndex: locator.sectionIndex,
    progression: locator.progression,
    totalProgression: locator.totalProgression,
    position: locator.position,
    cfi: locator.cfi,
    tocLabel: locator.tocLabel,
    pageLabel: locator.pageLabel,
    pdf: locator.pdf
      ? {
          page: locator.pdf.page,
          rects: locator.pdf.rects?.map((rect) => [...rect]),
        }
      : undefined,
    text: locator.text
      ? {
          before: locator.text.before,
          highlight: locator.text.highlight,
          after: locator.text.after,
        }
      : undefined,
  };
}

function anchorDTO(anchor: ContinueAnchor | null): ContinueAnchor | null {
  return anchor
    ? {
        deviceId: anchor.deviceId,
        deviceLabel: anchor.deviceLabel,
        fileId: anchor.fileId,
        locator: locatorDTO(anchor.locator),
        chapter: anchor.chapter,
        clientUpdatedAt: anchor.clientUpdatedAt,
      }
    : null;
}

/** Owner UI projection; REST metadata uses workEbookDTO and receives no anchors. */
export function catalogueContinueDTO(
  descriptor: ContinueDescriptor | null,
): CatalogueContinue | null {
  if (!descriptor) return null;
  return {
    target: {
      id: descriptor.target.id,
      ebookId: descriptor.target.ebookId,
      sha256: descriptor.target.sha256,
    },
    href: descriptor.href,
    projection: descriptor.projection,
    savedPercent: descriptor.savedPercent,
    targetPercent: descriptor.targetPercent,
    bookPercent: descriptor.bookPercent,
    anchor: anchorDTO(descriptor.anchor),
    localAnchor: anchorDTO(descriptor.localAnchor),
    newestOtherAnchor: anchorDTO(descriptor.newestOtherAnchor),
  };
}

export interface WorkEbookDTO {
  readonly id: string;
  readonly title: string;
  readonly formats: readonly EbookFormat[];
  readonly readable: boolean;
  readonly readerPath: string | null;
}

/** Explicit allowlist: never spread a catalogue row or Continue's anchor/file. */
export function workEbookDTO(ebook: EbookAvailability): WorkEbookDTO {
  return {
    id: ebook.ebookId,
    title: ebook.title,
    formats: ebook.continue
      ? [...new Set(ebook.formats)].sort(
          (a, b) => formatRank(a) - formatRank(b),
        )
      : [],
    readable: ebook.continue !== null,
    readerPath: ebook.continue?.href ?? null,
  };
}

/** Shared column value for CSV, JSON and the existing book export formats. */
export function ebookExportFormats(ebooks: readonly WorkEbookDTO[]): string {
  const formats = new Set(
    ebooks.filter((ebook) => ebook.readable).flatMap((ebook) => ebook.formats),
  );
  return [...formats]
    .sort((a, b) => formatRank(a) - formatRank(b))
    .map(formatLabel)
    .join("; ");
}
