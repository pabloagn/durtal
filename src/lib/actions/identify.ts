"use server";

/**
 * Identify placeholder editions (task 0187). The queue at /library/identify
 * shows one placeholder at a time with the ISBNdb editions that can be it.
 * Picking one updates the placeholder in place, so its copies and
 * collections stay attached; the save goes through Match's guardrails and
 * can be undone.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { editions } from "@/lib/db/schema";
import { recordActivity } from "@/lib/activity/record";
import { autoResolveEditions, resultRows } from "@/lib/publishers/resolution";
import { getIsbndbBook, searchIsbndbBooks } from "@/lib/api/isbndb";
import { deleteUnusedObjects } from "@/lib/s3/cleanup";
import { stripControlChars } from "@/lib/utils/sanitize";
import type { PosterImage } from "@/lib/utils/edition-image";
import {
  MATCH_FIELDS,
  isbn10To13,
  sameMatchValue,
  validIsbn10,
  validIsbn13,
  type MatchField,
  type MatchValue,
} from "@/lib/match/plan";
import { fetchSourceRecord, isbndbRecord } from "@/lib/match/source";
import {
  KEPT_WITHOUT_ISBN,
  PLACEHOLDER_SOURCE,
  isPlaceholderEdition,
  rankCandidates,
  type Candidate,
} from "@/lib/match/identify";
import {
  MATCH_COLUMN,
  loadMatchEdition,
  planRecord,
  saveMatch,
} from "@/lib/match/save";

export interface QueueCopy {
  location: string;
  type: string;
  format: string | null;
  status: string;
}

export interface OtherEdition {
  id: string;
  title: string;
  isbn13: string | null;
  publisher: string | null;
  year: number | null;
  coverKey: string | null;
  copies: number;
}

export interface QueueItem {
  id: string;
  title: string;
  language: string;
  workId: string;
  workSlug: string | null;
  workTitle: string;
  originalYear: number | null;
  status: string;
  authors: string[];
  poster: PosterImage | null;
  copies: QueueCopy[];
  collections: number;
  /** Identified editions of the same book */
  otherEditions: OtherEdition[];
  /** Houses the placeholder links to (often set by hand) */
  houses: string[];
}

/** Every placeholder: books with copies first, then the books closest to the shelf */
export async function getIdentifyQueue(): Promise<QueueItem[]> {
  const rows = resultRows<Omit<QueueItem, "authors"> & { authors: string | null }>(
    await db.execute(sql`
      select e.id, e.title, e.language, w.id as "workId", w.slug as "workSlug",
        w.title as "workTitle", w.original_year as "originalYear", w.catalogue_status as status,
        (select string_agg(a.name, '|' order by wa.sort_order) from work_authors wa
          join authors a on a.id = wa.author_id where wa.work_id = w.id) as authors,
        (select json_build_object('s3Key', m.s3_key, 'thumbnailS3Key', m.thumbnail_s3_key, 'cropX', m.crop_x,
            'cropY', m.crop_y, 'cropZoom', m.crop_zoom, 'brightness', m.brightness, 'contrast', m.contrast)
          from media m where m.work_id = w.id and m.type = 'poster' and m.is_active
          order by m.created_at, m.id limit 1) as poster,
        coalesce((select json_agg(json_build_object('location', l.name, 'type', l.type,
            'format', i.format, 'status', i.status) order by i.created_at)
          from instances i join locations l on l.id = i.location_id
          where i.edition_id = e.id and i.status <> 'deaccessioned'), '[]') as copies,
        (select count(*)::int from collection_editions ce where ce.edition_id = e.id) as collections,
        coalesce((select json_agg(json_build_object('id', o.id, 'title', o.title, 'isbn13', o.isbn_13,
            'publisher', o.publisher, 'year', o.publication_year,
            'coverKey', coalesce(o.thumbnail_s3_key, o.cover_s3_key),
            'copies', (select count(*) from instances i where i.edition_id = o.id and i.status <> 'deaccessioned'))
            order by o.created_at)
          from editions o where o.work_id = w.id and o.id <> e.id
            and o.metadata_source is distinct from ${PLACEHOLDER_SOURCE}), '[]') as "otherEditions",
        coalesce((select json_agg(h.name order by h.name) from edition_publishers ep
          join publishing_houses h on h.id = ep.publisher_id where ep.edition_id = e.id), '[]') as houses
      from editions e join works w on w.id = e.work_id
      where e.metadata_source = ${PLACEHOLDER_SOURCE}
      order by exists (select 1 from instances i where i.edition_id = e.id and i.status <> 'deaccessioned') desc,
        array_position(array['accessioned','on_order','shortlisted','wanted','tracked','deaccessioned'], w.catalogue_status::text),
        w.title, e.id`),
  );
  return rows.map((r) => ({
    ...r,
    authors: r.authors ? r.authors.split("|") : [],
  }));
}

type RawHouse = "same" | "group" | "other" | null;
/** The top of a house's family: its group, else its publisher, else itself */
const ROOT = sql`coalesce(g.id, p.id, h.id)`;
const ROOT_JOINS = sql`join publishing_houses h on h.id = m.id
  left join publishing_houses p on p.id = h.parent_id
  left join publishing_houses g on g.id = p.parent_id`;

export interface CandidateSearch {
  query: string;
  /** The best candidates, at most SHOWN_AT_MOST */
  candidates: Candidate[];
  /** Results that passed the checks */
  eligible: number;
  /** Results ISBNdb sent before the checks */
  found: number;
}

const SHOWN_AT_MOST = 12;

/**
 * ISBNdb editions that can be this placeholder, best first. Writes nothing.
 * `query` replaces the default search (title and first author).
 */
export async function findEditionCandidates(
  editionId: string,
  query?: string,
): Promise<CandidateSearch> {
  const edition = await loadMatchEdition(editionId);
  const authors = edition.work.workAuthors.map((a) => a.author.name);
  const q = query?.trim() || [edition.work.title, authors[0]].filter(Boolean).join(" ");
  // A typed ISBN looks up that edition; anything else is a text search
  const isbn = validIsbn13(q) ?? validIsbn10(q);
  const books = isbn
    ? [await getIsbndbBook(isbn)].filter((b) => b !== null)
    : await searchIsbndbBooks(q, 50);
  const raw = books.map((b) => ({
    ...isbndbRecord(b),
    authors: (b.authors ?? []).map((a) => stripControlChars(a)),
    bindingText: b.binding ?? null,
  }));

  // ISBNs other editions already hold
  const isbns = raw.flatMap((r) => [r.isbn13, r.isbn10].filter(Boolean)) as string[];
  const owners = resultRows<{ isbn13: string | null; isbn10: string | null; title: string; same: boolean }>(
    await db.execute(sql`
      select e.isbn_13 as isbn13, e.isbn_10 as isbn10, w.title, e.work_id = ${edition.workId}::uuid as same
      from editions e join works w on w.id = e.work_id
      where e.id <> ${editionId}::uuid and (
        regexp_replace(coalesce(e.isbn_13, ''), '[^0-9]', '', 'g') = any(string_to_array(${isbns.join(",")}::text, ','))
        or upper(regexp_replace(coalesce(e.isbn_10, ''), '[^0-9Xx]', '', 'g')) = any(string_to_array(${isbns.join(",")}::text, ',')))`),
  );
  const owned = new Map<string, { title: string; sameWork: boolean }>();
  for (const o of owners) {
    const key =
      validIsbn13(o.isbn13) ?? (validIsbn10(o.isbn10) ? isbn10To13(validIsbn10(o.isbn10)!) : null);
    if (key) owned.set(key, { title: o.title, sameWork: o.same });
  }
  // The house each result links to, against the placeholder's house
  const agreement = resultRows<{ i: number; house: RawHouse; hint: string | null }>(
    await db.execute(sql`
      with linked as (select publisher_id as id from edition_publishers where edition_id = ${editionId}::uuid),
      near as (
        select f as id from linked l, publisher_family(l.id) f
        union select h.parent_id from linked l join publishing_houses h on h.id = l.id
        union select p.parent_id from linked l join publishing_houses h on h.id = l.id
          join publishing_houses p on p.id = h.parent_id),
      roots as (select ${ROOT} as id from linked m ${ROOT_JOINS}),
      c as (select ord, v from jsonb_array_elements(${JSON.stringify(
        raw.map((r) => ({ publisher: r.publisher, isbn: r.isbn13 ?? r.isbn10 })),
      )}::text::jsonb) with ordinality as c(v, ord)),
      m as (select c.ord, x as id from c,
        unnest(edition_publisher_matches(c.v->>'publisher', null, edition_isbn_digits(c.v->>'isbn', c.v->>'isbn'))) x)
      select c.ord::int - 1 as i,
        (select string_agg(h.name, ', ' order by h.name) from linked l join publishing_houses h on h.id = l.id) as hint,
        case
          when not exists (select 1 from linked) or not exists (select 1 from m where m.ord = c.ord) then null
          when exists (select 1 from m where m.ord = c.ord and m.id in (select id from near)) then 'same'
          when exists (select 1 from m ${ROOT_JOINS} where m.ord = c.ord and ${ROOT} in (select id from roots)) then 'group'
          else 'other' end as house
      from c order by c.ord`),
  );
  const raw2 = raw.map((r, i) => ({ ...r, house: agreement[i]?.house ?? null }));
  const copies = resultRows<{ type: string }>(
    await db.execute(sql`select l.type from instances i join locations l on l.id = i.location_id
      where i.edition_id = ${editionId}::uuid and i.status <> 'deaccessioned'`),
  );
  const candidates = rankCandidates(raw2, {
    workTitle: edition.work.title,
    authors,
    language: edition.language,
    digitalCopies: copies.length > 0 && copies.every((c) => c.type === "digital"),
    owned,
    houseName: agreement[0]?.hint ?? null,
  }, !!isbn);
  return {
    query: q,
    candidates: candidates.slice(0, SHOWN_AT_MOST),
    eligible: candidates.length,
    found: books.length,
  };
}

const undoSchema = z.object({
  before: z.partialRecord(z.enum(MATCH_FIELDS), z.union([z.string(), z.number(), z.null()])),
  after: z.partialRecord(z.enum(MATCH_FIELDS), z.union([z.string(), z.number(), z.null()])),
  previousSource: z.string().nullable(),
});
export type IdentifyUndo = z.infer<typeof undoSchema>;

export interface Identified {
  title: string | null;
  publisher: string | null;
  year: number | null;
  changed: number;
  coverSkipped: boolean;
  undo: IdentifyUndo;
}

async function placeholder(editionId: string) {
  const edition = await loadMatchEdition(editionId);
  if (!isPlaceholderEdition(edition))
    throw new Error("This edition is already identified. Use Match on the book page.");
  if (edition.metadataLocked)
    throw new Error("Unlock this edition before you identify it");
  return edition;
}

/**
 * Makes the placeholder the ISBNdb edition with this ISBN. Every field
 * Match would tick is saved; a distributor name is left out, and an ISBN
 * another edition holds stops the save.
 */
export async function identifyEdition(
  editionId: string,
  isbn13: string,
): Promise<Identified> {
  const edition = await placeholder(editionId);
  const record = await fetchSourceRecord("isbndb", isbn13);
  const { rows } = await planRecord(edition, record);
  const blocked = rows.find((r) => r.blocked);
  if (blocked) throw new Error(`ISBN ${blocked.next}: ${blocked.blocked}`);
  const saved = await saveMatch(edition, {
    source: "isbndb",
    sourceId: isbn13,
    record,
    rows,
    accepted: rows.filter((r) => r.checked).map((r) => ({ field: r.field, value: r.next })),
    coverOptional: true,
  });
  return {
    title: record.title,
    publisher: record.publisher,
    year: record.publicationYear,
    changed: saved.changed,
    coverSkipped: saved.coverSkipped,
    undo: {
      before: saved.before as Record<MatchField, MatchValue>,
      after: saved.after as Record<MatchField, MatchValue>,
      previousSource: saved.previousSource,
    },
  };
}

/** Keeps a placeholder as it is: an edition without an ISBN (an old book) */
export async function keepWithoutIsbn(editionId: string): Promise<IdentifyUndo> {
  const edition = await placeholder(editionId);
  await db
    .update(editions)
    .set({ metadataSource: KEPT_WITHOUT_ISBN, updatedAt: new Date() })
    .where(eq(editions.id, editionId));
  recordActivity("work", edition.work.id, "work.edition_kept_without_isbn", {
    targetId: editionId,
    targetName: edition.title,
  });
  return { before: {}, after: {}, previousSource: edition.metadataSource };
}

/**
 * Undoes an identification or a "keep without ISBN": the saved fields get
 * their old values back and the edition is a placeholder again. Refused when
 * the edition changed after it.
 */
export async function undoIdentification(editionId: string, input: IdentifyUndo) {
  const undo = undoSchema.parse(input);
  const edition = await loadMatchEdition(editionId);
  const fields = Object.keys(undo.after) as MatchField[];
  const now = (field: MatchField): MatchValue =>
    field === "cover"
      ? edition.coverSourceUrl
      : (edition[MATCH_COLUMN[field]] as MatchValue);
  const changed = fields.some((f) => !sameMatchValue(f, now(f), undo.after[f] ?? null));
  const kept = !fields.length && edition.metadataSource === KEPT_WITHOUT_ISBN;
  if (changed || (!fields.length && !kept) || (fields.length && edition.metadataSource !== "isbndb"))
    throw new Error("The edition changed after this. Undo it by hand.");
  if (undo.before.cover !== undefined && undo.before.cover !== null)
    throw new Error("The old cover cannot be restored. Undo it by hand.");

  const updates: Partial<typeof editions.$inferInsert> = {
    metadataSource: undo.previousSource,
    updatedAt: new Date(),
  };
  if (fields.length) updates.metadataLastFetched = null;
  for (const field of fields) {
    if (field === "cover") {
      updates.coverS3Key = null;
      updates.thumbnailS3Key = null;
      updates.coverSourceUrl = null;
    } else {
      Object.assign(updates, { [MATCH_COLUMN[field]]: undo.before[field] ?? null });
    }
  }
  await db.update(editions).set(updates).where(eq(editions.id, editionId));
  await autoResolveEditions([editionId]);
  if (fields.includes("cover"))
    await deleteUnusedObjects(
      {
        keys: [edition.coverS3Key, edition.thumbnailS3Key].filter(Boolean) as string[],
        prefixes: [],
      },
      `undo identification of edition ${editionId}`,
    );
  recordActivity("work", edition.work.id, "work.match_undone", {
    targetId: editionId,
    targetName: edition.title,
  });
}

/**
 * A placeholder whose book already has the identified edition: its copies
 * and collections move to that edition, and the empty placeholder is
 * removed. Refused when anything else refers to the placeholder.
 */
export async function moveToExistingEdition(placeholderId: string, editionId: string) {
  const source = await placeholder(placeholderId);
  const target = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!target || target.workId !== source.workId || target.id === source.id)
    throw new Error("Choose an edition of the same book");
  if (isPlaceholderEdition(target)) throw new Error("Choose an identified edition");
  if (source.coverS3Key || source.thumbnailS3Key)
    throw new Error("The placeholder has a cover. Delete it by hand.");
  const [refs] = resultRows<Record<string, number>>(
    await db.execute(sql`select
      (select count(*)::int from orders where edition_id = ${placeholderId}::uuid) as orders,
      (select count(*)::int from acquisition_targets where edition_id = ${placeholderId}::uuid) as "hunting targets",
      (select count(*)::int from edition_contributors where edition_id = ${placeholderId}::uuid) as contributors,
      (select count(*)::int from edition_genres where edition_id = ${placeholderId}::uuid) as genres,
      (select count(*)::int from edition_tags where edition_id = ${placeholderId}::uuid) as tags,
      (select count(*)::int from custom_taxonomy_item_editions where edition_id = ${placeholderId}::uuid) as "taxonomy items",
      (select count(*)::int from catalogue_identifiers where edition_id = ${placeholderId}::uuid) as identifiers,
      (select count(*)::int from source_records where edition_id = ${placeholderId}::uuid) as "source records"`),
  );
  const held = Object.entries(refs).filter(([, n]) => n > 0).map(([k]) => k);
  if (held.length)
    throw new Error(`The placeholder still has ${held.join(", ")}. Move them by hand first.`);

  const [moved] = resultRows<{ copies: number; collections: number }>(
    await db.execute(sql`select
      (select count(*)::int from instances where edition_id = ${placeholderId}::uuid) as copies,
      (select count(*)::int from collection_editions where edition_id = ${placeholderId}::uuid) as collections`),
  );
  await atomic((d) => [
    d.execute(sql`update instances set edition_id = ${editionId}::uuid, updated_at = now()
      where edition_id = ${placeholderId}::uuid`),
    d.execute(sql`insert into collection_editions (collection_id, edition_id, sort_order, added_at)
      select collection_id, ${editionId}::uuid, sort_order, added_at from collection_editions
      where edition_id = ${placeholderId}::uuid on conflict do nothing`),
    d.execute(sql`delete from editions where id = ${placeholderId}::uuid
      and metadata_source = ${PLACEHOLDER_SOURCE}`),
  ]);
  recordActivity("work", source.work.id, "work.placeholder_replaced", {
    targetId: editionId,
    targetName: target.title,
    editionIsbn: target.isbn13 ?? undefined,
    extra: { placeholderId, copies: moved.copies, collections: moved.collections },
  });
  return moved;
}
