import { DetailFacts } from "@/components/shared/detail-facts";
import { Badge } from "@/components/ui/badge";
import { formatFileSize, formatPrice, formatDate } from "@/lib/utils/format";
import { InstanceEditDialog } from "./instance-edit-dialog";
import { InstanceDeleteButton } from "./instance-delete-button";
import { InstanceStatusButton } from "./instance-status-button";
import type { Instance, Location, SubLocation } from "@/lib/types/index";
import { enumLabel } from "@/lib/utils/labels";
import Link from "next/link";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { LinkEbookButton } from "@/components/ebooks/link-ebook-button";
import { UnlinkEbookButton } from "@/components/ebooks/unlink-ebook-button";

type InstanceWithLocation = Instance & {
  location: Location;
  subLocation: SubLocation | null;
};

interface LocationOption {
  id: string;
  name: string;
  type: string;
  subLocations: { id: string; name: string }[];
}

/** The e-book linked to a copy: it is that digital copy (SLN-490) */
export interface CopyEbook {
  id: string;
  /** ["EPUB", "PDF"]: the copy's format chips, one per format the e-book has (SLN-683) */
  formats: string[];
  sizeBytes: number;
  readerPath: string | null;
  readLabel: string | null;
  unavailableReason: string | null;
  returnTo: string;
  /** Its highlights, notes and bookmarks, and the devices with a reading place in it: the book page leads to both (SLN-683) */
  marks: { highlights: number; notes: number; bookmarks: number };
  places: number;
}

interface InstanceDetailProps {
  instance: InstanceWithLocation;
  availableLocations?: LocationOption[];
  ebook?: CopyEbook | null;
  workId?: string;
  workTitle?: string;
}

const DIGITAL_FORMATS = new Set(["ebook", "audiobook", "pdf", "epub"]);
/** "3 highlights", or nothing for none */
const count = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : null);

function isDigitalFormat(format: string | null): boolean {
  return !!format && DIGITAL_FORMATS.has(format.toLowerCase());
}

export function InstanceDetail({
  instance,
  availableLocations = [],
  ebook = null,
  workId,
  workTitle,
}: InstanceDetailProps) {
  const hasAcquisition =
    instance.acquisitionType ||
    instance.acquisitionDate ||
    instance.acquisitionSource ||
    instance.acquisitionPrice;

  const isDigital = isDigitalFormat(instance.format);

  const canLinkEbook = !!workId && !ebook && ["ebook", "pdf", "epub"].includes(instance.format ?? "") &&
    instance.location.type === "digital" && instance.location.isActive && instance.status !== "deaccessioned";
  const hasDigital = !!ebook || canLinkEbook || (isDigital && instance.fileSizeBytes != null);

  const isDeaccessioned = instance.status === "deaccessioned";
  const hasDisposition =
    isDeaccessioned &&
    (instance.dispositionType ||
      instance.dispositionDate ||
      instance.dispositionTo ||
      instance.dispositionPrice ||
      instance.dispositionNotes);

  const isLentOut = instance.status === "lent_out";

  const instanceLabel = [
    instance.location.name,
    instance.subLocation?.name,
    instance.format,
  ]
    .filter(Boolean)
    .join(" / ");

  const hasActions = availableLocations.length > 0;

  return (
    <div className="@container rounded-sm border border-glass-border bg-bg-primary px-4 py-3 text-xs [overflow-wrap:anywhere]">
      {/* Location row */}
      <div className="mb-2 flex flex-col items-start gap-3 @min-[440px]:flex-row @min-[440px]:justify-between">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-primary">
            {instance.location.name}
            {instance.subLocation && (
              <span className="text-fg-secondary">
                {" "}
                / {instance.subLocation.name}
              </span>
            )}
          </span>
          {/* A copy that is an e-book shows the e-book's formats, not the one the copy was entered with (SLN-683) */}
          {ebook?.formats.length
            ? ebook.formats.map((format) => <Badge key={format} variant="muted">{format}</Badge>)
            : instance.format && <Badge variant="muted">{enumLabel(instance.format)}</Badge>}
          {instance.condition && (
            <Badge variant="sage">{enumLabel(instance.condition)}</Badge>
          )}
          {hasActions ? (
            <InstanceStatusButton
              instanceId={instance.id}
              currentStatus={instance.status ?? "available"}
            />
          ) : (
            instance.status &&
            instance.status !== "available" && (
              <Badge
                variant={
                  instance.status === "lent_out"
                    ? "red"
                    : instance.status === "deaccessioned"
                      ? "red"
                      : instance.status === "missing" ||
                          instance.status === "damaged"
                        ? "red"
                        : "muted"
                }
              >
                {enumLabel(instance.status)}
              </Badge>
            )
          )}
        </div>

        {hasActions && (
          // The buttons' padding reaches past the text edges: Edit's ink starts on the
          // left edge when stacked, and Delete's ends on the right edge beside the place
          <div className="-ml-2.5 flex items-center gap-1 @min-[440px]:-mr-2.5 @min-[440px]:ml-0">
            <InstanceEditDialog
              instance={instance}
              editionId={instance.editionId}
              availableLocations={availableLocations}
              workId={workId}
              canLinkEbook={canLinkEbook}
            />
            <InstanceDeleteButton
              instanceId={instance.id}
              instanceLabel={instanceLabel}
              hasEbook={!!ebook}
            />
          </div>
        )}
      </div>

      {/* Collector badges row */}
      {(instance.hasDustJacket ||
        instance.hasSlipcase ||
        instance.isSigned ||
        instance.isFirstPrinting) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {instance.hasDustJacket && <Badge variant="muted">Dust Jacket</Badge>}
          {instance.hasSlipcase && <Badge variant="muted">Slipcase</Badge>}
          {instance.isSigned && <Badge variant="gold">Signed</Badge>}
          {instance.isFirstPrinting && (
            <Badge variant="gold">1st Printing</Badge>
          )}
        </div>
      )}

      {/* Signed by */}
      {instance.signedBy && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-secondary">Signed by:</span>{" "}
          {instance.signedBy}
        </p>
      )}

      {/* Inscription */}
      {instance.inscription && (
        <p className="mb-1 italic text-fg-secondary">
          <span className="not-italic text-fg-secondary">Inscription:</span>{" "}
          {instance.inscription}
        </p>
      )}

      {/* Provenance */}
      {instance.provenance && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-secondary">Provenance:</span>{" "}
          {instance.provenance}
        </p>
      )}

      {/* Condition notes */}
      {instance.conditionNotes && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-secondary">Condition notes:</span>{" "}
          {instance.conditionNotes}
        </p>
      )}

      {/* Instance notes */}
      {instance.notes && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-secondary">Notes:</span> {instance.notes}
        </p>
      )}

      {/* Acquisition details */}
      {hasAcquisition && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="type-caption mb-1.5">Acquisition</p>
          <DetailFacts>
            {instance.acquisitionType && (
              <>
                <dt className="text-fg-secondary">Type</dt>
                <dd className="text-fg-secondary">
                  {enumLabel(instance.acquisitionType)}
                </dd>
              </>
            )}
            {instance.acquisitionDate && (
              <>
                <dt className="text-fg-secondary">Date</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatDate(instance.acquisitionDate)}
                </dd>
              </>
            )}
            {instance.acquisitionSource && (
              <>
                <dt className="text-fg-secondary">Source</dt>
                <dd className="text-fg-secondary">
                  {instance.acquisitionSource}
                </dd>
              </>
            )}
            {instance.acquisitionPrice && (
              <>
                <dt className="text-fg-secondary">Price</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatPrice(
                    instance.acquisitionPrice,
                    instance.acquisitionCurrency,
                  )}
                </dd>
              </>
            )}
          </DetailFacts>
        </div>
      )}

      {/* Digital details */}
      {hasDigital && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="type-caption mb-1.5">Digital</p>
          <DetailFacts>
            {ebook && (
              <>
                <dt className="text-fg-secondary">eBook</dt>
                <dd className="text-fg-secondary">
                  <span className="font-mono">
                    {/* The size keeps its number and unit on one line; an e-book with no file has none */}
                    {[
                      ebook.formats.join(", "),
                      ebook.sizeBytes
                        ? formatFileSize(ebook.sizeBytes).replace(" ", "\u00a0")
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Link href={`/ebooks/${ebook.id}`} className="ml-3 text-command">eBook details</Link>
                  {ebook.readerPath && <ReaderEntryLink
                    readerPath={ebook.readerPath}
                    returnTo={ebook.returnTo}
                    className="ml-3 text-command"
                  >
                    {ebook.readLabel ?? "Read"}
                  </ReaderEntryLink>}
                  {ebook.unavailableReason && <p className="mt-1 text-xs text-fg-secondary">{ebook.unavailableReason}</p>}
                  <UnlinkEbookButton ebookId={ebook.id} />
                </dd>
              </>
            )}
            {ebook && ebook.marks.highlights + ebook.marks.bookmarks > 0 && (
              <>
                <dt className="text-fg-secondary">Highlights</dt>
                <dd>
                  <Link href={`/ebooks/highlights?ebook=${ebook.id}`} className="text-fg-primary transition-colors hover:text-accent-primary">
                    {[
                      count(ebook.marks.highlights, "highlight"),
                      count(ebook.marks.notes, "note"),
                      count(ebook.marks.bookmarks, "bookmark"),
                    ].filter(Boolean).join(" · ")}
                  </Link>
                </dd>
              </>
            )}
            {ebook && ebook.places > 0 && (
              <>
                <dt className="text-fg-secondary">Reading places</dt>
                <dd>
                  <Link href={`/ebooks/${ebook.id}#places`} className="text-fg-primary transition-colors hover:text-accent-primary">
                    {ebook.places === 1 ? "On 1 device" : `On ${ebook.places} devices`}
                  </Link>
                </dd>
              </>
            )}
            {canLinkEbook && workId && <><dt className="text-fg-secondary">eBook</dt><dd>
              <LinkEbookButton workId={workId} workTitle={workTitle ?? "this book"}
                editionId={instance.editionId} instanceId={instance.id} /></dd></>}
            {instance.fileSizeBytes != null && (
              <>
                <dt className="text-fg-secondary">File Size</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatFileSize(instance.fileSizeBytes)}
                </dd>
              </>
            )}
          </DetailFacts>
        </div>
      )}

      {/* Lending status */}
      {isLentOut && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="type-caption mb-1.5">On Loan</p>
          {instance.lentTo && (
            <p className="text-fg-secondary">
              <span className="text-fg-secondary">Lent to:</span>{" "}
              {instance.lentTo}
            </p>
          )}
          {instance.lentDate && (
            <p className="font-mono text-fg-secondary">
              <span className="font-sans text-fg-secondary">Since:</span>{" "}
              {formatDate(instance.lentDate)}
            </p>
          )}
        </div>
      )}

      {/* Disposition details */}
      {hasDisposition && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="type-caption mb-1.5">Disposition</p>
          <DetailFacts>
            {instance.dispositionType && (
              <>
                <dt className="text-fg-secondary">Type</dt>
                <dd className="text-fg-secondary">
                  {enumLabel(instance.dispositionType)}
                </dd>
              </>
            )}
            {instance.dispositionDate && (
              <>
                <dt className="text-fg-secondary">Date</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatDate(instance.dispositionDate)}
                </dd>
              </>
            )}
            {instance.dispositionTo && (
              <>
                <dt className="text-fg-secondary">To</dt>
                <dd className="text-fg-secondary">{instance.dispositionTo}</dd>
              </>
            )}
            {instance.dispositionPrice && (
              <>
                <dt className="text-fg-secondary">Price</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatPrice(
                    instance.dispositionPrice,
                    instance.dispositionCurrency,
                  )}
                </dd>
              </>
            )}
            {instance.dispositionNotes && (
              <>
                <dt className="text-fg-secondary">Notes</dt>
                <dd className="col-span-1 text-fg-secondary">
                  {instance.dispositionNotes}
                </dd>
              </>
            )}
          </DetailFacts>
        </div>
      )}
    </div>
  );
}
