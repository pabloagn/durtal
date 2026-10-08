import { Badge } from "@/components/ui/badge";
import { formatFileSize, formatPrice, formatDate } from "@/lib/utils/format";
import { InstanceEditDialog } from "./instance-edit-dialog";
import { InstanceDeleteButton } from "./instance-delete-button";
import { InstanceStatusButton } from "./instance-status-button";
import type { Instance, Location, SubLocation } from "@/lib/types/index";
import { enumLabel } from "@/lib/utils/labels";

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
  /** "EPUB, PDF" */
  formats: string;
  sizeBytes: number;
}

interface InstanceDetailProps {
  instance: InstanceWithLocation;
  availableLocations?: LocationOption[];
  ebook?: CopyEbook | null;
}

const DIGITAL_FORMATS = new Set(["ebook", "audiobook", "pdf", "epub"]);

function isDigitalFormat(format: string | null): boolean {
  return !!format && DIGITAL_FORMATS.has(format.toLowerCase());
}

export function InstanceDetail({
  instance,
  availableLocations = [],
  ebook = null,
}: InstanceDetailProps) {
  const hasAcquisition =
    instance.acquisitionType ||
    instance.acquisitionDate ||
    instance.acquisitionSource ||
    instance.acquisitionPrice;

  const isDigital = isDigitalFormat(instance.format);

  const hasDigital = !!ebook || (isDigital && instance.fileSizeBytes != null);

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
    <div className="rounded-sm border border-glass-border bg-bg-primary px-4 py-3 text-xs">
      {/* Location row */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 pointer-coarse:gap-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-primary">
            {instance.location.name}
            {instance.subLocation && (
              <span className="text-fg-secondary">
                {" "}/ {instance.subLocation.name}
              </span>
            )}
          </span>
          {instance.format && (
            <Badge variant="muted">{enumLabel(instance.format)}</Badge>
          )}
          {instance.condition && (
            <Badge variant="sage">{enumLabel(instance.condition)}</Badge>
          )}
          {hasActions ? (
            <InstanceStatusButton
              instanceId={instance.id}
              currentStatus={instance.status ?? "available"}
            />
          ) : (
            instance.status && instance.status !== "available" && (
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
          <div className="flex items-center gap-1">
            <InstanceEditDialog
              instance={instance}
              editionId={instance.editionId}
              availableLocations={availableLocations}
            />
            <InstanceDeleteButton
              instanceId={instance.id}
              instanceLabel={instanceLabel}
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
          {instance.hasDustJacket && (
            <Badge variant="muted">Dust Jacket</Badge>
          )}
          {instance.hasSlipcase && (
            <Badge variant="muted">Slipcase</Badge>
          )}
          {instance.isSigned && (
            <Badge variant="gold">Signed</Badge>
          )}
          {instance.isFirstPrinting && (
            <Badge variant="gold">1st Printing</Badge>
          )}
        </div>
      )}

      {/* Signed by */}
      {instance.signedBy && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-secondary">Signed by:</span> {instance.signedBy}
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
          <p className="type-caption mb-1.5">
            Acquisition
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {instance.acquisitionType && (
              <>
                <dt className="text-fg-secondary">Type</dt>
                <dd className="text-fg-secondary">{enumLabel(instance.acquisitionType)}</dd>
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
                <dd className="text-fg-secondary">{instance.acquisitionSource}</dd>
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
          </dl>
        </div>
      )}

      {/* Digital details */}
      {hasDigital && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="type-caption mb-1.5">
            Digital
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {ebook && (
              <>
                <dt className="text-fg-secondary">eBook</dt>
                <dd className="text-fg-secondary">
                  <span className="font-mono">
                    {/* The size keeps its number and unit on one line; an e-book with no file has none */}
                    {[ebook.formats, ebook.sizeBytes ? formatFileSize(ebook.sizeBytes).replace(" ", "\u00a0") : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {/* A full page load: the reader's page brings its own content policy (eBooks sub-issue 3) */}
                  <a
                    href={`/reader/${ebook.id}`}
                    className="ml-3 text-fg-primary transition-colors hover:text-accent-primary"
                  >
                    Open
                  </a>
                </dd>
              </>
            )}
            {instance.fileSizeBytes != null && (
              <>
                <dt className="text-fg-secondary">File Size</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatFileSize(instance.fileSizeBytes)}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Lending status */}
      {isLentOut && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="type-caption mb-1.5">
            On Loan
          </p>
          {instance.lentTo && (
            <p className="text-fg-secondary">
              <span className="text-fg-secondary">Lent to:</span> {instance.lentTo}
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
          <p className="type-caption mb-1.5">
            Disposition
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {instance.dispositionType && (
              <>
                <dt className="text-fg-secondary">Type</dt>
                <dd className="text-fg-secondary">{enumLabel(instance.dispositionType)}</dd>
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
          </dl>
        </div>
      )}
    </div>
  );
}
