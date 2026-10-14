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
    "href" | "projection" | "savedPercent" | "targetPercent" | "bookPercent"
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

/**
 * "Read", or "Continue · 34%" with the book's one percent (SLN-683): the
 * newest place on any device past the opening page, whole and rounded down,
 * so 99.6% is not 100%. The same number the cards and Continue reading show.
 */
export function catalogueReadLabel(
  descriptor: CatalogueContinue | null,
): string | null {
  if (!descriptor) return null;
  const percent = descriptor.bookPercent;
  if (percent !== null && percent !== undefined && Number.isFinite(percent) && percent >= 0 && percent <= 100)
    return `Continue · ${Math.floor(percent)}%`;
  // A place with no usable percent still continues; one on the opening page is only an open
  const place = descriptor.localAnchor ?? descriptor.anchor;
  return !place || opened(place) ? "Read" : "Continue";
}
