import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  acquisitionTargets,
  artObjects,
  filmHoldings,
  locations,
  perfumeBottles,
} from "@/lib/db/schema";
import { assertSql } from "@/lib/harmonization/store";
import { insertDates, newDate, type Db } from "./work-store";

/**
 * Receiving and returning a film, perfume or painting order (SLN-374). A book
 * order only promotes the book's status; a typed order brings in the holding
 * its target names, once, in the same write as the status that receives it:
 * a bottle of the target's formulation and size, a copy of its version,
 * release and medium, the object it buys, or a new reproduction of the object
 * it names. A return marks that holding disposed. Custody records of artworks
 * (where an object is shown or kept) are never touched.
 */

type Target = typeof acquisitionTargets.$inferSelect;
export type TypedKind = "perfume" | "film" | "painting";

/** The kind of holding a target brings in; null for a book target */
export function typedKind(target: Pick<Target, "perfumeVariantId" | "filmVersionId" | "artObjectId" | "artReproducesObjectId">): TypedKind | null {
  if (target.perfumeVariantId) return "perfume";
  if (target.filmVersionId) return "film";
  if (target.artObjectId || target.artReproducesObjectId) return "painting";
  return null;
}

/** The order column that holds what a received typed order brought in */
export function linkColumn(kind: TypedKind) {
  return kind === "perfume" ? "perfumeBottleId" : kind === "film" ? "filmHoldingId" : "artObjectId";
}

export async function getTarget(id: string | null | undefined) {
  if (!id) return null;
  const [target] = await db.select().from(acquisitionTargets).where(eq(acquisitionTargets.id, id));
  return target ?? null;
}

/** What an order says about a receipt: where it goes, from whom, for how much */
export interface ReceiptOrder {
  id?: string;
  workId: string;
  venueId: string | null;
  price: string | null;
  totalCost: string | null;
  currency: string | null;
  actualDeliveryDate: string | null;
  destinationLocationId: string | null;
  destinationSubLocationId: string | null;
}

/** "2026-10-04" as a day value */
function dayValue(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return newDate({ precision: "day", start: { year, month, day: date }, end: null, approximate: false, label: null });
}

/** The amount paid, with its currency, or neither */
function paid(order: ReceiptOrder) {
  const amount = order.totalCost ?? order.price;
  return amount != null && order.currency
    ? { acquisitionPrice: Number(amount), acquisitionCurrency: order.currency }
    : { acquisitionPrice: null, acquisitionCurrency: null };
}

/**
 * Checks, before the write, that the destination suits what arrives: a bottle
 * or an artwork goes to a physical place, a film copy to a place of its
 * medium. Each refusal says what to change on the order.
 */
export async function checkDestination(target: Target, order: ReceiptOrder) {
  if (!order.destinationLocationId) return;
  const [place] = await db
    .select({ type: locations.type, name: locations.name })
    .from(locations)
    .where(eq(locations.id, order.destinationLocationId));
  if (!place) throw new Error("The order's destination no longer exists. Choose another one.");
  const needed = target.filmMedium ?? "physical";
  if (place.type !== needed)
    throw new Error(
      target.filmMedium === "digital"
        ? `${place.name} is a physical place; a digital copy goes to a digital location. Change the order's destination first.`
        : `${place.name} is a digital location; this arrives as a physical object. Change the order's destination first.`,
    );
}

/**
 * The queries that create (or, for an object bought as it is, take over) the
 * holding, and its id for the order's link. Runs inside the receiving write,
 * after the order is locked.
 */
export function receiptQueries(d: Db, target: Target, order: ReceiptOrder, receivedOn: string) {
  const kind = typedKind(target);
  if (!kind) throw new Error("A book order receives a book copy");
  const id = target.artObjectId ?? randomUUID();
  const acquired = dayValue(receivedOn);
  const place = {
    locationId: order.destinationLocationId,
    subLocationId: order.destinationLocationId ? order.destinationSubLocationId : null,
  };
  const common = {
    status: "held" as const,
    ...place,
    acquisitionDateId: acquired?.id ?? null,
    venueId: order.venueId,
    ...paid(order),
  };
  const queries: unknown[] = [...insertDates(d, [acquired])];
  if (kind === "perfume")
    queries.push(
      d.insert(perfumeBottles).values({
        id,
        variantId: target.perfumeVariantId!,
        container: target.perfumeContainer!,
        capacityValue: Number(target.perfumeCapacityValue),
        volumeUnit: target.perfumeVolumeUnit!,
        ...common,
      }),
    );
  else if (kind === "film")
    queries.push(
      d.insert(filmHoldings).values({
        id,
        workId: order.workId,
        versionId: target.filmVersionId,
        releaseId: target.filmReleaseId,
        medium: target.filmMedium!,
        formatLabel: target.filmFormatLabel,
        ...common,
      }),
    );
  else if (target.artReproducesObjectId)
    queries.push(
      d.insert(artObjects).values({
        id,
        workId: order.workId,
        kind: "reproduction",
        reproducesObjectId: target.artReproducesObjectId,
        ownership: "personal",
        holdingStatus: "held",
        ...place,
        acquisitionDateId: common.acquisitionDateId,
        venueId: common.venueId,
        acquisitionPrice: common.acquisitionPrice,
        acquisitionCurrency: common.acquisitionCurrency,
      }),
    );
  else
    // The object bought as it is becomes the collector's: its custody
    // records stay as they were
    queries.push(
      d
        .update(artObjects)
        .set({
          ownership: "personal",
          ownerLabel: null,
          holdingStatus: "held",
          ...place,
          acquisitionDateId: common.acquisitionDateId,
          venueId: common.venueId,
          acquisitionPrice: common.acquisitionPrice,
          acquisitionCurrency: common.acquisitionCurrency,
          updatedAt: new Date(),
        })
        .where(and(eq(artObjects.id, id), inArray(artObjects.ownership, ["private", "unknown"]))),
      d.execute(
        assertSql(
          sql`exists (select 1 from art_objects where id = ${id}::uuid and ownership = 'personal')`,
          "This object is no longer for sale: it belongs to an institution or is already yours",
        ),
      ),
    );
  return { kind, id, queries, link: { [linkColumn(kind)]: id } as Record<string, string> };
}

/** In the receiving write: the order has brought nothing in yet */
export function notYetReceived(d: Db, orderId: string) {
  return d.execute(
    assertSql(
      sql`exists (select 1 from orders where id = ${orderId}::uuid and film_holding_id is null and perfume_bottle_id is null and art_object_id is null)`,
      "This order was already received",
    ),
  );
}

/** A return: what the order brought in is disposed of, on the day returned */
export function returnQueries(
  d: Db,
  order: { filmHoldingId: string | null; perfumeBottleId: string | null; artObjectId: string | null },
  returnedOn: string,
) {
  if (!order.perfumeBottleId && !order.filmHoldingId && !order.artObjectId) return [];
  const disposed = dayValue(returnedOn);
  const disposal = {
    dispositionDateId: disposed?.id ?? null,
    dispositionReason: "Returned to the seller",
    updatedAt: new Date(),
  };
  return [
    ...insertDates(d, [disposed]),
    order.perfumeBottleId
      ? d.update(perfumeBottles).set({ status: "disposed", ...disposal }).where(eq(perfumeBottles.id, order.perfumeBottleId))
      : order.filmHoldingId
        ? d.update(filmHoldings).set({ status: "disposed", ...disposal }).where(eq(filmHoldings.id, order.filmHoldingId))
        : d.update(artObjects).set({ holdingStatus: "disposed", ...disposal }).where(eq(artObjects.id, order.artObjectId!)),
  ];
}
