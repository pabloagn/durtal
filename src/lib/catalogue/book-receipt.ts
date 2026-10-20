import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { ExpectedActionError } from "@/lib/actions/expected-error";
import { getAppSettings } from "@/lib/actions/settings";
import { db } from "@/lib/db";
import { editions, instances, locations } from "@/lib/db/schema";
import { assertSql } from "@/lib/harmonization/store";
import { lockReaderEbooks } from "@/lib/reading/reader-write-locks";
import type { Db } from "./work-store";

/**
 * Receiving and returning a book order. When a book order reaches Delivered,
 * Purchased or Received, the same write creates its copy and links it to the
 * order: the edition the order names, else the book's only edition, at the
 * order's destination, else at the location for new copies (Settings ->
 * General). A return deaccessions that copy.
 */

/** What a received book order's copy needs from its order */
export interface BookReceiptOrder {
  workId: string;
  editionId: string | null;
  acquisitionMethod: string;
  price: string | null;
  totalCost: string | null;
  currency: string | null;
  destinationLocationId: string | null;
  destinationSubLocationId: string | null;
}

export type BookCopyPlan = Awaited<ReturnType<typeof planBookCopy>>;

/**
 * The copy a received book order brings in. Read before the write; each
 * refusal says what to set on the order or in Settings.
 */
export async function planBookCopy(order: BookReceiptOrder) {
  let editionId = order.editionId;
  if (!editionId) {
    const found = await db
      .select({ id: editions.id })
      .from(editions)
      .where(eq(editions.workId, order.workId))
      .limit(2);
    if (found.length !== 1)
      throw new ExpectedActionError(
        found.length
          ? "This book has more than one edition. Choose the edition that arrived on the order first."
          : "This book has no edition yet. Add the edition that arrived on the book's page first.",
      );
    editionId = found[0].id;
  }
  const settings = await getAppSettings();
  const locationId = order.destinationLocationId ?? settings.newCopyLocationId;
  if (!locationId)
    throw new ExpectedActionError(
      "Choose where the book arrives: set the order's destination, or a location for new copies in Settings.",
    );
  const [place] = await db
    .select({ type: locations.type })
    .from(locations)
    .where(eq(locations.id, locationId));
  if (!place) throw new ExpectedActionError("The order's destination no longer exists. Choose another one.");
  // The format and condition for new copies describe a printed book
  const printed = place.type === "physical";
  return {
    editionId,
    locationId,
    subLocationId: order.destinationLocationId ? order.destinationSubLocationId : null,
    format: printed ? settings.newCopyFormat : null,
    condition: printed ? settings.newCopyCondition : null,
  };
}

/** In the receiving write of a stored order: it has no copy yet */
export function bookNotYetReceived(d: Db, orderId: string) {
  return d.execute(
    assertSql(
      sql`exists (select 1 from orders where id = ${orderId}::uuid and instance_id is null)`,
      "This order was already received",
    ),
  );
}

/** The copy's insert, and the order columns that link it */
export function bookReceiptQueries(d: Db, plan: BookCopyPlan, order: BookReceiptOrder, receivedOn: string) {
  const id = randomUUID();
  const amount = order.totalCost ?? order.price;
  const paid = amount != null && order.currency != null;
  return {
    queries: [
      d.insert(instances).values({
        id,
        ...plan,
        acquisitionType: order.acquisitionMethod === "gift" ? "gift" : "purchased",
        acquisitionDate: receivedOn,
        acquisitionPrice: paid ? amount : null,
        acquisitionCurrency: paid ? order.currency : null,
      }),
    ],
    link: { instanceId: id, editionId: plan.editionId },
  };
}

/** A return: the order's copy is deaccessioned, on the day returned */
export function bookReturnQueries(d: Db, instanceId: string | null, returnedOn: string) {
  if (!instanceId) return [];
  const active = and(eq(instances.id, instanceId), ne(instances.status, "deaccessioned"));
  return [
    lockReaderEbooks(d, sql`select id from ebooks where instance_id = ${instanceId}::uuid`),
    d.execute(sql`insert into instance_status_history (instance_id, from_status, to_status, notes)
      select id, status, 'deaccessioned', 'Returned to the seller'
      from instances where id = ${instanceId}::uuid and status <> 'deaccessioned'`),
    d
      .update(instances)
      .set({
        status: "deaccessioned",
        dispositionType: "returned",
        dispositionDate: returnedOn,
        dispositionNotes: "Returned to the seller",
        updatedAt: new Date(),
      })
      .where(active),
  ];
}
