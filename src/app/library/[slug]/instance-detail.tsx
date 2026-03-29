import { Badge } from "@/components/ui/badge";
import { formatFileSize, formatPrice, formatDate } from "@/lib/utils/format";
import { InstanceEditDialog } from "./instance-edit-dialog";
import { InstanceDeleteButton } from "./instance-delete-button";
import { InstanceStatusButton } from "./instance-status-button";
import type { Instance, Location, SubLocation } from "@/lib/types/index";

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

interface InstanceDetailProps {
  instance: InstanceWithLocation;
  availableLocations?: LocationOption[];
}

const DIGITAL_FORMATS = new Set(["ebook", "audiobook", "pdf", "epub"]);

function isDigitalFormat(format: string | null): boolean {
  return !!format && DIGITAL_FORMATS.has(format.toLowerCase());
}

export function InstanceDetail({
  instance,
  availableLocations = [],
}: InstanceDetailProps) {
  const hasAcquisition =
    instance.acquisitionType ||
    instance.acquisitionDate ||
    instance.acquisitionSource ||
    instance.acquisitionPrice;

  const isDigital = isDigitalFormat(instance.format);

  const hasDigital =
    isDigital &&
    (instance.calibreId ||
      instance.calibreUrl ||
      instance.fileSizeBytes != null);

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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-primary">
            {instance.location.name}
            {instance.subLocation && (
              <span className="text-fg-muted">
                {" "}/ {instance.subLocation.name}
              </span>
            )}
          </span>
          {instance.format && (
            <Badge variant="muted">{instance.format}</Badge>
          )}
          {instance.condition && (
            <Badge variant="sage">{instance.condition}</Badge>
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
                {instance.status}
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
          <span className="text-fg-muted">Signed by:</span> {instance.signedBy}
        </p>
      )}

      {/* Inscription */}
      {instance.inscription && (
        <p className="mb-1 italic text-fg-secondary">
          <span className="not-italic text-fg-muted">Inscription:</span>{" "}
          {instance.inscription}
        </p>
      )}

      {/* Provenance */}
      {instance.provenance && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-muted">Provenance:</span>{" "}
          {instance.provenance}
        </p>
      )}

      {/* Condition notes */}
      {instance.conditionNotes && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-muted">Condition notes:</span>{" "}
          {instance.conditionNotes}
        </p>
      )}

      {/* Instance notes */}
      {instance.notes && (
        <p className="mb-1 text-fg-secondary">
          <span className="text-fg-muted">Notes:</span> {instance.notes}
        </p>
      )}

      {/* Acquisition details */}
      {hasAcquisition && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="mb-1.5 text-xs uppercase tracking-wide text-fg-muted">
            Acquisition
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {instance.acquisitionType && (
              <>
                <dt className="text-fg-muted">Type</dt>
                <dd className="text-fg-secondary">{instance.acquisitionType}</dd>
              </>
            )}
            {instance.acquisitionDate && (
              <>
                <dt className="text-fg-muted">Date</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatDate(instance.acquisitionDate)}
                </dd>
              </>
            )}
            {instance.acquisitionSource && (
              <>
                <dt className="text-fg-muted">Source</dt>
                <dd className="text-fg-secondary">{instance.acquisitionSource}</dd>
              </>
            )}
            {instance.acquisitionPrice && (
              <>
                <dt className="text-fg-muted">Price</dt>
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
          <p className="mb-1.5 text-xs uppercase tracking-wide text-fg-muted">
            Digital
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {instance.calibreId && (
              <>
                <dt className="text-fg-muted">Calibre ID</dt>
                <dd className="font-mono text-fg-secondary">
                  {instance.calibreId}
                </dd>
              </>
            )}
            {instance.calibreUrl && (
              <>
                <dt className="text-fg-muted">Calibre</dt>
                <dd>
                  <a
                    href={instance.calibreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-fg-secondary transition-colors hover:text-accent-rose"
                  >
                    {instance.calibreUrl}
                  </a>
                </dd>
              </>
            )}
            {instance.fileSizeBytes != null && (
              <>
                <dt className="text-fg-muted">File Size</dt>
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
          <p className="mb-1.5 text-xs uppercase tracking-wide text-fg-muted">
            On Loan
          </p>
          {instance.lentTo && (
            <p className="text-fg-secondary">
              <span className="text-fg-muted">Lent to:</span> {instance.lentTo}
            </p>
          )}
          {instance.lentDate && (
            <p className="font-mono text-fg-secondary">
              <span className="font-sans text-fg-muted">Since:</span>{" "}
              {formatDate(instance.lentDate)}
            </p>
          )}
        </div>
      )}

      {/* Disposition details */}
      {hasDisposition && (
        <div className="mt-3 border-t border-glass-border pt-2">
          <p className="mb-1.5 text-xs uppercase tracking-wide text-fg-muted">
            Disposition
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
            {instance.dispositionType && (
              <>
                <dt className="text-fg-muted">Type</dt>
                <dd className="text-fg-secondary">{instance.dispositionType}</dd>
              </>
            )}
            {instance.dispositionDate && (
              <>
                <dt className="text-fg-muted">Date</dt>
                <dd className="font-mono text-fg-secondary">
                  {formatDate(instance.dispositionDate)}
                </dd>
              </>
            )}
            {instance.dispositionTo && (
              <>
                <dt className="text-fg-muted">To</dt>
                <dd className="text-fg-secondary">{instance.dispositionTo}</dd>
              </>
            )}
            {instance.dispositionPrice && (
              <>
                <dt className="text-fg-muted">Price</dt>
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
                <dt className="text-fg-muted">Notes</dt>
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
