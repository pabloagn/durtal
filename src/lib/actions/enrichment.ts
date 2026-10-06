"use server";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { recordActivity } from "@/lib/activity/record";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { parseId } from "@/lib/validations/helpers";
import {
  acceptClaimsSchema,
  humanClaimSchema,
  rejectClaimsSchema,
  type HumanClaimInput,
} from "@/lib/validations/enrichment";
import {
  applyClaim,
  createHumanClaim,
  currentFingerprint,
  undoApplication,
  workEnrichment,
} from "@/lib/enrichment/claims";

/*
 * Book enrichment actions (SLN-462): the inbox of SLN-470 and the book page
 * read a book's claims and decide them here. Every write is one atomic unit;
 * activity is recorded after the commit.
 */

type ItemResult = { claimId?: string; applicationId?: string; reason: string };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A book's claims with their evidence, its accepted values and its applies */
export async function getWorkEnrichment(workId: string) {
  parseId(workId);
  return workEnrichment(workId);
}

function applied(workId: string, applicationId: string, dimension?: string) {
  recordActivity("work", workId, "work.enrichment_applied", { targetId: applicationId, targetName: dimension });
}

/** Accepts 1 to 20 claims; each item stands alone, and one batch id names them all */
export async function acceptEnrichmentClaims(items: z.input<typeof acceptClaimsSchema>) {
  const parsed = acceptClaimsSchema.parse(items);
  const batchId = randomUUID();
  const done: { claimId: string; applicationId: string }[] = [];
  const failed: ItemResult[] = [];
  for (const item of parsed) {
    try {
      const result = await applyClaim(item.claimId, { by: "pablo", batchId, fingerprint: item.fingerprint });
      done.push({ claimId: item.claimId, applicationId: result.applicationId });
      applied(result.workId, result.applicationId);
    } catch (error) {
      failed.push({ claimId: item.claimId, reason: message(error) });
    }
  }
  if (done.length) invalidate(CACHE_TAGS.works);
  return { batchId, applied: done, failed };
}

/** Rejects proposed claims with Pablo's reason; a stale fingerprint refuses the item */
export async function rejectEnrichmentClaims(items: z.input<typeof rejectClaimsSchema>) {
  const parsed = rejectClaimsSchema.parse(items);
  const rejected: string[] = [];
  const failed: ItemResult[] = [];
  for (const item of parsed) {
    try {
      if ((await currentFingerprint(db, item.claimId)) !== item.fingerprint)
        throw new Error("The claim, its evidence or the book's value changed. Review it again.");
      await withReadableErrors(() =>
        atomic((d) => [
          d.execute(sql`select id from enrichment_claims where id = ${item.claimId}::uuid for update`),
          d.execute(assertSql(sql`exists (select 1 from enrichment_claims where id = ${item.claimId}::uuid and status = 'proposed')`, "Only a proposed claim can be rejected")),
          d.execute(sql`update enrichment_claims set status = 'rejected', decided_by = 'pablo', decided_at = now(),
              decision_reason = ${item.reason}, note = coalesce(${item.note ?? null}, note)
            where id = ${item.claimId}::uuid`),
        ]),
      );
      rejected.push(item.claimId);
    } catch (error) {
      failed.push({ claimId: item.claimId, reason: message(error) });
    }
  }
  return { rejected, failed };
}

/** Pablo's edit: a value of the dimension's kind, accepted and applied at once */
export async function createHumanEnrichmentClaim(input: HumanClaimInput) {
  const parsed = humanClaimSchema.parse(input);
  await requireBookWork(parsed.workId);
  const result = await createHumanClaim(parsed);
  applied(result.workId, result.applicationId, parsed.dimension);
  invalidate(CACHE_TAGS.works);
  return result;
}

async function undone(applicationId: string) {
  const result = await undoApplication(applicationId);
  recordActivity("work", result.workId, "work.enrichment_undone", { targetId: applicationId });
  return result;
}

export async function undoEnrichmentApplication(id: string) {
  parseId(id);
  try {
    await undone(id);
    invalidate(CACHE_TAGS.works);
    return { undone: [id], failed: [] as ItemResult[] };
  } catch (error) {
    return { undone: [] as string[], failed: [{ applicationId: id, reason: message(error) }] };
  }
}

/** Undoes every apply of one batch, newest first */
export async function undoEnrichmentBatch(batchId: string) {
  parseId(batchId);
  const ids = resultRows<{ id: string }>(
    await db.execute(sql`select id from enrichment_applications where batch_id = ${batchId}::uuid and undone_at is null order by applied_at desc, id desc`),
  ).map((r) => r.id);
  const done: string[] = [];
  const failed: ItemResult[] = [];
  for (const id of ids) {
    try {
      await undone(id);
      done.push(id);
    } catch (error) {
      failed.push({ applicationId: id, reason: message(error) });
    }
  }
  if (done.length) invalidate(CACHE_TAGS.works);
  return { undone: done, failed };
}

