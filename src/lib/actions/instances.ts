"use server";

import { ExpectedActionError } from "@/lib/actions/expected-error";
import { db } from "@/lib/db";
import { copyDeleteSummary } from "@/lib/catalogue/delete-summary";
import { editions, instances } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { atomic } from "@/lib/db/atomic";
import { lockReaderEbooks, withReaderWriteRetry } from "@/lib/reading/reader-write-locks";
import {
  createInstanceSchema,
  updateInstanceSchema,
  type CreateInstanceInput,
  type UpdateInstanceInput,
} from "@/lib/validations";
import { parseId } from "@/lib/validations/helpers";
import { recordActivity } from "@/lib/activity/record";
import { copyShelfMismatch } from "@/lib/catalogue/copy-shelf";
import { loanNoteSql } from "@/lib/catalogue/loans";

export async function createInstance(input: CreateInstanceInput) {
  const parsed = createInstanceSchema.parse(input);
  const mismatch = await copyShelfMismatch([parsed]);
  if (mismatch) throw new ExpectedActionError(mismatch);
  const [instance] = await db.insert(instances).values(parsed).returning();

  const edition = await db.query.editions.findFirst({
    where: eq(editions.id, parsed.editionId),
    columns: { workId: true },
  });
  if (edition) {
    recordActivity("work", edition.workId, "work.instance_added", {
      targetId: instance.id,
    });
  }

  return instance;
}

export async function updateInstance(id: string, input: UpdateInstanceInput) {
  parseId(id);
  const data = updateInstanceSchema.parse(input);
  const place = await placeAfterEdit(id, data);
  // A copy that comes back, or leaves lending another way, keeps no borrower:
  // the history row written first keeps the loan (SLN-1125)
  const loanEnds = data.status !== undefined && data.status !== "lent_out" ? { lentTo: null, lentDate: null } : {};
  await withReaderWriteRetry(() => atomic((d) => [
    lockReaderEbooks(d, sql`select id from ebooks where instance_id=${id}::uuid`),
    ...(data.status ? [d.execute(statusChangeSql(id, data))] : []),
    d.update(instances)
    .set({ ...data, ...loanEnds, ...place, updatedAt: new Date() })
    .where(eq(instances.id, id)),
  ]));

  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { id: true },
    with: {
      edition: {
        columns: { workId: true },
      },
    },
  });
  if (inst?.edition) {
    recordActivity("work", inst.edition.workId, "work.instance_updated", {
      targetId: id,
    });
  }

  return { id };
}

/**
 * The status history row for an edit that changes a copy's status, written
 * before the update so it reads the status it changes from. A lend notes the
 * new borrower and date; the change that ends a loan notes the stored ones.
 */
function statusChangeSql(id: string, data: { status?: string; lentTo?: string | null; lentDate?: string | null }) {
  const to = data.status!;
  const lentTo = data.lentTo !== undefined ? sql`${data.lentTo}::text` : sql`lent_to`;
  const lentDate = data.lentDate !== undefined ? sql`${data.lentDate}::date` : sql`lent_date`;
  return sql`insert into instance_status_history (instance_id, from_status, to_status, notes)
    select id, status, ${to}::instance_status_enum,
      case
        when ${to} = 'lent_out' then ${loanNoteSql(lentTo, lentDate)}
        when status = 'lent_out' then ${loanNoteSql(sql`lent_to`, sql`lent_date`)}
      end
    from instances where id = ${id}::uuid and status is distinct from ${to}::instance_status_enum`;
}

/**
 * The sub-location an edit leaves a copy on. One the edit names must belong
 * to the copy's location; a move that names none takes the copy off a
 * sub-location of its old location rather than keep it there (SLN-574).
 */
async function placeAfterEdit(
  id: string,
  data: { locationId?: string; subLocationId?: string | null },
): Promise<{ subLocationId?: null }> {
  if (data.locationId === undefined && data.subLocationId === undefined) return {};
  const stored = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { locationId: true, subLocationId: true },
  });
  if (!stored) return {};
  const locationId = data.locationId ?? stored.locationId;
  if (data.subLocationId !== undefined) {
    const mismatch = await copyShelfMismatch([{ locationId, subLocationId: data.subLocationId }]);
    if (mismatch) throw new ExpectedActionError(mismatch);
    return {};
  }
  const stale = await copyShelfMismatch([{ locationId, subLocationId: stored.subLocationId }]);
  return stale ? { subLocationId: null } : {};
}

/** What deleting a copy takes with it, for its delete dialog (SLN-1112) */
export async function getCopyDeleteSummary(id: string) {
  return copyDeleteSummary(parseId(id));
}

export async function deleteInstance(id: string) {
  parseId(id);
  const inst = await db.query.instances.findFirst({
    where: eq(instances.id, id),
    columns: { id: true },
    with: {
      edition: {
        columns: { workId: true },
      },
    },
  });

  await withReaderWriteRetry(() => atomic((d) => [
    lockReaderEbooks(d, sql`select id from ebooks where instance_id=${id}::uuid`),
    d.delete(instances).where(eq(instances.id, id)),
  ]));

  if (inst?.edition) {
    recordActivity("work", inst.edition.workId, "work.instance_deleted", {
      targetId: id,
    });
  }

  return { id };
}
