"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { ENTITIES, entityDefinition } from "@/lib/harmonization/registry";
import { RULES, scanDataset } from "@/lib/harmonization/engine";
import {
  executeMerge,
  previewMerge,
  updateQuery,
} from "@/lib/harmonization/merge";
import {
  assertSql,
  loadDataset,
  loadSnapshot,
  lockSql,
  persistenceAvailable,
  resultRows,
  snapshotQuery,
} from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import type { Scan } from "@/lib/harmonization/types";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: "This request is invalid. Refresh and try again.",
      };
    const cause = error instanceof Error ? error.cause || error : error;
    const code = (cause as { code?: string })?.code;
    if (code === "23505")
      return {
        ok: false,
        error:
          "A unique value or relationship would conflict. Reconcile the records and review again. No changes were saved.",
      };
    if (code === "23503" || code === "23514")
      return {
        ok: false,
        error:
          "This change would break a catalogue relationship or validation rule. Review the conflicting fields. No changes were saved.",
      };
    if (code === "42P01" || code === "42883")
      return {
        ok: false,
        error:
          "Harmonization storage is not ready. Apply the database migration before saving changes.",
      };
    // PostgreSQL custom assertions contain deliberate, user-facing messages. Never return SQL/parameters.
    if (code === "P0001") return { ok: false, error: (cause as Error).message };
    if (code)
      return {
        ok: false,
        error:
          "The database could not complete this action. No changes were saved. Refresh and retry.",
      };
    const message =
      error instanceof Error ? error.message : "Could not complete this action";
    return {
      ok: false,
      error: message.startsWith("Failed query:")
        ? "The database is unavailable. Please try again."
        : message,
    };
  }
}
function changed() {
  invalidate(...Object.values(CACHE_TAGS));
  revalidatePath("/", "layout");
}
async function requirePersistence() {
  if (!(await persistenceAvailable()))
    throw new Error(
      "Harmonization storage is not ready. Apply the database migration before saving changes.",
    );
}
const findingInput = z.object({
  key: z.string().min(1).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const mergeInput = z.object({
  entity: z.string(),
  sourceId: z.uuid(),
  targetId: z.uuid(),
});

export async function scanLibrary(): Promise<Result<Scan>> {
  return attempt(async () => {
    const [data, ready] = await Promise.all([
      loadDataset(),
      persistenceAvailable(),
    ]);
    const findings = scanDataset(data);
    const decisions = ready
      ? resultRows<{ finding_key: string; fingerprint: string }>(
          await db.execute(
            sql`select finding_key, fingerprint from harmonization_decisions`,
          ),
        )
      : [];
    const ignored = new Map(
      decisions.map((d) => [d.finding_key, d.fingerprint]),
    );
    const history = ready
      ? resultRows<{
          id: string;
          action: string;
          label: string;
          createdAt: string;
        }>(
          await db.execute(
            sql`select id, action, label, created_at::text as "createdAt" from harmonization_operations order by created_at desc limit 50`,
          ),
        )
      : [];
    return {
      findings: findings.map((f) => ({
        ...f,
        dismissed: ignored.get(f.key) === f.fingerprint,
      })),
      scannedAt: new Date().toISOString(),
      recordCount: ENTITIES.reduce(
        (n, e) => n + (data[e.table]?.length || 0),
        0,
      ),
      entityCount: ENTITIES.length,
      ruleCount: RULES.length,
      persistenceAvailable: ready,
      history,
    };
  });
}
export async function dismissFinding(input: unknown) {
  return attempt(async () => {
    const parsed = findingInput
      .extend({ reason: z.string().trim().max(500).optional() })
      .parse(input);
    await requirePersistence();
    const finding = scanDataset(await loadDataset()).find(
      (f) => f.key === parsed.key && f.fingerprint === parsed.fingerprint,
    );
    if (!finding)
      throw new Error("This finding changed. Scan the library again.");
    await db.execute(
      sql`insert into harmonization_decisions (finding_key, fingerprint, reason) values (${parsed.key}, ${parsed.fingerprint}, ${parsed.reason || null}) on conflict (finding_key) do update set fingerprint = excluded.fingerprint, reason = excluded.reason, created_at = now()`,
    );
    revalidatePath("/harmonize");
    return { key: parsed.key };
  });
}
export async function restoreFinding(input: unknown) {
  return attempt(async () => {
    const { key, fingerprint } = findingInput.parse(input);
    await db.execute(
      sql`delete from harmonization_decisions where finding_key = ${key} and fingerprint = ${fingerprint}`,
    );
    revalidatePath("/harmonize");
    return { key };
  });
}
export async function getMergePreview(input: unknown) {
  return attempt(async () => {
    const parsed = mergeInput.parse(input);
    return previewMerge(parsed.entity, parsed.sourceId, parsed.targetId);
  });
}
export async function mergeRecords(input: unknown) {
  return attempt(async () => {
    const parsed = mergeInput
      .extend({
        fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
        choices: z.record(z.string(), z.enum(["source", "target"])),
      })
      .parse(input);
    await requirePersistence();
    const result = await executeMerge(parsed);
    changed();
    return result;
  });
}
async function applyOne(input: z.infer<typeof findingInput>) {
  const data = await loadDataset();
  const finding = scanDataset(data).find(
    (f) => f.key === input.key && f.fingerprint === input.fingerprint,
  );
  if (!finding)
    throw new Error("This finding changed. Scan the library again.");
  const resolution = finding.resolution;
  if (resolution.kind !== "update" && resolution.kind !== "poster")
    throw new Error("This finding requires individual review");
  const entity = entityDefinition(finding.entity);
  const id = finding.records[0].id;
  const { data: before, fingerprint } = await loadSnapshot(entity.table, [id]);
  // Ensure the rule was derived from the same root record we will update.
  if (
    stableStringify(before.records[0]) !==
    stableStringify(data[entity.table].find((r) => r.id === id))
  ) {
    throw new Error(
      "This record changed during the scan. Please refresh and retry.",
    );
  }
  const operationId = randomUUID();
  await atomic((d) => [
    d.execute(sql`set local lock_timeout = '5s'`),
    d.execute(sql`set local statement_timeout = '30s'`),
    d.execute(lockSql([entity.table, "media", "editions", "series"])),
    ...(resolution.kind === "update" && resolution.changes.series_id
      ? [
          d.execute(
            assertSql(
              sql`(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text), '[]'::jsonb) from series s) = ${JSON.stringify(data.series || [])}::jsonb`,
              "The series catalogue changed. Review the suggestion again.",
            ),
          ),
        ]
      : []),
    d.execute(
      assertSql(
        sql`(select md5(data::text) = ${fingerprint} from (${snapshotQuery(entity.table, [id])}) s)`,
        "This record changed. Review it again.",
      ),
    ),
    d.execute(
      sql`insert into harmonization_operations (id, action, entity, source_id, label, before) values (${operationId}::uuid, 'fix', ${entity.key}, ${id}::uuid, ${`${resolution.label}: ${finding.records[0].name}`}, ${JSON.stringify(before)}::jsonb)`,
    ),
    ...(resolution.kind === "update"
      ? [d.execute(updateQuery(entity.table, id, resolution.changes))]
      : [
          d.execute(
            sql`insert into media (${sql.identifier(entity.mediaOwner!)}, type, s3_key, thumbnail_s3_key, is_active) values (${id}::uuid, 'poster', ${resolution.s3Key}, ${resolution.thumbnailS3Key}, true)`,
          ),
        ]),
    d.execute(
      sql`update harmonization_operations set after = (select data from (${snapshotQuery(entity.table, [id])}) s) where id = ${operationId}::uuid`,
    ),
  ]);
  return { key: input.key, operationId };
}
export async function applyFindingFixes(input: unknown) {
  return attempt(async () => {
    const parsed = z.array(findingInput).min(1).max(20).parse(input);
    await requirePersistence();
    const applied: string[] = [],
      failed: { key: string; error: string }[] = [];
    for (const item of parsed) {
      const result = await attempt(() => applyOne(item));
      if (result.ok) applied.push(item.key);
      else failed.push({ key: item.key, error: result.error });
    }
    if (applied.length) changed();
    return { applied, failed };
  });
}
export async function getHarmonizationOperation(input: unknown) {
  return attempt(async () => {
    const id = z.uuid().parse(input);
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(
        sql`select * from harmonization_operations where id = ${id}::uuid`,
      ),
    );
    if (!rows[0]) throw new Error("History entry not found");
    return rows[0];
  });
}
