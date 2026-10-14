import { formatRank, type EbookFormat } from "./formats";
import {
  opened,
  type ContinueAnchor,
  type ContinueDescriptor,
  type ContinueFile,
} from "./continue-target";

/**
 * Read-only public fields of SLN-497's actual ContinueDescriptor. The availability
 * query projects an already eligible descriptor into this shape; this module
 * neither selects files nor decides their native/download eligibility.
 */
export type CatalogueContinue = Readonly<
  Pick<
    ContinueDescriptor,
    "href" | "projection" | "savedPercent" | "targetPercent"
  >
> & {
  readonly target: Readonly<Pick<ContinueFile, "id" | "ebookId" | "sha256">>;
  readonly anchor: Readonly<ContinueAnchor> | null;
  readonly localAnchor: Readonly<ContinueAnchor> | null;
  readonly newestOtherAnchor: Readonly<ContinueAnchor> | null;
};

export interface EbookAvailability {
  readonly ebookId: string;
  readonly title: string;
  readonly editionId: string;
  readonly editionLanguage: string | null;
  readonly editionYear: number | null;
  /** Only native-readable formats, supplied by the shared availability query. */
  readonly formats: readonly EbookFormat[];
  readonly continue: CatalogueContinue | null;
}

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function localTime(ebook: EbookAvailability): number | null {
  const clock = ebook.continue?.localAnchor?.clientUpdatedAt;
  if (!clock) return null;
  const time = clock instanceof Date ? clock.getTime() : Date.parse(clock);
  return Number.isFinite(time) ? time : null;
}

function bestFormat(formats: readonly EbookFormat[]): number {
  return Math.min(...formats.map(formatRank), Number.POSITIVE_INFINITY);
}

/** Work-level choice only: the supplied Continue descriptor owns the file and anchor. */
export function readTarget(
  availability: readonly EbookAvailability[],
  originalLanguage: string | null,
): EbookAvailability | null {
  const language = originalLanguage?.toLowerCase();
  const candidates = availability.filter((ebook) => ebook.continue !== null);
  candidates.sort((a, b) => {
    const aTime = localTime(a);
    const bTime = localTime(b);
    if (aTime !== null && bTime !== null && aTime !== bTime)
      return bTime - aTime;
    if ((aTime === null) !== (bTime === null)) return aTime === null ? 1 : -1;
    const aLanguage =
      !!language && a.editionLanguage?.toLowerCase() === language;
    const bLanguage =
      !!language && b.editionLanguage?.toLowerCase() === language;
    return (
      Number(bLanguage) - Number(aLanguage) ||
      bestFormat(a.formats) - bestFormat(b.formats) ||
      compareIds(a.editionId, b.editionId) ||
      compareIds(a.ebookId, b.ebookId)
    );
  });
  return candidates[0] ?? null;
}

/** A historical percent is never presented as the landing in a different file. */
export function catalogueReadLabel(
  descriptor: CatalogueContinue | null,
): string | null {
  if (!descriptor) return null;
  // Any device's place counts: with none here, the reader opens at the newest
  // one (SLN-683). A book only opened, on its first page, is not started.
  const place = descriptor.localAnchor ?? descriptor.anchor;
  if (!place || opened(place)) return "Read";
  const percent = descriptor.targetPercent;
  return descriptor.projection === "same-file" &&
    percent !== null &&
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= 100
    ? `Continue · ${Math.round(percent)}%`
    : "Continue";
}
