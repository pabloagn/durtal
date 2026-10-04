import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import { paintingHref } from "@/components/paintings/painting-card";
import { perfumeHref } from "@/components/perfumes/perfume-card";
import { filmHref } from "@/components/films/film-card";
import { FILM_MEDIUM_LABELS } from "@/lib/catalogue/film-labels";
import { HOLDING_STATUS_LABELS, type HoldingStatus } from "@/lib/catalogue/holdings";
import {
  ART_OBJECT_KIND_LABELS,
  CERTAINTY_LABELS,
  CUSTODY_LABELS,
  DISPLAY_LABELS,
  PLACE_LABELS,
} from "@/lib/catalogue/painting-labels";
import {
  CONTAINER_LABELS,
  formatPrice,
  formatVolume,
  formulationName,
} from "@/lib/catalogue/perfume-labels";
import { AVAILABILITY_LABELS } from "@/lib/catalogue/retailers";
import type { VenueArt, VenuePurchases, VenueRetail } from "@/lib/actions/venue-pages";
import type { getVenueOrders } from "@/lib/actions/venue-pages";

type ArtRow = VenueArt["here"]["rows"][number];

const LINK = "text-fg-primary transition-colors hover:text-accent-rose-text";
const ROW = "rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5";

/** "Shown 100 of 140": a part that lists fewer rows than it counts */
function More({ shown, total }: { shown: number; total: number }) {
  return shown < total ? (
    <p className="mt-2 text-xs text-fg-secondary">
      Showing {shown} of {total}
    </p>
  ) : null;
}

/** "Original", "Version: Second version" */
function objectName(row: ArtRow) {
  return [ART_OBJECT_KIND_LABELS[row.objectKind], row.objectLabel].filter(Boolean).join(": ");
}

/** Who owns the object, as recorded: an institution, a private owner, or not known */
function ownerText(row: ArtRow) {
  if (row.ownerName) return row.ownerName;
  if (row.ownership === "private") return row.ownerLabel ?? "a private collection";
  if (row.ownership === "personal") return "your collection";
  return null;
}

/** The facts of a whereabouts record, each only as recorded */
function recordFacts(row: ArtRow) {
  return [
    row.since ? `Since ${row.since}` : "Start not recorded",
    row.displayStatus ? DISPLAY_LABELS[row.displayStatus] : null,
    row.certainty ? CERTAINTY_LABELS[row.certainty] : null,
  ].filter(Boolean);
}

function Source({ row }: { row: ArtRow }) {
  if (!row.sourceLabel) return null;
  return (
    <>
      {" · Source: "}
      {row.sourceUrl ? (
        <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          {row.sourceLabel}
        </a>
      ) : (
        row.sourceLabel
      )}
    </>
  );
}

function PaintingTitle({ row }: { row: ArtRow }) {
  return (
    <p className="type-item-title">
      <Link href={paintingHref({ id: row.workId, slug: row.slug })} className={LINK}>
        {row.title}
      </Link>
    </p>
  );
}

/**
 * The art at a venue, in two lists kept apart: what is here now (its own
 * collection and loans in, with custody, dates, display state, certainty and
 * source as recorded), and what its institutions own that is elsewhere now
 * (lent out) or has no recorded place.
 */
export function VenueArtParts({ art, institutions }: { art: VenueArt; institutions: string[] }) {
  if (art.here.total === 0 && art.away.total === 0) return null;
  const owners = institutions.join(" and ");
  return (
    <>
      {art.here.total > 0 && (
        <section className="mb-10" aria-labelledby="venue-art-here">
          <SectionHeading
            id="venue-art-here"
            title="Here now"
            count={art.here.total}
            description="Paintings recorded at this venue now, with their custody and display as recorded. A holding is not read as on view."
          />
          <ul className="space-y-2">
            {art.here.rows.map((row) => {
              const owner = ownerText(row);
              const custody = row.custody ? CUSTODY_LABELS[row.custody] : "Custody not recorded";
              const loan = row.custody === "temporary_loan" || row.custody === "long_term_loan";
              // "Permanent collection of the Louvre", "On long-term loan, from a private collection"
              const held = !owner
                ? custody
                : row.custody === "permanent_collection"
                  ? `${custody} of ${owner}`
                  : loan
                    ? `${custody}, from ${owner}`
                    : `${custody} · Owner: ${owner}`;
              return (
                <li key={row.whereaboutsId ?? row.objectId} className={ROW}>
                  <PaintingTitle row={row} />
                  <p className="mt-0.5 text-sm text-fg-secondary">
                    {[
                      objectName(row),
                      held,
                      row.occasionLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {recordFacts(row).join(" · ")}
                    <Source row={row} />
                  </p>
                </li>
              );
            })}
          </ul>
          <More shown={art.here.rows.length} total={art.here.total} />
        </section>
      )}
      {art.away.total > 0 && (
        <section className="mb-10" aria-labelledby="venue-art-away">
          <SectionHeading
            id="venue-art-away"
            title="Its collection elsewhere"
            count={art.away.total}
            description={`Paintings owned by ${owners} that are not recorded here now.`}
          />
          <ul className="space-y-2">
            {art.away.rows.map((row) => (
              <li key={row.objectId} className={ROW}>
                <PaintingTitle row={row} />
                <p className="mt-0.5 text-sm text-fg-secondary">
                  {objectName(row)}
                  {" · "}
                  {row.whereaboutsId === null ? (
                    "Where it is now is not recorded"
                  ) : row.venueName ? (
                    <>
                      {row.custody ? `${CUSTODY_LABELS[row.custody]} at ` : "At "}
                      {row.venueSlug ? (
                        <Link href={`/places/${row.venueSlug}`} className={LINK}>
                          {row.venueName}
                        </Link>
                      ) : (
                        row.venueName
                      )}
                    </>
                  ) : (
                    [row.placeKind ? PLACE_LABELS[row.placeKind] : null, row.placeLabel].filter(Boolean).join(": ")
                  )}
                  {row.occasionLabel ? ` · ${row.occasionLabel}` : ""}
                </p>
                {row.whereaboutsId !== null && (
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    {recordFacts(row).join(" · ")}
                    <Source row={row} />
                  </p>
                )}
              </li>
            ))}
          </ul>
          <More shown={art.away.rows.length} total={art.away.total} />
        </section>
      )}
    </>
  );
}

/** "Checked 1 Oct 2026 (3 days ago)", with "may have changed" once it is stale */
function checkedText(row: VenueRetail["rows"][number]) {
  if (row.ageDays === null || !row.checkedAt) return "No price recorded yet";
  const day = new Date(row.checkedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const age = row.ageDays === 0 ? "today" : row.ageDays === 1 ? "yesterday" : `${row.ageDays} days ago`;
  return `Checked ${day} (${age})${row.isStale ? ", may have changed" : ""}`;
}

/**
 * The fragrances sold here: listings for this branch, then the online
 * listings of the retailer that runs it. Each shows its formulation and the
 * last offer seen, with its date; never a promise of stock.
 */
export function VenueRetailPart({ retail }: { retail: VenueRetail }) {
  if (retail.total === 0) return null;
  return (
    <section className="mb-10" aria-labelledby="venue-retail">
      <SectionHeading
        id="venue-retail"
        title="Perfumes sold here"
        count={retail.total}
        description="Each listing shows the last offer seen and when; stock may have changed since."
      />
      <ul className="space-y-2">
        {retail.rows.map((row) => {
          const offer = [
            row.price != null && row.currency ? formatPrice(row.price, row.currency) : null,
            row.container
              ? `${CONTAINER_LABELS[row.container].one}${row.capacityMl ? ` ${formatVolume(row.capacityMl)}` : ""}`
              : null,
            row.packageLabel,
            row.availability ? AVAILABILITY_LABELS[row.availability] : null,
          ].filter(Boolean);
          return (
            <li key={row.id} className={ROW}>
              <p className="type-item-title">
                <Link href={perfumeHref({ id: row.workId, slug: row.slug })} className={LINK}>
                  {row.title}
                </Link>
              </p>
              <p className="mt-0.5 text-sm text-fg-secondary">
                {[row.hasVariant ? formulationName(row) : "Any formulation", ...offer].join(" · ")}
              </p>
              <p className="mt-0.5 text-xs text-fg-secondary">
                {[
                  row.venueId ? null : `Online, from ${row.retailerName}`,
                  row.archivedAt ? "Archived listing" : null,
                  checkedText(row),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {" · "}
                <a href={row.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Listing
                </a>
              </p>
            </li>
          );
        })}
      </ul>
      <More shown={retail.rows.length} total={retail.total} />
    </section>
  );
}

/** "Delivered", "In transit" */
function statusText(status: string) {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Orders placed at this venue, newest first: the bookshop's history stays here */
export function VenueOrdersPart({ orders }: { orders: Awaited<ReturnType<typeof getVenueOrders>> }) {
  if (orders.total === 0) return null;
  return (
    <section className="mb-10" aria-labelledby="venue-orders">
      <SectionHeading
        id="venue-orders"
        title="Orders"
        count={orders.total}
        action={
          <Link href="/provenance" className="text-sm text-fg-secondary transition-colors hover:text-fg-primary">
            All orders
          </Link>
        }
      />
      <ul className="divide-y divide-glass-border">
        {orders.rows.map((order) => (
          <li key={order.id} className="flex items-baseline justify-between gap-4 py-2">
            <Link href={`/library/${order.slug ?? order.workId}`} className={`min-w-0 truncate text-sm ${LINK}`}>
              {order.title}
            </Link>
            <span className="shrink-0 text-xs text-fg-secondary">
              {[
                order.orderDate,
                statusText(order.status),
                order.price != null && order.currency ? formatPrice(order.price, order.currency) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <More shown={orders.rows.length} total={orders.total} />
    </section>
  );
}

/** "Bottle · 100 ml", "Physical · Blu-ray", "Original" */
function purchaseItem(row: VenuePurchases["rows"][number]) {
  const item =
    row.kind === "perfume"
      ? (CONTAINER_LABELS[row.item as keyof typeof CONTAINER_LABELS]?.one ?? row.item)
      : row.kind === "film"
        ? (FILM_MEDIUM_LABELS[row.item as keyof typeof FILM_MEDIUM_LABELS] ?? row.item)
        : (ART_OBJECT_KIND_LABELS[row.item as keyof typeof ART_OBJECT_KIND_LABELS] ?? row.item);
  return [item, row.detail].filter(Boolean).join(" · ");
}

const PURCHASE_HREF = {
  perfume: perfumeHref,
  film: filmHref,
  painting: paintingHref,
} as const;

/**
 * What you bought here besides book orders: bottles, film copies and art
 * objects whose acquisition names this venue, newest first.
 */
export function VenuePurchasesPart({ purchases }: { purchases: VenuePurchases }) {
  if (purchases.total === 0) return null;
  return (
    <section className="mb-10" aria-labelledby="venue-purchases">
      <SectionHeading id="venue-purchases" title="Bought here" count={purchases.total} />
      <ul className="divide-y divide-glass-border">
        {purchases.rows.map((row) => (
          <li key={`${row.kind}-${row.id}`} className="flex items-baseline justify-between gap-4 py-2">
            <span className="min-w-0 truncate text-sm">
              <Link href={PURCHASE_HREF[row.kind]({ id: row.workId, slug: row.slug })} className={LINK}>
                {row.title}
              </Link>
              <span className="text-fg-secondary"> · {purchaseItem(row)}</span>
            </span>
            <span className="shrink-0 text-xs text-fg-secondary">
              {[row.acquiredOn, HOLDING_STATUS_LABELS[row.status as HoldingStatus] ?? null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <More shown={purchases.rows.length} total={purchases.total} />
    </section>
  );
}
