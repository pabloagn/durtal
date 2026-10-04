/**
 * Book metadata enrichment (SLN-414): reading editions and writing a reviewed
 * plan. Every write fills a column only while it is still empty, takes only
 * `EDITION_FILL_COLUMNS` and `WORK_FILL_COLUMNS`, and records what it wrote,
 * so `undoEnrichment` can put back exactly that and nothing else.
 */
import type postgres from "postgres";
import {
  EDITION_FILL_COLUMNS,
  WORK_FILL_COLUMNS,
  BOOK_SOURCE_LABEL,
  editionUpdate,
  type BookSource,
  type EditionFillColumn,
  type EditionPlan,
  type EditionRow,
  type WorkFillColumn,
} from "./enrichment";
import { sourcePayloadHash } from "@/lib/publishers/enrichment";

/** A client or a transaction (pass a transaction as `tx as unknown as Sql`) */
type Sql = postgres.Sql;

/** One value a run wrote: undo clears it while it still holds that value */
export interface Written {
  table: "editions" | "works";
  id: string;
  column: EditionFillColumn | WorkFillColumn;
  value: string | number;
}

export interface EnrichmentUndo {
  runId: string;
  written: Written[];
}

const SOURCE_URL: Record<BookSource, (isbn: string) => string> = {
  isbndb: (isbn) => `https://isbndb.com/book/${isbn}`,
  open_library: (isbn) => `https://openlibrary.org/isbn/${isbn}`,
};

/**
 * Editions a run may fill: unlocked, not placeholders, with an ISBN, and
 * with at least one empty fill column (or a work with no description).
 */
export async function loadEnrichableEditions(
  sql: Sql,
  { limit, ids }: { limit?: number; ids?: string[] } = {},
): Promise<EditionRow[]> {
  const rows = await sql<
    {
      id: string;
      work_id: string;
      title: string;
      isbn_13: string | null;
      isbn_10: string | null;
      publisher: string | null;
      publication_year: number | null;
      page_count: number | null;
      language: string | null;
      binding: string | null;
      description: string | null;
      metadata_locked: boolean;
      metadata_source: string | null;
      work_title: string;
      work_description: string | null;
      work_original_year: number | null;
    }[]
  >`select e.id, e.work_id, e.title, e.isbn_13, e.isbn_10, e.publisher, e.publication_year,
      e.page_count, e.language, e.binding, e.description, e.metadata_locked, e.metadata_source,
      w.title as work_title, w.description as work_description, w.original_year as work_original_year
    from editions e join works w on w.id = e.work_id and w.kind = 'book'
    where not e.metadata_locked
      and coalesce(e.metadata_source, '') <> 'phantom_canon'
      and (e.isbn_13 is not null or e.isbn_10 is not null)
      and (nullif(btrim(e.description), '') is null or e.page_count is null
        or e.publication_year is null or e.binding is null
        or nullif(btrim(w.description), '') is null)
      ${ids?.length ? sql`and e.id in ${sql(ids)}` : sql``}
    order by w.title, e.id
    ${limit ? sql`limit ${limit}` : sql``}`;
  return rows.map((r) => ({
    id: r.id,
    workId: r.work_id,
    title: r.title,
    isbn13: r.isbn_13,
    isbn10: r.isbn_10,
    publisher: r.publisher,
    publicationYear: r.publication_year,
    pageCount: r.page_count,
    language: r.language,
    binding: r.binding,
    description: r.description,
    metadataLocked: r.metadata_locked,
    metadataSource: r.metadata_source,
    workTitle: r.work_title,
    workDescription: r.work_description,
    workOriginalYear: r.work_original_year,
  }));
}

/**
 * Writes one edition's fills and its provenance. A column another writer has
 * filled since the plan was made is left as it is.
 */
export async function applyEditionPlan(
  tx: Sql,
  plan: EditionPlan,
  { runId, retrievedAt, isbn }: { runId: string; retrievedAt: Date; isbn: string },
): Promise<Written[]> {
  const written: Written[] = [];
  const update = editionUpdate(plan);
  for (const column of EDITION_FILL_COLUMNS) {
    const value = update[column];
    if (value === undefined) continue;
    const empty =
      column === "description"
        ? tx`nullif(btrim(description), '') is null`
        : tx`${tx(column)} is null`;
    const rows = await tx`update editions set ${tx(column)} = ${value}, updated_at = now()
      where id = ${plan.editionId} and ${empty} returning id`;
    if (rows.length) written.push({ table: "editions", id: plan.editionId, column, value });
  }
  for (const fill of plan.workFills) {
    if (!(WORK_FILL_COLUMNS as readonly string[]).includes(fill.column))
      throw new Error(`Refusing to write works.${fill.column}`);
    const rows = await tx`update works set description = ${fill.value}, updated_at = now()
      where id = ${plan.workId} and nullif(btrim(description), '') is null returning id`;
    if (rows.length)
      written.push({ table: "works", id: plan.workId, column: fill.column, value: fill.value });
  }
  if (!written.length) return written;

  // One record per source whose values were used
  const bySource = new Map<BookSource, Record<string, string | number>>();
  for (const fill of [...plan.fills, ...plan.workFills])
    for (const source of fill.sources) {
      const fields = bySource.get(source) ?? {};
      fields[fill.column] = fill.value;
      bySource.set(source, fields);
    }
  for (const [source, fields] of bySource) {
    const payload = { runId, isbn, fields };
    // Sent as text and cast once: postgres.js would encode a jsonb value again,
    // and source_records takes only a JSON object
    await tx`insert into source_records (entity_kind, edition_id, provider, url, attribution,
        retrieved_at, verified_at, payload, payload_hash, review_status)
      values ('edition', ${plan.editionId}, ${source}, ${SOURCE_URL[source](isbn)},
        ${BOOK_SOURCE_LABEL[source]}, ${retrievedAt.toISOString()}, ${retrievedAt.toISOString()},
        ${JSON.stringify(payload)}::text::jsonb, ${sourcePayloadHash(payload)}, 'accepted')`;
  }
  return written;
}

/** Puts back what a run wrote, where it still holds the run's value */
export async function undoEnrichment(tx: Sql, undo: EnrichmentUndo) {
  let restored = 0;
  for (const w of undo.written) {
    const rows =
      w.table === "editions"
        ? await tx`update editions set ${tx(w.column)} = null, updated_at = now()
            where id = ${w.id} and ${tx(w.column)} = ${w.value} returning id`
        : await tx`update works set description = null, updated_at = now()
            where id = ${w.id} and description = ${String(w.value)} returning id`;
    restored += rows.length;
  }
  await tx`delete from source_records where entity_kind = 'edition'
    and provider in ('isbndb', 'open_library') and payload->>'runId' = ${undo.runId}`;
  return restored;
}

/** Holes per field, read-only: what a run could fill */
export async function assessBookMetadata(sql: Sql) {
  const [counts] = await sql<
    {
      editions: number;
      locked: number;
      placeholders: number;
      without_isbn: number;
      no_description: number;
      no_pages: number;
      no_year: number;
      no_publisher: number;
      no_binding: number;
      no_language: number;
      no_dimensions: number;
      works: number;
      works_no_description: number;
      works_no_original_year: number;
    }[]
  >`select
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book') as editions,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.metadata_locked) as locked,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.metadata_source = 'phantom_canon') as placeholders,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.isbn_13 is null and e.isbn_10 is null) as without_isbn,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where nullif(btrim(e.description), '') is null) as no_description,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.page_count is null) as no_pages,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.publication_year is null) as no_year,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where nullif(btrim(e.publisher), '') is null) as no_publisher,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.binding is null) as no_binding,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.language is null) as no_language,
      (select count(*)::int from editions e join works w on w.id = e.work_id and w.kind = 'book' where e.height_mm is null and e.width_mm is null) as no_dimensions,
      (select count(*)::int from works where kind = 'book') as works,
      (select count(*)::int from works where kind = 'book' and nullif(btrim(description), '') is null) as works_no_description,
      (select count(*)::int from works where kind = 'book' and original_year is null) as works_no_original_year`;
  const suspectYears = await sql<
    { id: string; title: string; original_year: number; years: number[] }[]
  >`select w.id, w.title, w.original_year,
      array_agg(e.publication_year order by e.publication_year) filter (where e.publication_year is not null) as years
    from works w join editions e on e.work_id = w.id
    where w.kind = 'book' and w.original_year is not null
    group by w.id
    having w.original_year >= min(e.publication_year)
    order by w.title`;
  return { counts, suspectYears };
}
