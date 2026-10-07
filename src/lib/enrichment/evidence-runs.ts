import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { resultRows } from "@/lib/harmonization/store";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import { keysInUse } from "@/lib/s3/cleanup";
import { EVIDENCE_PREFIX } from "@/lib/s3/keys";
import { monthWindow } from "./meter";

/**
 * The reads of the evidence CLI (SLN-468): outlet proposals from the
 * catalogue, this month's ledger, and evidence objects no row names. All of
 * them read; none writes.
 */

/**
 * How long an evidence object that no claim cites is kept. Pending Pablo's
 * decision in SLN-461: until he approves it, --purge only lists orphans.
 */
export const EVIDENCE_RETENTION_DAYS = 90;

/** Candidates for the registry: publishers and translators with a website, and the original languages of owned books */
export async function proposeOutlets(database: Db) {
  const owned = ownedBookCondition(sql`w.id`);
  const publishers = resultRows<{ name: string; website: string; books: number }>(
    await database.execute(sql`
      select ph.name, ph.website, count(distinct w.id)::int as books
      from publishing_houses ph
      join edition_publishers ep on ep.publisher_id = ph.id
      join editions e on e.id = ep.edition_id
      join works w on w.id = e.work_id
      where coalesce(trim(ph.website), '') <> '' and w.kind = 'book' and ${owned}
        and exists (select 1 from instances i where i.edition_id = e.id and i.status <> 'deaccessioned')
      group by ph.name, ph.website order by books desc, ph.name`),
  );
  const translators = resultRows<{ name: string; website: string; editions: number }>(
    await database.execute(sql`
      select a.name, a.website, count(distinct e.id)::int as editions
      from authors a
      join edition_contributors ec on ec.author_id = a.id and ec.role = 'translator'
      join editions e on e.id = ec.edition_id
      join works w on w.id = e.work_id
      where coalesce(trim(a.website), '') <> '' and w.kind = 'book' and ${owned}
      group by a.name, a.website order by editions desc, a.name`),
  );
  const languages = resultRows<{ language: string; books: number }>(
    await database.execute(sql`
      select coalesce(nullif(trim(w.original_language), ''), 'unknown') as language, count(*)::int as books
      from works w where w.kind = 'book' and ${owned}
      group by 1 order by books desc, language`),
  );
  return { publishers, translators, languages };
}

/** This month's ledger per provider and operation, and every open reservation with its age */
export async function costsReport(database: Db, now = new Date()) {
  const { start, end } = monthWindow(now);
  const lines = resultRows<{ provider: string; operation: string; calls: number; settled_usd: number; reserved_usd: number }>(
    await database.execute(sql`
      select provider, operation, count(*)::int as calls,
        coalesce(sum(cost_usd) filter (where status = 'settled'), 0)::float8 as settled_usd,
        coalesce(sum(estimated_cost_usd) filter (where status = 'reserved'), 0)::float8 as reserved_usd
      from enrichment_costs where created_at >= ${start.toISOString()} and created_at < ${end.toISOString()}
      group by provider, operation order by provider, operation`),
  );
  const open = resultRows<{ id: string; provider: string; operation: string; estimated_cost_usd: number; age_minutes: number }>(
    await database.execute(sql`
      select id, provider, operation, estimated_cost_usd::float8, (extract(epoch from now() - created_at) / 60)::int as age_minutes
      from enrichment_costs where status = 'reserved' order by created_at`),
  );
  return { start, end, lines, open };
}

/**
 * Evidence objects older than a day that no source record names: what
 * --purge lists. A row write follows its objects, so a younger object may
 * still get its row.
 */
export async function evidenceOrphans(database: Db) {
  const cutoff = Date.now() - 24 * 3600_000;
  const candidates: { key: string; size: number; modified: string }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: EVIDENCE_PREFIX, ContinuationToken: token }));
    for (const object of page.Contents ?? [])
      if (object.Key && object.LastModified && object.LastModified.getTime() < cutoff)
        candidates.push({ key: object.Key, size: object.Size ?? 0, modified: object.LastModified.toISOString() });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const orphans: typeof candidates = [];
  for (let offset = 0; offset < candidates.length; offset += 1000) {
    const batch = candidates.slice(offset, offset + 1000);
    const inUse = await keysInUse(batch.map((o) => o.key), database);
    orphans.push(...batch.filter((o) => !inUse.has(o.key)));
  }
  return { scanned: candidates.length, orphans };
}
