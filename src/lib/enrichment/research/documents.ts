import { sql } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import type { Db } from "@/lib/catalogue/work-store";
import type { Fingerprint } from "../fingerprint";
import type { OUTLET_KINDS } from "../outlets";
import { checkIndependence } from "./independence";

/*
 * The documents research stored for a book (SLN-469): the `source_records`
 * rows owned by the work or one of its editions whose provider is an outlet
 * of the registry, leaving out rows a refresh superseded.
 */

export interface StoredDocument {
  sourceRecordId: string;
  workId: string;
  outlet: string;
  outletName: string;
  outletKind: (typeof OUTLET_KINDS)[number];
  weight: number;
  syndicationGroup: string | null;
  url: string | null;
  textSha256: string;
  textChars: number;
  byline: string | null;
  fingerprint: Fingerprint | null;
}

export async function storedDocuments(conn: Db, workIds: string[]): Promise<StoredDocument[]> {
  if (!workIds.length) return [];
  const ids = sql.join(workIds.map((id) => sql`${id}::uuid`), sql`, `);
  return resultRows<StoredDocument>(
    await conn.execute(sql`select s.id as "sourceRecordId", coalesce(s.work_id, e.work_id) as "workId", o.key as outlet, o.name as "outletName",
        o.kind as "outletKind", o.weight::float8 as weight, o.syndication_group as "syndicationGroup", s.url,
        s.payload ->> 'textSha256' as "textSha256", (s.payload ->> 'textChars')::int as "textChars",
        s.payload ->> 'byline' as byline, s.payload -> 'fingerprint' as fingerprint
      from source_records s join evidence_outlets o on o.key = s.provider left join editions e on e.id = s.edition_id
      where (s.work_id in (${ids}) or e.work_id in (${ids})) and s.payload ->> 'kind' in ('evidence_page', 'evidence_text')
        and not exists (select 1 from source_records successor where successor.supersedes_id = s.id)
      order by o.weight desc, s.retrieved_at, s.id`),
  );
}

/**
 * The reviews found for some books, for SLN-467's popularity: stored
 * documents of review and essay outlets whose latest extraction is about the
 * book, each syndication group and each set of near-duplicate texts counted
 * once (the merge rule of checkIndependence). A book whose research and
 * extract jobs have not both finished has no value: missing, not 0.
 * SLN-467 registers it in POPULARITY_METRICS.
 */
export async function countReviewsFound(conn: Db, workIds: string[]) {
  if (!workIds.length) return new Map<string, null>();
  const finished = new Set(
    resultRows<{ workId: string }>(
      await conn.execute(sql`select work_id as "workId" from enrichment_jobs
        where work_id in (${sql.join(workIds.map((id) => sql`${id}::uuid`), sql`, `)}) and status = 'done' and kind in ('research', 'extract')
        group by work_id having count(distinct kind) = 2`),
    ).map((r) => r.workId),
  );
  const counts = new Map<string, { count: number; counted: { sourceRecordId: string; outlet: string; syndicationGroup: string | null }[] } | null>(
    workIds.map((id) => [id, null]),
  );
  if (!finished.size) return counts;
  // Each document's latest extraction, not undone
  const latest = resultRows<{ sourceRecordId: string; status: string }>(
    await conn.execute(sql`select distinct on (x.source_record_id) x.source_record_id as "sourceRecordId", x.status
      from enrichment_extractions x where x.undone_at is null and x.work_id in (${sql.join([...finished].map((id) => sql`${id}::uuid`), sql`, `)})
      order by x.source_record_id, x.created_at desc, x.id desc`),
  );
  const about = new Set(latest.filter((r) => r.status !== "not_about_work").map((r) => r.sourceRecordId));
  const documents = (await storedDocuments(conn, [...finished])).filter((d) => (d.outletKind === "review" || d.outletKind === "essay") && about.has(d.sourceRecordId));
  for (const workId of finished) {
    const mine = documents.filter((d) => d.workId === workId);
    // The quote rule needs excerpts: documents are compared by outlet, group, byline and text
    const { sources } = checkIndependence(mine.map((d) => ({ ...d, method: "agent" as const, excerpt: "" })));
    counts.set(workId, {
      count: sources.length,
      counted: sources.map((s) => ({ sourceRecordId: s.rows[0].sourceRecordId, outlet: s.rows[0].outlet, syndicationGroup: s.rows[0].syndicationGroup })),
    });
  }
  return counts;
}
