import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { resultRows } from "@/lib/harmonization/store";
import { normalize } from "@/lib/harmonization/normalize";
import { updateEdition } from "@/lib/actions/editions";
import { updateWork } from "@/lib/actions/works";
import { colorBucketOfPalette } from "@/lib/color/color-buckets";
import { retainCoverAttempt } from "@/lib/s3/cover-stage";
import { copyPlannedCover, planCoverCopy } from "@/lib/ebooks/match/covers";
import type { LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { languageName } from "@/lib/utils/language";
import { DIFFERENCE_FIELDS, DIFFERENCE_LABELS, differencesOf, fieldWord, type Difference, type DifferenceField, type DifferenceSides } from "./compare";

/*
 * The Differences section of /ebooks/review (SLN-658): every disagreement
 * between a library e-book and its Durtal book, and the two choices. Keep
 * Durtal's sets the e-book's own field (the library's original stays in the
 * file metadata); Use the file's changes the book through the catalogue's
 * own writers. Each choice is a work history event that holds both values,
 * which is what its undo reads: no table of its own.
 */

export const DIFFERENCE_EVENTS = {
  kept: "work.ebook_difference_kept",
  used: "work.ebook_difference_used",
  undone: "work.ebook_difference_undone",
} as const;

export type DifferenceChoice = "keep" | "use";
export interface DifferenceItem {
  ebookId: string;
  field: DifferenceField;
  /** The values as shown: a choice is refused once either has changed */
  durtal: string | null;
  file: string | null;
}
export interface DifferenceOutcome {
  eventId: string;
  ebookId: string;
  field: DifferenceField;
  bookTitle: string;
  message: string;
}
export class DifferenceRefused extends Error {}

const STALE = "This difference changed. Reload to see it.";

/** The linked e-books from the library, with both sides; one e-book when `ebookId` is given */
export async function readDifferenceSides(ebookId?: string): Promise<DifferenceSides[]> {
  return resultRows<DifferenceSides>(
    await db.execute(sql`
      select e.id::text as "ebookId", w.id::text as "workId", ed.id::text as "editionId", w.slug,
        w.catalogue_status::text as "catalogueStatus", ed.metadata_locked as "editionLocked",
        (select count(*)::int from instances o where o.edition_id = ed.id and o.id <> i.id and o.status <> 'deaccessioned') as "otherCopies",
        jsonb_build_object('title', e.title, 'subtitle', e.subtitle, 'authors', to_jsonb(e.authors), 'series', e.series,
          'seriesIndex', e.series_index, 'language', e.language, 'year', e.published_year, 'publisher', e.publisher,
          'isbns', to_jsonb(e.isbns), 'hasCover', e.cover_key is not null) as ebook,
        jsonb_build_object('workTitle', w.title, 'title', ed.title, 'subtitle', ed.subtitle,
          'authors', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'creditedAs', wa.credited_as) order by wa.sort_order, a.name)
            from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and wa.role in ('author', 'co_author')), '[]'::jsonb),
          'series', coalesce(s.title, w.series_name), 'seriesIndex', w.series_position, 'language', ed.language,
          'year', ed.publication_year, 'publisher', ed.publisher, 'isbn13', ed.isbn_13, 'hasCover', ed.cover_s3_key is not null) as durtal
      from ebooks e
      join instances i on i.id = e.instance_id and i.status <> 'deaccessioned'
      join editions ed on ed.id = i.edition_id
      join works w on w.id = ed.work_id and w.kind = 'book'
      left join series s on s.id = w.series_id
      where e.match_state = 'linked'
        and exists (select 1 from ebook_files f where f.ebook_id = e.id and f.metadata->'calibre' is not null)
        ${ebookId ? sql`and e.id = ${ebookId}::uuid` : sql``}
      order by w.title, e.id`),
  ).map((row) => ({ ...row, ebook: { ...row.ebook, seriesIndex: row.ebook.seriesIndex === null ? null : Number(row.ebook.seriesIndex) } }));
}

export interface DifferencesPage {
  /** Differences per field, the fields with none left out */
  counts: Partial<Record<DifferenceField, number>>;
  total: number;
  field: DifferenceField | null;
  rows: Difference[];
  shown: number;
}

export async function getDifferences(input: { field?: DifferenceField | null; shown: number }): Promise<DifferencesPage> {
  const all = (await readDifferenceSides()).flatMap(differencesOf);
  const counts: Partial<Record<DifferenceField, number>> = {};
  for (const d of all) counts[d.field] = (counts[d.field] ?? 0) + 1;
  const field = input.field && counts[input.field] ? input.field : (DIFFERENCE_FIELDS.find((f) => counts[f]) ?? null);
  return { counts, total: all.length, field, rows: field ? all.filter((d) => d.field === field).slice(0, input.shown) : [], shown: input.shown };
}

/* The e-book's own columns, each with its type, read from a JSON value */
const EBOOK_COLUMNS: Record<Exclude<DifferenceField, "cover" | "status">, { column: string; read: (value: SQL) => SQL }> = {
  title: { column: "title", read: (v) => sql`(${v}->>'v')` },
  subtitle: { column: "subtitle", read: (v) => sql`(${v}->>'v')` },
  authors: { column: "authors", read: (v) => sql`array(select jsonb_array_elements_text(${v}->'v'))::text[]` },
  series: { column: "series", read: (v) => sql`(${v}->>'v')` },
  seriesIndex: { column: "series_index", read: (v) => sql`(${v}->>'v')::numeric` },
  language: { column: "language", read: (v) => sql`(${v}->>'v')` },
  year: { column: "published_year", read: (v) => sql`(${v}->>'v')::int` },
  publisher: { column: "publisher", read: (v) => sql`(${v}->>'v')` },
  isbn: { column: "isbns", read: (v) => sql`array(select jsonb_array_elements_text(${v}->'v'))::text[]` },
};
type Raw = string | number | string[] | null;
const ebookValue = (sides: DifferenceSides, field: keyof typeof EBOOK_COLUMNS): Raw => {
  const e = sides.ebook;
  return { title: e.title, subtitle: e.subtitle, authors: e.authors, series: e.series, seriesIndex: e.seriesIndex, language: e.language,
    year: e.year, publisher: e.publisher, isbn: e.isbns }[field];
};
const durtalValue = (sides: DifferenceSides, field: keyof typeof EBOOK_COLUMNS): Raw => {
  const d = sides.durtal;
  const index = d.seriesIndex === null || d.seriesIndex === "" || !Number.isFinite(Number(d.seriesIndex)) ? null : Number(d.seriesIndex);
  return { title: d.title, subtitle: d.subtitle, authors: d.authors.map((a) => a.name), series: d.series, seriesIndex: index,
    language: d.language, year: d.year, publisher: d.publisher, isbn: d.isbn13 ? [d.isbn13] : [] }[field];
};
const shown = (field: DifferenceField, value: string | null) => (value && field === "language" ? (languageName(value) ?? value) : value);
const metadata = (d: Difference, extra: Record<string, unknown>, from: string | null, to: string | null) =>
  JSON.stringify({ targetName: DIFFERENCE_LABELS[d.field], targetId: d.ebookId, oldValue: shown(d.field, from), newValue: shown(d.field, to),
    extra: { field: d.field, ebookId: d.ebookId, editionId: d.editionId, ...extra } });

/** The difference as it stands now, or a refusal when it is gone or shows other values */
async function current(item: DifferenceItem) {
  const [sides] = await readDifferenceSides(item.ebookId);
  const found = sides ? differencesOf(sides).find((d) => d.field === item.field) : undefined;
  if (!sides || !found || found.durtal !== item.durtal || found.file !== item.file) throw new DifferenceRefused(STALE);
  return { sides, difference: found };
}

async function insertEvent(workId: string, eventKey: string, meta: string): Promise<string> {
  const [row] = resultRows<{ id: string }>(
    await db.execute(sql`insert into activity_events (entity_type, entity_id, event_key, metadata)
      values ('work', ${workId}::uuid, ${eventKey}, ${meta}::jsonb) returning id::text as id`),
  );
  return row.id;
}

/** Keep Durtal's: the e-book's field takes the book's value, compared and set in one statement */
async function keep(sides: DifferenceSides, d: Difference): Promise<DifferenceOutcome> {
  if (!d.keep || d.field === "cover" || d.field === "status") throw new DifferenceRefused("Keep Durtal's is not offered here.");
  const field = d.field;
  const { column, read } = EBOOK_COLUMNS[field];
  const before = ebookValue(sides, field);
  const after = durtalValue(sides, field);
  const next = { ...sides.ebook, [field === "isbn" ? "isbns" : field]: after };
  const search = normalizeSearchText([next.title, next.subtitle, ...next.authors, next.series].filter(Boolean).join(" "));
  const b = sql`${JSON.stringify({ v: before })}::jsonb`;
  const a = sql`${JSON.stringify({ v: after })}::jsonb`;
  const [row] = resultRows<{ id: string }>(
    await db.execute(sql`with changed as (
        update ebooks set ${sql.raw(column)} = ${read(a)}, search_text = ${search}, updated_at = now()
        where id = ${d.ebookId}::uuid and ${sql.raw(column)} is not distinct from ${read(b)}
        returning id)
      insert into activity_events (entity_type, entity_id, event_key, metadata)
      select 'work', ${d.workId}::uuid, ${DIFFERENCE_EVENTS.kept}, ${metadata(d, { choice: "keep", before, after }, d.file, d.durtal)}::jsonb from changed
      returning id::text as id`),
  );
  if (!row) throw new DifferenceRefused(STALE);
  return { eventId: row.id, ebookId: d.ebookId, field, bookTitle: d.bookTitle, message: `Kept Durtal's ${fieldWord(field)} for the e-book.` };
}

const EDITION_FIELDS = { title: "title", subtitle: "subtitle", language: "language", year: "publicationYear", publisher: "publisher", isbn: "isbn13" } as const;
type EditionField = keyof typeof EDITION_FIELDS;
const isEditionField = (field: DifferenceField): field is EditionField => field in EDITION_FIELDS;

/** The book's value of an edition field, as stored */
function editionRaw(sides: DifferenceSides, field: EditionField): string | number | null {
  const d = sides.durtal;
  return { title: d.title, subtitle: d.subtitle, language: d.language, year: d.year, publisher: d.publisher, isbn: d.isbn13 }[field];
}
/** The file's value of an edition field, written as the book's */
function fileRaw(sides: DifferenceSides, field: EditionField): string | number | null {
  const e = sides.ebook;
  return { title: e.title, subtitle: e.subtitle, language: e.language, year: e.year, publisher: e.publisher, isbn: e.isbns[0] ?? null }[field];
}

/** Use the file's: the book takes the file's value through the catalogue's own writers */
async function takeFile(sides: DifferenceSides, d: Difference): Promise<DifferenceOutcome> {
  if (!d.use) throw new DifferenceRefused(d.why ?? "Use the file's is not offered here.");
  let extra: Record<string, unknown>;
  if (isEditionField(d.field)) {
    const before = editionRaw(sides, d.field);
    // The language as the file's difference names it: a canonical code
    const after = d.field === "language" ? d.file : fileRaw(sides, d.field);
    await updateEdition(d.editionId, { [EDITION_FIELDS[d.field]]: after });
    extra = { choice: "use", target: "edition", before, after };
  } else if (d.field === "series") {
    const [work] = resultRows<{ seriesId: string | null; seriesPosition: string | null }>(
      await db.execute(sql`select series_id::text as "seriesId", series_position as "seriesPosition" from works where id = ${d.workId}::uuid`),
    );
    await updateWork(d.workId, { seriesName: d.file });
    extra = { choice: "use", target: "work", before: work, after: d.file };
  } else if (d.field === "seriesIndex") {
    await updateWork(d.workId, { seriesPosition: d.file });
    extra = { choice: "use", target: "work", before: sides.durtal.seriesIndex, after: d.file };
  } else if (d.field === "cover") {
    return takeCover(sides, d);
  } else throw new DifferenceRefused("Use the file's is not offered here.");
  const eventId = await insertEvent(d.workId, DIFFERENCE_EVENTS.used, metadata(d, extra, d.durtal, d.file));
  return { eventId, ebookId: d.ebookId, field: d.field, bookTitle: d.bookTitle, message: `The book takes the file's ${fieldWord(d.field)}.` };
}

/** The e-book's cover becomes the edition's, through the cover stage the matching uses */
async function takeCover(sides: DifferenceSides, d: Difference): Promise<DifferenceOutcome> {
  const files = resultRows<Record<string, unknown>>(await db.execute(sql`select f.* from ebook_files f where f.ebook_id = ${d.ebookId}::uuid`));
  const [ebook] = resultRows<{ coverKey: string | null }>(await db.execute(sql`select cover_key as "coverKey" from ebooks where id = ${d.ebookId}::uuid`));
  if (!ebook?.coverKey) throw new DifferenceRefused(STALE);
  const snapshot = { rows: { ebook_files: files } } as unknown as Pick<LoadedMatchCatalogue, "rows">;
  const plan = planCoverCopy(snapshot, d.ebookId, d.editionId, ebook.coverKey, { operationId: randomUUID(), targetDatabase: "catalogue" });
  if (!plan) throw new DifferenceRefused(STALE);
  const copied = await copyPlannedCover(plan);
  const after = { coverKey: copied.coverKey, thumbnailKey: copied.thumbnailKey };
  try {
    const [row] = resultRows<{ id: string }>(
      await db.execute(sql`with changed as (
          update editions set cover_s3_key = ${copied.coverKey}, thumbnail_s3_key = ${copied.thumbnailKey}, cover_source_url = null,
            cover_palette = ${copied.palette ? JSON.stringify(copied.palette) : null}::jsonb, cover_color_bucket = ${colorBucketOfPalette(copied.palette)},
            updated_at = now()
          where id = ${d.editionId}::uuid and cover_s3_key is null and not metadata_locked
          returning id)
        insert into activity_events (entity_type, entity_id, event_key, metadata)
        select 'work', ${d.workId}::uuid, ${DIFFERENCE_EVENTS.used}, ${metadata(d, { choice: "use", target: "edition", before: null, after }, null, "The e-book's cover")}::jsonb from changed
        returning id::text as id`),
    );
    if (!row) throw new DifferenceRefused(STALE);
    return { eventId: row.id, ebookId: d.ebookId, field: "cover", bookTitle: d.bookTitle, message: "The edition takes the e-book's cover." };
  } catch (error) {
    // Never deleted: the stage is kept, as every cover publication that did not land
    retainCoverAttempt(copied, "difference cover publication rejected or uncertain");
    throw error;
  }
}

/** One choice for each item, in order; a refused item does not stop the rest */
export async function decideDifferences(choice: DifferenceChoice, items: DifferenceItem[]) {
  const done: DifferenceOutcome[] = [];
  const refused: { ebookId: string; field: DifferenceField; message: string }[] = [];
  for (const item of items) {
    try {
      const { sides, difference } = await current(item);
      done.push(await (choice === "keep" ? keep(sides, difference) : takeFile(sides, difference)));
    } catch (error) {
      refused.push({ ebookId: item.ebookId, field: item.field, message: refusal(error) });
    }
  }
  if (done.length) invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.series, CACHE_TAGS.activity);
  return { done, refused };
}

const refusal = (error: unknown) => {
  if (error instanceof DifferenceRefused) return error.message;
  const message = error instanceof Error ? error.message : "";
  // The catalogue's own refusals read as sentences, though not all end in a stop: an ISBN another
  // edition holds ends with that edition's title in brackets. Nothing else reaches the page.
  return /^[A-Z][^\n]{0,200}$/.test(message) && !/sql|query|relation|column|constraint|violates/i.test(message) ? message : "This choice could not be saved. Nothing changed.";
};

interface StoredChoice {
  id: string;
  workId: string;
  eventKey: string;
  metadata: { targetName: string; extra: { field: DifferenceField; ebookId: string; editionId: string; choice: DifferenceChoice; target?: string; before: unknown; after: unknown } };
}

/** Undo each choice, while the value it wrote is still there; one undo for each choice */
export async function undoDifferences(eventIds: string[]) {
  const done: { eventId: string; message: string }[] = [];
  const refused: { eventId: string; message: string }[] = [];
  for (const eventId of eventIds) {
    try {
      done.push({ eventId, message: await undoOne(eventId) });
    } catch (error) {
      refused.push({ eventId, message: error instanceof DifferenceRefused ? error.message : "This undo could not be saved. Nothing changed." });
    }
  }
  if (done.length) invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.series, CACHE_TAGS.activity);
  return { done, refused };
}

const CHANGED = "The value changed since this choice, so it is not undone.";

async function undoOne(eventId: string): Promise<string> {
  const [stored] = resultRows<StoredChoice>(
    await db.execute(sql`select id::text as id, entity_id::text as "workId", event_key as "eventKey", metadata from activity_events
      where id = ${eventId}::uuid and entity_type = 'work' and event_key in (${DIFFERENCE_EVENTS.kept}, ${DIFFERENCE_EVENTS.used})`),
  );
  if (!stored) throw new DifferenceRefused("This choice was not found.");
  const { field, ebookId, editionId, before, after } = stored.metadata.extra;
  const label = fieldWord(field);
  const undone = JSON.stringify({ targetName: DIFFERENCE_LABELS[field], targetId: ebookId, extra: { field, ebookId, editionId, undoOf: eventId } });
  // The claim: one undo for each choice, taken before anything is written
  const claim = sql`insert into activity_events (entity_type, entity_id, event_key, metadata)
    select 'work', ${stored.workId}::uuid, ${DIFFERENCE_EVENTS.undone}, ${undone}::jsonb
    where not exists (select 1 from activity_events u where u.event_key = ${DIFFERENCE_EVENTS.undone}
      and u.entity_id = ${stored.workId}::uuid and u.metadata->'extra'->>'undoOf' = ${eventId})`;

  if (stored.eventKey === DIFFERENCE_EVENTS.kept) {
    const { column, read } = EBOOK_COLUMNS[field as keyof typeof EBOOK_COLUMNS];
    const b = sql`${JSON.stringify({ v: before })}::jsonb`;
    const a = sql`${JSON.stringify({ v: after })}::jsonb`;
    const [row] = resultRows<{ undone: boolean; changed: boolean }>(
      await db.execute(sql`with claimed as (${claim} returning id),
        changed as (update ebooks set ${sql.raw(column)} = ${read(b)}, updated_at = now()
          where id = ${ebookId}::uuid and ${sql.raw(column)} is not distinct from ${read(a)} and exists (select 1 from claimed)
          returning id)
        select exists (select 1 from claimed) as undone, exists (select 1 from changed) as changed`),
    );
    if (!row.undone) throw new DifferenceRefused("This choice is already undone.");
    if (!row.changed) {
      // Nothing was written: the claim goes, so the undo can be tried again
      await db.execute(sql`delete from activity_events where event_key = ${DIFFERENCE_EVENTS.undone} and entity_id = ${stored.workId}::uuid
        and metadata->'extra'->>'undoOf' = ${eventId}`);
      throw new DifferenceRefused(CHANGED);
    }
    await refreshSearchText(ebookId);
    return `The e-book's ${label} is back.`;
  }

  // Use the file's: the book's value must still be the one the choice wrote
  const [now] = resultRows<{ value: unknown }>(await db.execute(nowSql(field, editionId, stored.workId)));
  // A series is found by its name, whatever its case: the name it has is the one compared
  const still = field === "series" ? normalize(String(now?.value ?? "")) === normalize(String(after ?? "")) : JSON.stringify(now?.value ?? null) === JSON.stringify(after ?? null);
  if (!still) throw new DifferenceRefused(CHANGED);
  const [claimed] = resultRows<{ id: string }>(await db.execute(sql`${claim} returning id::text as id`));
  if (!claimed) throw new DifferenceRefused("This choice is already undone.");
  try {
    if (field === "cover") {
      const keys = after as { coverKey: string };
      const [row] = resultRows<{ id: string }>(
        await db.execute(sql`update editions set cover_s3_key = null, thumbnail_s3_key = null, cover_palette = null, cover_color_bucket = null, updated_at = now()
          where id = ${editionId}::uuid and cover_s3_key = ${keys.coverKey} returning id::text as id`),
      );
      if (!row) throw new DifferenceRefused(CHANGED);
    } else if (isEditionField(field)) {
      await updateEdition(editionId, { [EDITION_FIELDS[field]]: before });
    } else if (field === "series") {
      const was = before as { seriesId: string | null; seriesPosition: string | null };
      await updateWork(stored.workId, was.seriesId ? { seriesId: was.seriesId, seriesPosition: was.seriesPosition } : { seriesId: null });
    } else if (field === "seriesIndex") {
      await updateWork(stored.workId, { seriesPosition: before as string | null });
    }
  } catch (error) {
    await db.execute(sql`delete from activity_events where id = ${claimed.id}::uuid`);
    throw error instanceof DifferenceRefused ? error : new DifferenceRefused(refusal(error));
  }
  return `The book's ${label} is back.`;
}

/** The book's stored value of a field, in the form a choice journals it */
function nowSql(field: DifferenceField, editionId: string, workId: string): SQL {
  const column: Partial<Record<DifferenceField, SQL>> = {
    title: sql`to_jsonb(title)`,
    subtitle: sql`to_jsonb(subtitle)`,
    language: sql`to_jsonb(language)`,
    year: sql`to_jsonb(publication_year)`,
    publisher: sql`to_jsonb(publisher)`,
    isbn: sql`to_jsonb(isbn_13)`,
    cover: sql`case when cover_s3_key is null then 'null'::jsonb else jsonb_build_object('coverKey', cover_s3_key, 'thumbnailKey', thumbnail_s3_key) end`,
  };
  if (column[field]) return sql`select ${column[field]} as value from editions where id = ${editionId}::uuid`;
  if (field === "series") return sql`select to_jsonb(s.title) as value from works w left join series s on s.id = w.series_id where w.id = ${workId}::uuid`;
  return sql`select to_jsonb(series_position) as value from works where id = ${workId}::uuid`;
}

async function refreshSearchText(ebookId: string) {
  const [e] = resultRows<{ title: string; subtitle: string | null; authors: string[]; series: string | null }>(
    await db.execute(sql`select title, subtitle, authors, series from ebooks where id = ${ebookId}::uuid`),
  );
  if (!e) return;
  const search = normalizeSearchText([e.title, e.subtitle, ...e.authors, e.series].filter(Boolean).join(" "));
  await db.execute(sql`update ebooks set search_text = ${search} where id = ${ebookId}::uuid`);
}
