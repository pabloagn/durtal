import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { IMPORT_SECTIONS, type ImportDecision, type ImportMatch, type ImportSection } from "./match-rules";
import type { ImportErrorLog, ImportStatus, Written } from "./store";
import type { ImportReading, ImportRow, ImportSource } from "./types";
import { readingsCommitted, readingsUncommittedSql } from "./notes";
import { workCoverSql } from "@/lib/library/filter-conditions";
import { previewGoodreadsClaimsSql } from "@/lib/catalogue/goodreads-identity";

/*
 * What the import pages read (SLN-450). The preview reads each section's
 * first rows only (50, or the count in the URL), so a 2,000-row file stays
 * within the page budget; the counts and the commit line cover every row.
 * Reviews and private notes stay in the database: a row says it has them.
 */

export const SECTION_PAGE = 50;
export const SECTION_MAX = 5000;

/** The sources whose imports the reading pages list and preview */
export const IMPORT_SOURCES = sql`('goodreads', 'storygraph', 'durtal', 'ebook_library')`;

export interface ImportListItem {
  id: string;
  source: ImportSource;
  status: ImportStatus;
  fileName: string | null;
  createdAt: string;
  totalRecords: number;
  processedRecords: number;
  skippedRecords: number;
  errorRecords: number;
  rawKept: boolean;
  readings: number;
  /** Up next items it added (SLN-452) */
  queued: number;
  /** Notes it wrote from private notes (SLN-453) */
  notes: number;
  /** Book ratings it set (SLN-658) */
  ratings: number;
  /** Goodreads identities newly recorded by this import */
  identifiers: number;
  /** Rows with a recorded claim but no reading/queue outcome, including reused IDs. */
  pendingClaims: number;
}

/** The reading imports, newest first */
export async function listReadingImports(limit = 100): Promise<ImportListItem[]> {
  return resultRows<ImportListItem>(
    await db.execute(sql`
      select i.id::text as id, i.source, i.status, i.file_name as "fileName", i.created_at::text as "createdAt",
        coalesce(i.total_records, 0) as "totalRecords", i.processed_records as "processedRecords",
        i.skipped_records as "skippedRecords", i.error_records as "errorRecords",
        i.s3_bronze_key is not null as "rawKept",
        (select count(*) from readings r where r.import_id = i.id)::int as readings,
        (select count(*) from reading_queue q where q.import_id = i.id)::int as queued,
        (select count(*) from reading_notes n where n.import_id = i.id)::int as notes,
        (select count(*) from reading_import_rows x where x.import_id = i.id and coalesce(x.written->'bookRating', 'null'::jsonb) <> 'null'::jsonb)::int as ratings,
        (select coalesce(sum(jsonb_array_length(x.written->'identifiers')), 0) from reading_import_rows x
          where x.import_id = i.id and jsonb_typeof(x.written->'identifiers') = 'array')::int as identifiers,
        (select count(*) from reading_import_rows x where x.import_id = i.id
          and jsonb_typeof(x.written->'goodreadsClaim') = 'object' and ${readingsUncommittedSql("x")})::int as "pendingClaims"
      from imports i
      where i.source in ${IMPORT_SOURCES}
      order by i.created_at desc, i.id
      limit ${limit}`),
  );
}

export interface ImportHeader extends ImportListItem {
  errorLog: ImportErrorLog | null;
}

export interface ImportSummary {
  rows: number;
  sections: Record<ImportSection, number>;
  wantToRead: number;
  /** Rows with a Goodreads private note (SLN-453) */
  privateNotes: number;
  extras: number;
  /** Rows still pending in the sections that need a decision */
  pending: number;
  written: number;
  /** Rows that could be imported and have no book yet: Match again shows while there are some */
  noBook: number;
  ratingsDiffer: number;
  /** Readings the commit button would write */
  toImport: number;
  /** E-book library ratings the commit would write to their books (SLN-658) */
  toRate: number;
  /** To-read rows the commit would add to Up next (SLN-452) */
  toQueue: number;
  /** To-read rows on shelves that are not imported */
  otherShelves: number;
  /** New Goodreads identities the current accepted rows would record */
  identifiers: number;
}

export interface PreviewBook {
  workId: string;
  title: string;
  slug: string | null;
  author: string | null;
  year: number | null;
  cover: string | null;
  rating: number | null;
  /** The matched edition's Goodreads id is empty */
  editionWithoutGoodreads: boolean;
}

export type PreviewReading = Omit<ImportReading, "reviewHtml"> & { hasReview: boolean };

export interface PreviewRow {
  rowNo: number;
  section: ImportSection;
  data: Omit<ImportRow, "reviewHtml" | "privateNotes" | "readings"> & { readings: PreviewReading[]; hasNotes: boolean };
  match: ImportMatch;
  decision: ImportDecision;
  useFileRating: boolean;
  written: Written | null;
  book: PreviewBook | null;
  candidates: (PreviewBook & { score: number; byAuthor: boolean })[];
}

export interface ImportPreview {
  header: ImportHeader;
  summary: ImportSummary;
  sections: Record<ImportSection, PreviewRow[]>;
}

const bookColumns = (w: string, e: string) => sql`${sql.raw(`
  ${w}.id::text as "workId", ${w}.title, ${w}.slug, ${w}.original_year as year, ${w}.rating::float8 as rating,
  (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${w}.id order by wa.sort_order, a.name limit 1) as author,
  coalesce((select coalesce(ce.thumbnail_s3_key, ce.cover_s3_key) from editions ce where ce.id = ${e}),`)}
    ${workCoverSql(sql.raw(`${w}.id`))}) as cover`;

/** The import, its counts, and each section's first rows (`limits` per section, 50 by default) */
export async function getImportPreview(importId: string, limits: Partial<Record<ImportSection, number>> = {}): Promise<ImportPreview | null> {
  const [header] = resultRows<ImportHeader>(
    await db.execute(sql`
      select i.id::text as id, i.source, i.status, i.file_name as "fileName", i.created_at::text as "createdAt",
        coalesce(i.total_records, 0) as "totalRecords", i.processed_records as "processedRecords",
        i.skipped_records as "skippedRecords", i.error_records as "errorRecords",
        i.s3_bronze_key is not null as "rawKept", i.error_log as "errorLog",
        (select count(*) from readings r where r.import_id = i.id)::int as readings,
        (select count(*) from reading_queue q where q.import_id = i.id)::int as queued,
        (select count(*) from reading_notes n where n.import_id = i.id)::int as notes,
        (select count(*) from reading_import_rows x where x.import_id = i.id and coalesce(x.written->'bookRating', 'null'::jsonb) <> 'null'::jsonb)::int as ratings,
        (select coalesce(sum(jsonb_array_length(x.written->'identifiers')), 0) from reading_import_rows x
          where x.import_id = i.id and jsonb_typeof(x.written->'identifiers') = 'array')::int as identifiers,
        (select count(*) from reading_import_rows x where x.import_id = i.id
          and jsonb_typeof(x.written->'goodreadsClaim') = 'object' and ${readingsUncommittedSql("x")})::int as "pendingClaims"
      from imports i where i.id = ${importId}::uuid and i.source in ${IMPORT_SOURCES}`),
  );
  if (!header) return null;
  // A row whose readings are not committed; its private note may be (SLN-453)
  const open = readingsUncommittedSql("r");
  const caps = Object.fromEntries(IMPORT_SECTIONS.map((s) => [s, Math.min(SECTION_MAX, Math.max(SECTION_PAGE, limits[s] ?? SECTION_PAGE))]));

  const [counts, totalsResult, rows, idCounts] = await Promise.all([
    db.execute(sql`
      select r.match->>'section' as section, count(*)::int as n
      from reading_import_rows r where r.import_id = ${importId}::uuid group by 1`),
    db.execute(sql`
      select count(*)::int as rows,
        count(*) filter (where r.data->>'kind' = 'to_read')::int as "wantToRead",
        count(*) filter (where r.data->>'privateNotes' is not null)::int as "privateNotes",
        count(*) filter (where r.data->'extras' <> '{}'::jsonb)::int as extras,
        count(*) filter (where r.decision = 'pending' and ${open} and r.match->>'section' in ('choose', 'likely', 'none', 'exact', 'to_read'))::int as pending,
        count(*) filter (where r.decision = 'import' and ${open} and r.work_id is not null and r.match->>'section' = 'to_read')::int as "toQueue",
        count(*) filter (where r.data->>'kind' = 'to_read' and r.data->>'queueKey' is null)::int as "otherShelves",
        count(*) filter (where not ${open})::int as written,
        count(*) filter (where r.work_id is null and ${open} and r.match->>'section' in ('choose', 'none'))::int as "noBook",
        count(*) filter (where ${open} and r.work_id is not null and r.data->>'rating' is not null and w.rating is not null
          and w.rating <> (r.data->>'rating')::numeric and r.match->>'section' not in ('present', 'cannot', 'not_imported', 'to_read'))::int as "ratingsDiffer",
        coalesce(sum(case when r.decision = 'import' and ${open} and r.work_id is not null then
          (select count(*) from jsonb_array_elements(r.match->'verdicts') v
            where v->>'verdict' = 'new' or (r.match->>'section' = 'present'
              and v->>'reason' in ('Undated read', 'Another read in Durtal', 'Being read in Durtal')))
          else 0 end), 0)::int as "toImport",
        count(*) filter (where r.decision = 'import' and ${open} and r.work_id is not null
          and (r.match->>'rating' = 'set' or (r.match->>'rating' = 'differs' and r.use_file_rating))
          and r.match->>'section' not in ('present', 'cannot', 'not_imported', 'to_read'))::int as "toRate",
        0::int as identifiers
      from reading_import_rows r
      left join works w on w.id = r.work_id
      left join editions e on e.id = (r.match->>'editionId')::uuid
      where r.import_id = ${importId}::uuid`),
    db.execute(sql`
      select r.row_no as "rowNo", r.section, r.match, r.decision, r.use_file_rating as "useFileRating", r.written,
        (r.data - 'reviewHtml' - 'privateNotes') || jsonb_build_object(
          'hasNotes', r.data->>'privateNotes' is not null,
          'readings', coalesce((select jsonb_agg((x - 'reviewHtml') || jsonb_build_object('hasReview', x->>'reviewHtml' is not null) order by o)
            from jsonb_array_elements(r.data->'readings') with ordinality as t(x, o)), '[]'::jsonb)) as data,
        case when w.id is null then null else jsonb_build_object(
          'workId', w.id, 'title', w.title, 'slug', w.slug, 'year', w.original_year, 'rating', w.rating::float8,
          'author', (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order, a.name limit 1),
          'cover', coalesce((select coalesce(ce.thumbnail_s3_key, ce.cover_s3_key) from editions ce where ce.id = (r.match->>'editionId')::uuid),
            ${workCoverSql(sql`w.id`)}),
          'editionWithoutGoodreads', exists (select 1 from editions ce where ce.id = (r.match->>'editionId')::uuid and ce.goodreads_id is null)
        ) end as book
      from (
        select r.*, r.match->>'section' as section,
          row_number() over (partition by r.match->>'section' order by r.row_no) as rn
        from reading_import_rows r where r.import_id = ${importId}::uuid
      ) r
      left join works w on w.id = r.work_id
      where r.rn <= (${JSON.stringify(caps)}::jsonb->>r.section)::int
      order by r.row_no`),
    db.execute(previewGoodreadsClaimsSql(importId)),
  ]);

  const [totals] = resultRows<Omit<ImportSummary, "sections">>(totalsResult);
  const sections = Object.fromEntries(IMPORT_SECTIONS.map((s) => [s, 0])) as Record<ImportSection, number>;
  for (const c of resultRows<{ section: ImportSection; n: number }>(counts)) if (c.section in sections) sections[c.section] = c.n;
  // A row with only its note written shows as not committed: its readings can still be
  const shown = resultRows<Omit<PreviewRow, "candidates">>(rows).map((r) => (readingsCommitted(r.written) || r.written?.goodreadsClaim ? r : { ...r, written: null }));

  // The candidates of the "To choose" rows shown, in one query
  const candidateIds = [...new Set(shown.flatMap((r) => (r.section === "choose" ? r.match.candidates.map((c) => c.workId) : [])))];
  const candidateBooks = new Map(
    candidateIds.length
      ? resultRows<PreviewBook>(
          await db.execute(sql`
            select ${bookColumns("w", "null::uuid")}, false as "editionWithoutGoodreads"
            from works w where w.kind = 'book' and w.id in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(candidateIds)}::jsonb))`),
        ).map((b) => [b.workId, b])
      : [],
  );
  const byRow = Object.fromEntries(IMPORT_SECTIONS.map((s) => [s, [] as PreviewRow[]])) as Record<ImportSection, PreviewRow[]>;
  for (const r of shown) {
    const candidates = r.section === "choose"
      ? r.match.candidates.flatMap((c) => {
          const b = candidateBooks.get(c.workId);
          return b ? [{ ...b, score: c.score, byAuthor: c.byAuthor }] : [];
        })
      : [];
    byRow[r.section]?.push({ ...r, candidates });
  }
  return { header, summary: { ...totals, identifiers: resultRows<{ count: number }>(idCounts)[0]?.count ?? 0, sections }, sections: byRow };
}
