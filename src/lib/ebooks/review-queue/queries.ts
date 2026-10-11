import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { serverEnv } from "@/lib/env";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { textSearchCondition } from "@/lib/actions/utils/text-search";
import { matchFileFromStoredRow, type StoredRow } from "@/lib/ebooks/match/load";
import { reviewTimestampSql } from "@/lib/ebooks/review/store-sql";
import { ebookReviewStampSchema, reviewOperationSchema } from "@/lib/validations/ebook-review";
import type { ReviewUnlinkTarget } from "./unlink-types";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { REVIEW_SECTIONS, type ReviewQueue, type ReviewQueueRow, type ReviewSectionKey,
  type ReviewWorkOptions, type ReviewStamp } from "./types";
import type { ReviewFilters, ReviewParams, ReviewSelectionPageInput } from "./params";

/** Alias e/i/ed/w is shared by counts and rows, so filters cannot drift. */
export function reviewFilterSql(filters: ReviewFilters): SQL {
  const conditions: SQL[] = [sql`true`];
  if (filters.q) {
    const text = textSearchCondition(sql`e.search_text`, filters.q, { fuzzy: false });
    if (text) conditions.push(text);
  }
  if (filters.language) conditions.push(sql`e.language = ${filters.language}`);
  if (filters.format) conditions.push(sql`exists(select 1 from ebook_files f
    where f.ebook_id=e.id and f.format=${filters.format})`);
  if (filters.hasIsbn) conditions.push(filters.hasIsbn === "yes"
    ? sql`cardinality(e.isbns)>0` : sql`cardinality(e.isbns)=0`);
  if (filters.work) conditions.push(sql`(w.id=${filters.work}::uuid or exists(
    select 1 from ebook_match_candidates c where c.ebook_id=e.id and c.work_id=${filters.work}::uuid))`);
  if (filters.author) conditions.push(sql`exists(select 1 from ebook_match_candidates c
    join work_authors wa on wa.work_id=c.work_id where c.ebook_id=e.id and wa.author_id=${filters.author}::uuid
    and wa.role in ('author','co_author'))`);
  if (filters.series) conditions.push(sql`exists(select 1 from ebook_match_candidates c
    join works sw on sw.id=c.work_id where c.ebook_id=e.id and sw.series_id=${filters.series}::uuid)`);
  if (filters.run) conditions.push(sql`exists(select 1 from ebook_ingest_items item
    where item.run_id=${filters.run}::uuid and (item.ebook_id=e.id or exists(
      select 1 from ebook_files f where f.id=item.file_id and f.ebook_id=e.id)))`);
  return sql.join(conditions, sql` and `);
}
export function reviewSectionSql(key: ReviewSectionKey): SQL {
  switch (key) {
    case "likely": return sql`e.match_state='pending' and e.match_tier in ('exact','strong','likely')`;
    case "to_choose": return sql`e.match_state='pending' and (e.match_tier='to_choose' or e.match_tier is null)`;
    case "automatic": return sql`e.match_state='linked' and i.status<>'deaccessioned'
      and e.match_method in ('isbn','identifier','score')
      and e.matched_at>=transaction_timestamp()-interval '30 days'
      and e.matched_at<=transaction_timestamp()`;
    case "partially_held": return sql`e.match_state='linked' and i.status<>'deaccessioned'
      and w.kind='book' and w.catalogue_status in ('tracked','wanted','shortlisted','on_order')`;
    default: return sql`e.match_state='pending' and e.match_tier=${key}`;
  }
}
const from = sql`from ebooks e left join instances i on i.id=e.instance_id
  left join editions ed on ed.id=i.edition_id left join works w on w.id=ed.work_id`;
/** Correlated bounded JSON stays in the section's single query, never a row query loop. */
function copiesSql(): SQL {
  return sql`(select coalesce(jsonb_agg(copy.value order by copy.id),'[]'::jsonb) from (
    select ri.id,jsonb_build_object('id',ri.id,'format',ri.format,'location',l.name,
      'canFill',coalesce(ri.format in ('ebook','epub','pdf') and l.type='digital' and l.is_active
        and not re.metadata_locked and not exists(select 1 from ebooks linked where linked.instance_id=ri.id),false)) as value
    from instances ri left join locations l on l.id=ri.location_id
    where ri.edition_id=re.id and ri.status<>'deaccessioned' order by ri.id limit 50
  ) copy)`;
}
function editionsSql(workId: SQL, limit = 5, withCopies = false): SQL {
  return sql`(select coalesce(jsonb_agg(edition.value order by edition.language,edition.title,edition.id),'[]'::jsonb)
    from (select re.id,re.language,re.title,jsonb_build_object(
      'id',re.id,'title',re.title,'isbn13',re.isbn_13,'language',re.language,
      'publisher',re.publisher,'year',re.publication_year,
      'placeholder',coalesce(re.metadata_source='phantom_canon',false),'locked',re.metadata_locked,
      'copyCount',(select count(*)::integer from instances ri where ri.edition_id=re.id and ri.status<>'deaccessioned'),
      'copies',${withCopies ? copiesSql() : sql`'[]'::jsonb`}
    ) as value from editions re where re.work_id=${workId}
      order by re.language nulls last,re.title,re.id limit ${limit}) edition)`;
}
const candidateSql = sql`(select coalesce(jsonb_agg(jsonb_build_object(
  'rank',c.rank,'workId',cw.id,'title',cw.title,'slug',coalesce(cw.slug,cw.id::text),
  'authors',(select coalesce(jsonb_agg(a.name order by wa.sort_order,a.id),'[]'::jsonb)
    from work_authors wa join authors a on a.id=wa.author_id
    where wa.work_id=cw.id and wa.role in ('author','co_author')),
  'language',cw.original_language,'year',cw.original_year,'status',cw.catalogue_status,
  'probability',c.probability,'rule',c.edition_rule,'modelVersion',c.model_version,
  'flags',c.flags,'reasons',c.reasons,
  'editionCount',(select count(*)::integer from editions re where re.work_id=cw.id),
  'editions',${editionsSql(sql`cw.id`)}
) order by c.rank),'[]'::jsonb) from ebook_match_candidates c join works cw on cw.id=c.work_id
  where c.ebook_id=e.id and cw.kind='book')`;
const matchingIdentitySql = sql`case when e.match_state='linked' then jsonb_build_object(
  'version',e.link_written->'version','operationId',e.link_written->'operationId',
  'runId',e.link_written->'runId','planSha256',e.link_written->'planSha256',
  'targetDatabase',e.link_written->'targetDatabase') else null end`;
type RawRow = Omit<ReviewQueueRow, "stamp" | "files" | "hasCover"> & {
  updatedAt: string | null; matchFingerprint: string | null; rawFiles: StoredRow[];
  nativeMatchingOperation?: unknown; matchMethod?: string | null;
};
function projectRow(raw: RawRow): ReviewQueueRow {
  const { rawFiles, updatedAt, matchFingerprint, nativeMatchingOperation, matchMethod, ...row } = raw;
  const parsedStamp = ebookReviewStampSchema.safeParse({ updatedAt, matchFingerprint });
  const matching = reviewOperationSchema.safeParse(nativeMatchingOperation);
  const projected = rawFiles.map((file) => ({ raw: file, file: matchFileFromStoredRow(file) }));
  return { ...row, stamp: parsedStamp.success ? parsedStamp.data : null,
    matching: row.state === "linked" && matching.success ? { operation: matching.data,
      automatic: ["isbn", "identifier", "score"].includes(matchMethod ?? "") } : null,
    hasCover: projected.some(({ file }) => !!file.coverKey),
    files: projected.map(({ raw: fileRow, file }) => ({ id: file.id, format: file.format,
      sizeBytes: file.sizeBytes, status: file.status, drm: file.drm, availability: file.availability,
      checksum: file.sha256.slice(0, 12),
      sourcePath: typeof fileRow.source_path === "string" ? fileRow.source_path : null,
    })) };
}
export async function loadReviewQueue(conn: Db, params: ReviewParams): Promise<ReviewQueue> {
  const filter = reviewFilterSql(params.filters);
  const [countRow] = resultRows<Record<ReviewSectionKey, number>>(await conn.execute(sql`select
    ${sql.join(REVIEW_SECTIONS.map(({ key }) => sql`count(*) filter(where ${reviewSectionSql(key)})::integer as ${sql.identifier(key)}`), sql`, `)}
    ${from} where ${filter}`));
  const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, Number(countRow?.[key] ?? 0)])) as ReviewQueue["counts"];
  const sections: ReviewQueue["sections"] = [];
  for (const { key } of REVIEW_SECTIONS) {
    if (!counts[key]) continue;
    const rows = resultRows<RawRow>(await conn.execute(sql`select e.id,e.title,e.subtitle,e.authors,e.language,
      e.series,e.series_index::text as "seriesIndex",e.publisher,e.published_year as year,e.isbns,e.identifiers,
      e.match_state as state,e.match_tier as tier,${reviewTimestampSql(sql`e.updated_at`)} as "updatedAt",
      e.match_fingerprint as "matchFingerprint",
      ${matchingIdentitySql} as "nativeMatchingOperation",e.match_method as "matchMethod",
      (select coalesce(jsonb_agg(to_jsonb(f) order by f.format,f.id),'[]'::jsonb)
        from ebook_files f where f.ebook_id=e.id) as "rawFiles",
      ${candidateSql} as candidates,
      (select jsonb_build_object('id',d.id,'title',d.title) from ebooks d where d.id=e.duplicate_of_id) as duplicate,
      case when w.id is null then null else jsonb_build_object('id',w.id,'title',w.title,
        'slug',coalesce(w.slug,w.id::text),'status',w.catalogue_status) end as work
      ${from} where ${filter} and ${reviewSectionSql(key)}
      order by ${key === "automatic" ? sql`e.matched_at desc,` : sql``}
        ${key === "not_in_durtal" ? sql`coalesce(e.author_sort,e.authors[1],''),` : sql``}
        coalesce(e.title_sort,e.title),e.id limit ${params.shown[key]}`));
    sections.push({ key, rows: rows.map(projectRow) });
  }
  return { counts, sections };
}
export async function getReviewQueue(params: ReviewParams): Promise<ReviewQueue> {
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, (conn) => loadReviewQueue(conn, params),
    { isolationLevel: "repeatable read" });
}
export async function getReviewWorkOptions(workId: string, ebookId: string): Promise<ReviewWorkOptions> {
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, async (conn) => {
    const [work] = resultRows<ReviewWorkOptions>(await conn.execute(sql`select w.id as "workId",w.title,
      (select count(*)::integer from editions re where re.work_id=w.id) as "editionCount",
      ${editionsSql(sql`w.id`, 200, true)} as editions,
      (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) order by l.sort_order,l.name,l.id),'[]'::jsonb)
        from locations l where l.type='digital' and l.is_active) as locations,
      (select coalesce(jsonb_agg(jsonb_build_object('isbn13',re.isbn_13,'workId',rw.id,'title',rw.title)),'[]'::jsonb)
        from editions re join works rw on rw.id=re.work_id
        where re.isbn_13=any(select unnest(e.isbns) from ebooks e where e.id=${ebookId}::uuid)) as "isbnHolders"
      from works w where w.id=${workId}::uuid and w.kind='book'`));
    if (!work) throw new ReviewError("ineligible_state", "Choose an existing book.");
    const { attachReviewCopyStampsOn } = await import("@/lib/ebooks/review/copy-stamps");
    return await attachReviewCopyStampsOn(conn, work);
  }, { isolationLevel: "repeatable read" });
}
/** Reverse chooser: one bounded query; standalone texts may be linked by the real service. */
export async function searchReviewEbooks(query: string): Promise<ReviewQueueRow[]> {
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, async (conn) => {
    const text = textSearchCondition(sql`e.search_text`, query, { fuzzy: false });
    const rows = resultRows<RawRow>(await conn.execute(sql`select e.id,e.title,e.subtitle,e.authors,e.language,
      e.series,e.series_index::text as "seriesIndex",e.publisher,e.published_year as year,e.isbns,e.identifiers,
      e.match_state as state,e.match_tier as tier,${reviewTimestampSql(sql`e.updated_at`)} as "updatedAt",
      e.match_fingerprint as "matchFingerprint",'[]'::jsonb as candidates,null::jsonb as duplicate,null::jsonb as work,
      (select coalesce(jsonb_agg(to_jsonb(f) order by f.format,f.id),'[]'::jsonb)
        from ebook_files f where f.ebook_id=e.id) as "rawFiles"
      from ebooks e where e.instance_id is null and e.match_state in ('pending','standalone')
        ${text ? sql`and ${text}` : sql``} order by coalesce(e.title_sort,e.title),e.id limit 30`));
    return rows.map(projectRow);
  }, { isolationLevel: "repeatable read" });
}
/** One guard read for an already validated bounded selection; no catalogue loader. */
export async function getReviewStamps(ebookIds: readonly string[]): Promise<Map<string, ReviewStamp>> {
  if (!ebookIds.length) return new Map();
  if (ebookIds.length > 50) throw new Error("A review selection is bounded to 50");
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, async (conn) => {
    const rows = resultRows<{ id: string; updatedAt: string | null; matchFingerprint: string | null }>(await conn.execute(sql`
      select e.id,${reviewTimestampSql(sql`e.updated_at`)} as "updatedAt",e.match_fingerprint as "matchFingerprint"
      from ebooks e where e.id in (${sql.join(ebookIds.map((id) => sql`${id}::uuid`), sql`,`)})`));
    return new Map(rows.flatMap(({ id, updatedAt, matchFingerprint }) => {
      const stamp = ebookReviewStampSchema.safeParse({ updatedAt, matchFingerprint });
      return stamp.success ? [[id, stamp.data] as const] : [];
    }));
  }, { isolationLevel: "repeatable read" });
}
/** UUID-keyset selection pages. At most 50 descriptors leave the server; the
 * extra read row is only a next-page sentinel. No plans or writers run here. */
export async function loadReviewSelectionPage(conn: Db, input: ReviewSelectionPageInput): Promise<{
  rows: ReviewQueueRow[]; count: number; nextCursor: string | null;
}> {
  const predicate = sql`${reviewFilterSql(input.filters)} and ${reviewSectionSql(input.section)}
    ${input.authorName ? sql`and cardinality(e.authors)=1 and e.authors[1]=${input.authorName}` : sql``}`;
  const [count] = resultRows<{ count: number }>(await conn.execute(sql`select count(*)::integer as count ${from} where ${predicate}`));
  const rows = resultRows<RawRow>(await conn.execute(sql`select e.id,e.title,e.subtitle,e.authors,e.language,
    e.series,e.series_index::text as "seriesIndex",e.publisher,e.published_year as year,e.isbns,e.identifiers,
    e.match_state as state,e.match_tier as tier,${reviewTimestampSql(sql`e.updated_at`)} as "updatedAt",
    e.match_fingerprint as "matchFingerprint",${candidateSql} as candidates,
    (select coalesce(jsonb_agg(to_jsonb(f) order by f.format,f.id),'[]'::jsonb) from ebook_files f where f.ebook_id=e.id) as "rawFiles",
    (select jsonb_build_object('id',d.id,'title',d.title) from ebooks d where d.id=e.duplicate_of_id) as duplicate,
    null::jsonb as work ${from} where ${predicate}
    ${input.cursor ? sql`and e.id>${input.cursor}::uuid` : sql``} order by e.id limit 51`));
  return { rows: rows.slice(0, 50).map(projectRow), count: Number(count?.count ?? 0),
    nextCursor: rows.length > 50 ? rows[49].id : null };
}
export async function getReviewSelectionPage(input: ReviewSelectionPageInput) {
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, (conn) => loadReviewSelectionPage(conn, input),
    { isolationLevel: "repeatable read" });
}
/** Existing-copy entry point: one private identity/stamp projection, no full
 * native receipt, catalogue snapshot or mutation service in the returned DTO. */
export async function loadReviewUnlinkTarget(conn: Db, ebookId: string): Promise<ReviewUnlinkTarget> {
  const [row] = resultRows<{ id: string; title: string; updatedAt: string; matchFingerprint: string | null;
    nativeMatchingOperation: unknown; matchMethod: string | null }>(await conn.execute(sql`
    select e.id,e.title,${reviewTimestampSql(sql`e.updated_at`)} as "updatedAt",e.match_fingerprint as "matchFingerprint",
      ${matchingIdentitySql} as "nativeMatchingOperation",e.match_method as "matchMethod"
    ${from} where e.id=${ebookId}::uuid and e.match_state='linked' and i.status<>'deaccessioned'`));
  if (!row) throw new ReviewError("ebook_not_found", "The linked eBook is unavailable.");
  const stamp = ebookReviewStampSchema.safeParse({ updatedAt: row.updatedAt, matchFingerprint: row.matchFingerprint });
  const identity = reviewOperationSchema.safeParse(row.nativeMatchingOperation);
  if (!stamp.success || !identity.success) throw new ReviewError("invalid_receipt", "The native link identity cannot be reviewed.");
  return { id: row.id, title: row.title, stamp: stamp.data, matching: { operation: identity.data,
    automatic: ["isbn", "identifier", "score"].includes(row.matchMethod ?? "") } };
}
export async function getReviewUnlinkTarget(ebookId: string) {
  return withReadOnlyPlanningConnection(serverEnv().DATABASE_URL, (conn) => loadReviewUnlinkTarget(conn, ebookId),
    { isolationLevel: "repeatable read" });
}
