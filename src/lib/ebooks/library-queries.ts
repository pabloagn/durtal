import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import {
  continueTarget,
  underway,
  validContinueAnchor,
  type ContinueAnchor,
  type ContinueDescriptor,
  type ContinueFile,
} from "./continue-target";
import {
  ebookFileNativeReadableCondition,
  isEbookFileNativeReadable,
} from "./conditions";
import type { EbookLibraryParams } from "./library-params";
import type { MatchEbook } from "./match/types";
import { reviewTimestampSql } from "./review/store-sql";
import { ebookReviewStampSchema } from "@/lib/validations/ebook-review";
import type { ReviewStamp } from "./review-queue/types";

type Database = { execute(query: SQL): PromiseLike<unknown> };
export interface LibraryFile extends ContinueFile {
  manifestKey: string | null;
  coverKey: string | null;
  verifiedAt: string | null;
  quarantineReason: string | null;
  sourceHost: string | null;
  sourcePath: string | null;
}
export interface LibraryEbook {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  language: string | null;
  matchState: "pending" | "linked" | "standalone" | "excluded";
  preferredFileId: string | null;
  coverKey: string | null;
  createdAt: string;
  files: LibraryFile[];
}
export interface EbookLibraryCounts {
  total: number;
  active: number;
  review: number;
  excluded: number;
  languages: string[];
  formats: string[];
}
export interface EbookDetail extends LibraryEbook {
  reviewStamp: ReviewStamp | null;
  matchTier: string | null;
  workId: string | null;
  workStatus: string | null;
  exclusionReason: NonNullable<MatchEbook["exclusionReason"]> | null;
  series: string | null;
  seriesIndex: string | null;
  publisher: string | null;
  publicationYear: number | null;
  description: string | null;
  isbns: string[];
  identifiers: Record<string, string[]>;
  workSlug: string | null;
  workTitle: string | null;
  instanceId: string | null;
  editionId: string | null;
  editionPublisher: string | null;
  editionYear: number | null;
  positions: ContinueAnchor[];
  history: {
    id: string;
    runId: string;
    createdAt: string;
    host: string | null;
    path: string;
    outcome: string | null;
    reason: string | null;
  }[];
  historyTotal: number;
}
const fileColumns = {
  status: sql`f.status`,
  drm: sql`f.drm`,
  s3Key: sql`f.s3_key`,
  sha256: sql`f.sha256`,
  sizeBytes: sql`f.size_bytes`,
  format: sql`f.format`,
  metadata: sql`f.metadata`,
  manifestKey: sql`f.manifest_key`,
};
// Only rows on the requested page collect files. Metadata never reaches card props.
const files = sql`coalesce((select json_agg(json_build_object(
  'id', f.id, 'ebookId', f.ebook_id, 'format', f.format, 'sizeBytes', f.size_bytes,
  'status', f.status, 'drm', f.drm, 'sha256', f.sha256, 's3Key', f.s3_key,
  'metadata', f.metadata, 'manifestKey', f.manifest_key, 'coverKey', f.cover_key,
  'verifiedAt', f.verified_at, 'quarantineReason', f.metadata->>'problem',
  'sourceHost', f.source_host, 'sourcePath', f.source_path, 'createdAt', f.created_at
) order by f.created_at, f.id) from ebook_files f where f.ebook_id = e.id), '[]'::json)`;
const positions = sql`coalesce((select json_agg(json_build_object(
  'deviceId', p.device_id, 'deviceLabel', p.device_label, 'fileId', p.file_id,
  'locator', p.locator, 'chapter', p.chapter, 'clientUpdatedAt', p.client_updated_at
) order by p.client_updated_at desc, p.device_id, p.file_id)
from ebook_positions p where p.ebook_id = e.id), '[]'::json)`;
/** The card columns of an e-book row aliased `e`, with its files (shared with /ebooks/highlights). */
export const ebookSummaryColumns = sql`e.id, e.title, e.subtitle, e.authors, e.language,
  e.match_state as "matchState", e.preferred_file_id as "preferredFileId",
  e.cover_key as "coverKey", e.created_at as "createdAt", ${files} as files`;

export function normalizedDates<T extends LibraryEbook>(ebook: T): T {
  return {
    ...ebook,
    createdAt: new Date(ebook.createdAt).toISOString(),
    files: ebook.files.map((file) => ({
      ...file,
      createdAt: new Date(file.createdAt).toISOString(),
    })),
  };
}

export function ebookLibraryWhere(params: EbookLibraryParams): SQL {
  const clauses: SQL[] = [
    params.state === "excluded"
      ? sql`e.match_state = 'excluded'`
      : sql`e.match_state <> 'excluded'`,
  ];
  if (params.normalizedSearch)
    for (const word of params.normalizedSearch.split(" ").filter(Boolean))
      clauses.push(
        // A linked e-book is also found by its book's title and authors (SLN-683)
        sql`(e.search_text ilike ${`%${word}%`} or ${word} <% e.search_text
          or exists (select 1 from instances copy join editions edition on edition.id = copy.edition_id
            join works w on w.id = edition.work_id
            where copy.id = e.instance_id and e.match_state = 'linked'
              and (public.search_normalize(w.title || ' ' || coalesce(w.original_title, '')) ilike ${`%${word}%`}
                or exists (select 1 from work_authors wa join authors a on a.id = wa.author_id
                  where wa.work_id = w.id and a.search_text ilike ${`%${word}%`}))))`,
      );
  if (params.linked.length) {
    const states = params.linked.map((value) =>
      value === "unlinked" ? "pending" : value,
    );
    clauses.push(
      sql`e.match_state in (${sql.join(
        states.map((value) => sql`${value}`),
        sql`, `,
      )})`,
    );
  }
  if (params.formats.length)
    clauses.push(sql`exists (select 1 from ebook_files f where f.ebook_id = e.id
    and f.format in (${sql.join(
      params.formats.map((value) => sql`${value}`),
      sql`, `,
    )}))`);
  if (params.languages.length)
    clauses.push(
      sql`e.language in (${sql.join(
        params.languages.map((value) => sql`${value}`),
        sql`, `,
      )})`,
    );
  if (params.drm !== null)
    clauses.push(sql`${params.drm ? sql`` : sql`not `} exists
    (select 1 from ebook_files f where f.ebook_id = e.id and f.drm is not null)`);
  if (params.needsReview !== null)
    clauses.push(
      params.needsReview
        ? sql`e.match_state = 'pending'`
        : sql`e.match_state <> 'pending'`,
    );
  return sql.join(clauses, sql` and `);
}
function ordering(params: EbookLibraryParams): SQL {
  const direction = params.order === "desc" ? sql`desc` : sql`asc`;
  const sorts = {
    title: sql`e.title_sort collate "C"`,
    author: sql`coalesce(e.author_sort, array_to_string(e.authors, ', ')) collate "C"`,
    added: sql`e.created_at`,
    opened: sql`(select max(p.client_updated_at) from ebook_positions p where p.ebook_id = e.id)`,
    size: sql`(select coalesce(sum(f.size_bytes), 0) from ebook_files f where f.ebook_id = e.id)`,
    format: sql`(select min(f.format) from ebook_files f where f.ebook_id = e.id)`,
    language: sql`e.language collate "C"`,
    linked: sql`e.match_state collate "C"`,
  };
  const ranked =
    params.normalizedSearch && !params.explicitSort
      ? sql`word_similarity(${params.normalizedSearch}, e.search_text) desc, `
      : sql``;
  return sql`${ranked}${sorts[params.sort]} ${direction} nulls last, e.id asc`;
}
export async function getEbooksPage(
  params: EbookLibraryParams,
  database: Database = db,
): Promise<LibraryEbook[]> {
  return resultRows<LibraryEbook>(
    await database.execute(ebookLibraryPageQuery(params)),
  ).map(normalizedDates);
}
/** Shared with EXPLAIN acceptance: exactly the query used by the page. */
export function ebookLibraryPageQuery(params: EbookLibraryParams): SQL {
  return sql`with page as (
    select e.* from ebooks e where ${ebookLibraryWhere(params)}
    order by ${ordering(params)} limit ${params.perPage} offset ${params.offset}
  ) select ${ebookSummaryColumns} from page e order by ${ordering(params)}`;
}
export async function getEbookLibraryCounts(
  params: EbookLibraryParams,
  database: Database = db,
): Promise<EbookLibraryCounts> {
  const facetState =
    params.state === "excluded"
      ? sql`e.match_state = 'excluded'`
      : sql`e.match_state <> 'excluded'`;
  const fileFacetState =
    params.state === "excluded"
      ? sql`book.match_state = 'excluded'`
      : sql`book.match_state <> 'excluded'`;
  const [row] = resultRows<EbookLibraryCounts>(
    await database.execute(sql`select
    (select count(*)::integer from ebooks e where ${ebookLibraryWhere(params)}) as total,
    count(*) filter (where e.match_state <> 'excluded')::integer as active,
    count(*) filter (where e.match_state = 'pending')::integer as review,
    count(*) filter (where e.match_state = 'excluded')::integer as excluded,
    coalesce(array_agg(distinct e.language order by e.language) filter (where e.language is not null and ${facetState}), '{}'::text[]) as languages,
    coalesce((select array_agg(distinct f.format order by f.format) from ebook_files f
      join ebooks book on book.id = f.ebook_id where ${fileFacetState}), '{}'::text[]) as formats
  from ebooks e`),
  );
  return row;
}
/**
 * A saved place that is being read, as `underway` decides it, in SQL: a
 * locator whose numbers are not numbers is not.
 */
const underwayPosition = sql`case when jsonb_typeof(p.locator->'sectionIndex') = 'number'
    and jsonb_typeof(p.locator->'progression') = 'number' and jsonb_typeof(p.locator->'totalProgression') = 'number'
  then (p.locator->>'totalProgression')::float8 < 0.995
    and not ((p.locator->>'sectionIndex')::float8 = 0 and (p.locator->>'progression')::float8 = 0)
  else false end`;
export async function getContinueReading(
  deviceId: string | null,
  database: Database = db,
): Promise<{ ebook: LibraryEbook; descriptor: ContinueDescriptor; bookTitle: string | null; bookAuthors: string[] | null }[]> {
  // Exclude books with no eligible target before LIMIT so obsolete positions do not crowd out readable books,
  // and count only places being read, so books merely opened or finished do not crowd them out either.
  const rows = resultRows<LibraryEbook & { positions: ContinueAnchor[]; bookTitle: string | null; bookAuthors: string[] | null }>(
    await database.execute(sql`with recent as (
    select e.id, max(p.client_updated_at) as opened from ebooks e join ebook_positions p on p.ebook_id = e.id
    where e.match_state <> 'excluded' and ${underwayPosition} and exists (select 1 from ebook_files f where f.ebook_id = e.id
      and ${ebookFileNativeReadableCondition(fileColumns)})
    group by e.id order by opened desc, e.id limit 12
  ) select ${ebookSummaryColumns}, ${positions} as positions,
    -- A linked e-book goes by its book's title and authors (SLN-683)
    book.title as "bookTitle", book.authors as "bookAuthors"
  from recent join ebooks e on e.id = recent.id
  left join lateral (select w.title, (select array_agg(a.name order by wa.sort_order, a.name) from work_authors wa
      join authors a on a.id = wa.author_id where wa.work_id = w.id and wa.role in ('author', 'co_author')) as authors
    from instances copy join editions edition on edition.id = copy.edition_id join works w on w.id = edition.work_id
    where copy.id = e.instance_id and e.match_state = 'linked') book on true
  order by recent.opened desc, e.id`),
  );
  return rows.map(normalizedDates).flatMap((ebook) => {
    const descriptor = continueTarget({
      ebookId: ebook.id,
      excluded: false,
      deviceId,
      preferredFileId: ebook.preferredFileId,
      files: ebook.files,
      // A device that only opened the book does not hide another device's place in it
      positions: ebook.positions.filter((position) => !!position?.locator && underway(position)),
    });
    const { bookTitle, bookAuthors, ...rest } = ebook;
    return descriptor?.anchor
      ? [{ ebook: rest, descriptor, bookTitle: bookTitle ?? null, bookAuthors: bookAuthors ?? null }]
      : [];
  });
}
export async function getEbookDetail(
  id: string,
  database: Database = db,
): Promise<EbookDetail | null> {
  const [row] = resultRows<EbookDetail>(
    await database.execute(sql`select ${ebookSummaryColumns}, e.series,
    e.series_index as "seriesIndex", e.publisher, e.published_year as "publicationYear", e.description, e.isbns, e.identifiers,
    e.exclusion_reason as "exclusionReason", e.match_tier as "matchTier",
    json_build_object('updatedAt', ${reviewTimestampSql(sql`e.updated_at`)},
      'matchFingerprint', e.match_fingerprint) as "reviewStamp",
    w.id as "workId", w.catalogue_status as "workStatus",
    w.slug as "workSlug", w.title as "workTitle", e.instance_id as "instanceId", edition.id as "editionId",
    edition.publisher as "editionPublisher", edition.publication_year as "editionYear",
    ${positions} as positions,
    (select count(*)::integer from ebook_ingest_items item where item.ebook_id = e.id) as "historyTotal",
    coalesce((select json_agg(history order by history."createdAt" desc, history.id) from (
      select item.id, item.run_id as "runId", item.created_at as "createdAt", run.host,
        item.source_path as path, item.outcome, item.reason
      from ebook_ingest_items item join ebook_ingest_runs run on run.id = item.run_id
      where item.ebook_id = e.id order by item.created_at desc, item.id limit 20
    ) history), '[]'::json) as history
    from ebooks e left join instances copy on copy.id = e.instance_id
    left join editions edition on edition.id = copy.edition_id left join works w on w.id = edition.work_id
    where e.id = ${id}::uuid`),
  );
  const stamp = ebookReviewStampSchema.safeParse(row?.reviewStamp);
  return row
    ? normalizedDates({
        ...row,
        reviewStamp: stamp.success ? stamp.data : null,
        positions: row.positions.filter((place) =>
          validContinueAnchor(
            place,
            row.files.find((file) => file.id === place.fileId),
          ),
        ),
      })
    : null;
}
export function ebookReadHref(ebook: LibraryEbook): string | null {
  const descriptor = continueTarget({
    ebookId: ebook.id,
    excluded: ebook.matchState === "excluded",
    preferredFileId: ebook.preferredFileId,
    deviceId: null,
    files: ebook.files,
    positions: [],
  });
  return descriptor?.href ?? null;
}
export function availableFormats(ebook: LibraryEbook): string[] {
  return [...new Set(ebook.files.map((file) => file.format))];
}
export function readableFiles(ebook: LibraryEbook): LibraryFile[] {
  return ebook.files.filter(isEbookFileNativeReadable);
}
