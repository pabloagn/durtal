import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import type { ReadingDatePrecision, ReadingStatus } from "../constants";
import type { ExistingReading } from "../duplicates";
import {
  bookVerdicts,
  CANDIDATE_THRESHOLD,
  judgeCandidates,
  matchTitle,
  sectionOf,
  type FoundHow,
  type ImportMatch,
  type MatchCandidate,
} from "./match-rules";
import type { ImportRow, ImportSource } from "./types";

/*
 * Matching an import's rows to books (SLN-450), books only. In order, the
 * first confident answer wins: the Durtal work id; a reading that already has
 * one of the row's source keys (an earlier import of the same file, so a book
 * chosen by hand is remembered); the Goodreads Book Id (an
 * edition's goodreads_id or a goodreads catalogue identifier); the id in a
 * book's Goodreads link; an ISBN. Then title and author: the file's title
 * against every title a book is known by (its own and its editions', so an
 * English Goodreads title finds a book catalogued by its original title),
 * compared with strict_word_similarity both ways after search_normalize, for
 * the books whose author's surname matches; a book with the same title and
 * another author is only ever a candidate. Every step is one query per batch
 * of rows, never one per row.
 */

const BATCH = 1000;

export interface RowMatch {
  found: FoundHow;
  workId: string | null;
  reason: string | null;
  editionId: string | null;
  instanceId: string | null;
  candidates: MatchCandidate[];
  warnings: string[];
}

const json = (value: unknown) => JSON.stringify(value);
const unique = <T>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x != null && x !== ""))];
function batches<T>(xs: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** The Durtal ids the rows name that exist: books, editions with their book, copies with their edition */
async function durtalIds(rows: ImportRow[]) {
  const works = new Set<string>();
  const editions = new Map<string, string>();
  const instances = new Map<string, string>();
  const w = unique(rows.map((r) => r.workId));
  const e = unique(rows.map((r) => r.editionId));
  const i = unique(rows.map((r) => r.instanceId));
  if (!w.length && !e.length && !i.length) return { works, editions, instances };
  const found = resultRows<{ kind: string; id: string; parent: string | null }>(
    await db.execute(sql`
      select 'work' as kind, w.id::text as id, null as parent from works w
        where w.id in (select value::uuid from jsonb_array_elements_text(${json(w)}::jsonb)) and w.kind = 'book'
      union all
      select 'edition', e.id::text, e.work_id::text from editions e
        where e.id in (select value::uuid from jsonb_array_elements_text(${json(e)}::jsonb))
      union all
      select 'instance', i.id::text, i.edition_id::text from instances i
        where i.id in (select value::uuid from jsonb_array_elements_text(${json(i)}::jsonb))`),
  );
  for (const f of found) {
    if (f.kind === "work") works.add(f.id);
    else if (f.kind === "edition") editions.set(f.id, f.parent!);
    else instances.set(f.id, f.parent!);
  }
  return { works, editions, instances };
}

interface IdHit {
  key: string;
  workId: string;
  editionId: string | null;
  reason: "Same source" | "Same Goodreads id" | "Same Goodreads link" | "Same ISBN";
}

/** Books that already hold a reading with one of these keys: an earlier import's book, chosen or matched */
async function sourceKeyHits(keys: string[]): Promise<IdHit[]> {
  const hits: IdHit[] = [];
  for (const batch of batches(keys)) {
    hits.push(
      ...resultRows<IdHit>(
        await db.execute(sql`
          select r.source_key as key, r.work_id::text as "workId", r.edition_id::text as "editionId", 'Same source' as reason
          from readings r join works w on w.id = r.work_id and w.kind = 'book'
          where r.source_key in (select value from jsonb_array_elements_text(${json(batch)}::jsonb))`),
      ),
    );
  }
  return hits;
}

/** Books by Goodreads Book Id: an edition's goodreads_id, a goodreads identifier, the id in a Goodreads link */
async function goodreadsHits(ids: string[]): Promise<IdHit[]> {
  const hits: IdHit[] = [];
  for (const batch of batches(ids)) {
    hits.push(
      ...resultRows<IdHit>(
        await db.execute(sql`
          with ids as (select value as id from jsonb_array_elements_text(${json(batch)}::jsonb))
          select e.goodreads_id as key, e.work_id::text as "workId", e.id::text as "editionId", 'Same Goodreads id' as reason
            from editions e join works w on w.id = e.work_id and w.kind = 'book'
            where e.goodreads_id in (select id from ids)
          union
          select ci.external_id, coalesce(ci.work_id, ce.work_id)::text, ci.edition_id::text, 'Same Goodreads id'
            from catalogue_identifiers ci
            left join editions ce on ce.id = ci.edition_id
            join works w on w.id = coalesce(ci.work_id, ce.work_id) and w.kind = 'book'
            where ci.provider = 'goodreads' and ci.external_id in (select id from ids)
          union
          select substring(w.goodreads_url from '/book/show/(\\d+)'), w.id::text, null, 'Same Goodreads link'
            from works w
            where w.kind = 'book' and substring(w.goodreads_url from '/book/show/(\\d+)') in (select id from ids)`),
      ),
    );
  }
  return hits;
}

/** Books by ISBN-13 or ISBN-10 */
async function isbnHits(isbns: string[]): Promise<IdHit[]> {
  const hits: IdHit[] = [];
  for (const batch of batches(isbns)) {
    hits.push(
      ...resultRows<IdHit>(
        await db.execute(sql`
          with ids as (select value as id from jsonb_array_elements_text(${json(batch)}::jsonb))
          select k.id as key, e.work_id::text as "workId", e.id::text as "editionId", 'Same ISBN' as reason
            from editions e
            join works w on w.id = e.work_id and w.kind = 'book'
            join ids k on k.id in (replace(e.isbn_13, '-', ''), upper(replace(e.isbn_10, '-', '')))`),
      ),
    );
  }
  return hits;
}

/** Title and author candidates for each row index, one query per batch */
async function titleCandidates(entries: { i: number; title: string; author: string }[]): Promise<Map<number, MatchCandidate[]>> {
  const out = new Map<number, MatchCandidate[]>();
  for (const batch of batches(entries)) {
    const rows = resultRows<{ i: number; workId: string; score: number; byAuthor: boolean }>(
      await db.execute(sql`
        with q as (
          select x.i, search_normalize(x.title) as t,
            nullif(reverse(split_part(reverse(search_normalize(x.author)), ' ', 1)), '') as surname
          from jsonb_to_recordset(${json(batch)}::jsonb) as x(i int, title text, author text)
        ),
        titles as (
          select w.id as work_id, search_normalize(split_part(w.title, ':', 1)) as t from works w where w.kind = 'book'
          union
          select e.work_id, search_normalize(split_part(e.title, ':', 1)) from editions e
            join works w on w.id = e.work_id and w.kind = 'book'
        ),
        surnames as (
          select distinct wa.work_id, word
          from work_authors wa
          join authors a on a.id = wa.author_id
          cross join lateral regexp_split_to_table(a.search_text, ' ') as word
          where word <> ''
        ),
        by_author as (
          select q.i, t.work_id,
            max((strict_word_similarity(q.t, t.t) + strict_word_similarity(t.t, q.t)) / 2) as score
          from q
          join surnames s on s.word = q.surname
          join titles t on t.work_id = s.work_id
          where q.t <> ''
          group by q.i, t.work_id
        ),
        by_title as (
          select distinct q.i, t.work_id from q join titles t on t.t = q.t where q.t <> ''
        ),
        ranked as (
          select i, work_id, score, by_author, row_number() over (partition by i order by by_author desc, score desc) as rn
          from (
            select i, work_id, score, true as by_author from by_author where score >= ${CANDIDATE_THRESHOLD}
            union all
            select b.i, b.work_id, 1.0, false from by_title b
              where not exists (select 1 from by_author a where a.i = b.i and a.work_id = b.work_id and a.score >= ${CANDIDATE_THRESHOLD})
          ) c
        )
        select i, work_id::text as "workId", round(score::numeric, 3)::float8 as score, by_author as "byAuthor"
        from ranked where rn <= 4 order by i, rn`),
    );
    for (const r of rows) {
      const list = out.get(r.i) ?? [];
      list.push({ workId: r.workId, score: Number(r.score), byAuthor: r.byAuthor });
      out.set(r.i, list);
    }
  }
  return out;
}

/**
 * The book of each row: exact, likely, possible or none, with the edition
 * and copy that belong to it. Rows that cannot be imported, and to-read rows,
 * are matched too: later steps import to-read rows from them.
 */
export async function matchRows(rows: ImportRow[]): Promise<RowMatch[]> {
  const result: RowMatch[] = rows.map(() => ({ found: "none", workId: null, reason: null, editionId: null, instanceId: null, candidates: [], warnings: [] }));
  const ids = await durtalIds(rows);
  const keyed = await sourceKeyHits(unique(rows.flatMap((r) => r.readings.map((x) => x.sourceKey))));
  const gr = await goodreadsHits(unique(rows.map((r) => r.sourceBookId)));
  const isbn = await isbnHits(unique(rows.flatMap((r) => [r.isbn13, r.isbn10])));
  const byKey = (hits: IdHit[], key: string | null) => (key ? hits.filter((h) => h.key === key) : []);
  const pending: { i: number; title: string; author: string }[] = [];

  rows.forEach((row, i) => {
    const m = result[i];
    // 1. The Durtal book
    if (row.workId && ids.works.has(row.workId)) {
      Object.assign(m, { found: "exact", workId: row.workId, reason: "Same Durtal book" });
    } else {
      if (row.workId) m.warnings.push("The work_id is not a book in Durtal; the row is matched by title and author");
      // 2. A reading an earlier import wrote, then the Goodreads id or link, then the ISBN; several books for one id is not exact
      const steps: IdHit[][] = [
        row.readings.flatMap((x) => byKey(keyed, x.sourceKey)),
        byKey(gr, row.sourceBookId).filter((h) => h.reason === "Same Goodreads id"),
        byKey(gr, row.sourceBookId).filter((h) => h.reason === "Same Goodreads link"),
        [...byKey(isbn, row.isbn13), ...byKey(isbn, row.isbn10)],
      ];
      for (const hits of steps) {
        const works = unique(hits.map((h) => h.workId));
        if (works.length === 1) {
          Object.assign(m, { found: "exact", workId: works[0], reason: hits[0].reason });
          break;
        }
        if (works.length > 1) {
          Object.assign(m, { found: "possible", candidates: works.slice(0, 3).map((workId) => ({ workId, score: 1, byAuthor: false })) });
          break;
        }
      }
    }
    if (m.found === "exact") {
      // The edition: the Durtal file's own when it belongs to the book, else one an identifier found
      if (row.editionId) {
        if (ids.editions.get(row.editionId) === m.workId) {
          m.editionId = row.editionId;
          if (row.instanceId && ids.instances.get(row.instanceId) === row.editionId) m.instanceId = row.instanceId;
          else if (row.instanceId) m.warnings.push("Copy not in Durtal; the reading is kept without it");
        } else m.warnings.push("Edition not in Durtal; the reading is kept without it");
      }
      m.editionId ??=
        [...row.readings.flatMap((x) => byKey(keyed, x.sourceKey)), ...byKey(gr, row.sourceBookId), ...byKey(isbn, row.isbn13), ...byKey(isbn, row.isbn10)].find(
          (h) => h.workId === m.workId && h.editionId,
        )
          ?.editionId ?? null;
    } else if (m.found === "none" && row.title) {
      pending.push({ i, title: matchTitle(row.title), author: row.authors[0] ?? "" });
    }
  });

  // 3. Title and author
  const candidates = await titleCandidates(pending);
  for (const { i } of pending) {
    const judged = judgeCandidates(candidates.get(i) ?? []);
    Object.assign(result[i], { found: judged.found, workId: judged.workId, reason: judged.reason, candidates: judged.candidates });
    if (rows[i].editionId && judged.workId) result[i].warnings.push("Edition not in Durtal; the reading is kept without it");
  }
  return result;
}

/** The readings of these books, as the duplicate rule reads them */
export async function existingReadingsOf(workIds: string[]): Promise<Map<string, ExistingReading[]>> {
  const out = new Map<string, ExistingReading[]>();
  for (const batch of batches(unique(workIds))) {
    const rows = resultRows<ExistingReading & { workId: string }>(
      await db.execute(sql`
        select r.id::text as id, r.work_id::text as "workId", r.source_key as "sourceKey", r.status,
          to_char(r.finished_on, 'YYYY-MM-DD') as "finishedOn", r.finished_precision as "finishedPrecision"
        from readings r
        where r.work_id in (select value::uuid from jsonb_array_elements_text(${json(batch)}::jsonb))
        order by r.created_at, r.id`),
    );
    for (const { workId, ...r } of rows) {
      const list = out.get(workId) ?? [];
      list.push({ ...r, status: r.status as ReadingStatus, finishedPrecision: r.finishedPrecision as ReadingDatePrecision });
      out.set(workId, list);
    }
  }
  return out;
}

export interface MatchedRow {
  rowNo: number;
  data: ImportRow;
  workId: string | null;
  match: Omit<ImportMatch, "verdicts" | "section" | "note">;
}

/**
 * The verdicts and the section of every row, from its book's readings and
 * the other rows of the same book in the file. Rows in file order.
 */
export async function withVerdicts(source: ImportSource, rows: MatchedRow[]): Promise<ImportMatch[]> {
  const counted = rows.filter((r) => r.workId && !r.data.error && r.data.kind === "readings");
  const existing = await existingReadingsOf(counted.map((r) => r.workId!));
  const verdicts = new Map<number, ImportMatch["verdicts"]>();
  const byBook = new Map<string, MatchedRow[]>();
  for (const r of counted) byBook.set(r.workId!, [...(byBook.get(r.workId!) ?? []), r]);
  for (const [workId, bookRows] of byBook) {
    const ordered = [...bookRows].sort((a, b) => a.rowNo - b.rowNo);
    bookVerdicts(source, ordered.map((r) => r.data), existing.get(workId) ?? []).forEach((v, k) => verdicts.set(ordered[k].rowNo, v));
  }
  return rows.map((r) => {
    const v = verdicts.get(r.rowNo) ?? [];
    return { ...r.match, verdicts: v, ...sectionOf(r.data, r.match.found, r.workId, v) };
  });
}
