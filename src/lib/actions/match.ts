"use server";

/**
 * Match with a preview (task 0184). `previewMatch` reads the source and
 * compares it with the edition; `applyMatch` saves only the fields the
 * reader ticked, after it reads the source again and checks that each value
 * is still the one the reader saw.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions } from "@/lib/db/schema";
import { processAndUploadCover } from "@/lib/s3/covers";
import { recordActivity } from "@/lib/activity/record";
import { autoResolveEditions, resultRows } from "@/lib/publishers/resolution";
import {
  MATCH_FIELD_LABEL,
  planMatch,
  sameMatchValue,
  type MatchCurrent,
  type MatchField,
  type MatchPlan,
  type MatchValue,
} from "@/lib/match/plan";
import {
  MATCH_SOURCE_LABEL,
  fetchSourceRecord,
  type MatchSource,
  type SourceRecord,
} from "@/lib/match/source";

export interface MatchHouse {
  id: string;
  name: string;
  slug: string;
  kind: string;
  parentName: string | null;
  groupName: string | null;
}

export interface MatchHouses {
  /** Links set by hand: the publisher text does not change them */
  confirmed: boolean;
  current: MatchHouse[];
  next: MatchHouse[];
  /** The publisher text when no house has that name yet */
  unknownName: string | null;
}

/** The fields that decide the house */
export interface HouseFields {
  publisher: string | null;
  imprint: string | null;
  isbn13: string | null;
  isbn10: string | null;
}

export interface MatchPreview extends MatchPlan {
  locked: boolean;
  sourceLabel: string;
  /** The stored cover, for the cover row */
  currentCoverUrl: string | null;
  /** The edition's values of the fields that decide the house */
  current: HouseFields;
  houses: MatchHouses;
}

async function loadEdition(editionId: string) {
  const edition = await db.query.editions.findFirst({
    where: eq(editions.id, editionId),
    with: {
      work: {
        columns: { id: true, title: true },
        with: { workAuthors: { with: { author: { columns: { name: true } } } } },
      },
    },
  });
  if (!edition) throw new Error("Edition not found");
  return edition;
}
type Edition = Awaited<ReturnType<typeof loadEdition>>;

function currentValues(e: Edition): MatchCurrent {
  return {
    title: e.title,
    subtitle: e.subtitle,
    publisher: e.publisher,
    imprint: e.imprint,
    isbn13: e.isbn13,
    isbn10: e.isbn10,
    publicationYear: e.publicationYear,
    pageCount: e.pageCount,
    language: e.language,
    binding: e.binding,
    publicationCountry: e.publicationCountry,
    description: e.description,
    coverSourceUrl: e.coverSourceUrl,
    hasCover: !!(e.coverS3Key || e.thumbnailS3Key),
  };
}

async function plan(e: Edition, record: SourceRecord) {
  const digits13 = sql`regexp_replace(coalesce(e.isbn_13, ''), '[^0-9]', '', 'g')`;
  const digits10 = sql`upper(regexp_replace(coalesce(e.isbn_10, ''), '[^0-9Xx]', '', 'g'))`;
  const owners = resultRows<{ on13: boolean; on10: boolean; title: string }>(
    await db.execute(sql`
      select ${digits13} = ${record.isbn13 ?? "-"} as on13,
        ${digits10} = ${record.isbn10 ?? "-"} as on10, w.title
      from editions e join works w on w.id = e.work_id
      where e.id <> ${e.id}::uuid
        and (${digits13} = ${record.isbn13 ?? "-"} or ${digits10} = ${record.isbn10 ?? "-"})`),
  );
  const isbnOwners = {
    isbn13: owners.find((o) => o.on13)?.title,
    isbn10: owners.find((o) => o.on10)?.title,
  };
  return planMatch(currentValues(e), record, {
    workTitle: e.work.title,
    authors: e.work.workAuthors.map((a) => a.author.name),
    isbnOwners,
  });
}

const HOUSE_COLUMNS = sql`h.id, h.name, h.slug, h.kind,
  p.name as "parentName", g.name as "groupName"`;
const HOUSE_JOINS = sql`join publishing_houses h on h.id = m.id
  left join publishing_houses p on p.id = h.parent_id
  left join publishing_houses g on g.id = p.parent_id`;

async function houses(editionId: string, values: HouseFields) {
  const [current, next, edition, unknown] = await Promise.all([
    db.execute(sql`select ${HOUSE_COLUMNS}
      from (select publisher_id as id from edition_publishers
        where edition_id = ${editionId}::uuid) m ${HOUSE_JOINS} order by h.name`),
    db.execute(sql`select ${HOUSE_COLUMNS}
      from unnest(edition_publisher_matches(${values.publisher}::text, ${values.imprint}::text,
        edition_isbn_digits(${values.isbn13}::text, ${values.isbn10}::text))) with ordinality as m(id, n)
      ${HOUSE_JOINS} order by m.n`),
    db.query.editions.findFirst({
      where: eq(editions.id, editionId),
      columns: { publisherLinksConfirmed: true },
    }),
    db.execute(sql`select ${values.publisher}::text as name
      where nullif(trim(${values.publisher}::text), '') is not null
        and not exists (select 1 from publisher_candidates(${values.publisher}::text))
        and not exists (select 1 from ignored_publisher_names
          where name_key = publisher_name_key(${values.publisher}::text))`),
  ]);
  return {
    confirmed: edition?.publisherLinksConfirmed ?? false,
    current: resultRows<MatchHouse>(current),
    next: resultRows<MatchHouse>(next),
    unknownName: resultRows<{ name: string }>(unknown)[0]?.name ?? null,
  } satisfies MatchHouses;
}

/** The houses the edition links to with these values, for the preview */
export async function previewMatchHouses(
  editionId: string,
  values: HouseFields,
): Promise<MatchHouses> {
  return houses(editionId, values);
}

/** What a source record would change, field by field. Writes nothing. */
export async function previewMatch(
  editionId: string,
  source: MatchSource,
  sourceId: string,
): Promise<MatchPreview> {
  const edition = await loadEdition(editionId);
  const current: HouseFields = {
    publisher: edition.publisher,
    imprint: edition.imprint,
    isbn13: edition.isbn13,
    isbn10: edition.isbn10,
  };
  const coverKey = edition.thumbnailS3Key ?? edition.coverS3Key;
  const base = {
    locked: edition.metadataLocked,
    sourceLabel: MATCH_SOURCE_LABEL[source] ?? source,
    currentCoverUrl: coverKey
      ? `/api/s3/read?key=${encodeURIComponent(coverKey)}`
      : null,
    current,
  };
  if (edition.metadataLocked)
    return {
      ...base,
      rows: [],
      newEdition: false,
      same: 0,
      warnings: [],
      houses: await houses(editionId, current),
    };
  const result = await plan(edition, await fetchSourceRecord(source, sourceId));
  // The house with every ticked value
  const ticked = (field: keyof HouseFields) => {
    const row = result.rows.find((r) => r.field === field && r.checked);
    return row ? (row.next as string | null) : current[field];
  };
  return {
    ...base,
    ...result,
    houses: await houses(editionId, {
      publisher: ticked("publisher"),
      imprint: ticked("imprint"),
      isbn13: ticked("isbn13"),
      isbn10: ticked("isbn10"),
    }),
  };
}

const COLUMN: Record<Exclude<MatchField, "cover">, keyof typeof editions.$inferInsert> = {
  title: "title",
  subtitle: "subtitle",
  publisher: "publisher",
  imprint: "imprint",
  isbn13: "isbn13",
  isbn10: "isbn10",
  publicationYear: "publicationYear",
  pageCount: "pageCount",
  language: "language",
  binding: "binding",
  publicationCountry: "publicationCountry",
  description: "description",
};

/**
 * Saves the ticked fields. Each value must still be the one the preview
 * showed; a source that answers differently now stops the save.
 * `relink` lets links set by hand follow the new data again.
 */
export async function applyMatch(
  editionId: string,
  source: MatchSource,
  sourceId: string,
  accepted: { field: MatchField; value: MatchValue }[],
  relink = false,
) {
  const edition = await loadEdition(editionId);
  if (edition.metadataLocked)
    throw new Error("Unlock this edition before you match it again");
  if (!accepted.length && !(relink && edition.publisherLinksConfirmed))
    return { changed: 0 };

  const record = await fetchSourceRecord(source, sourceId);
  const { rows } = await plan(edition, record);
  const updates: Partial<typeof editions.$inferInsert> = {};
  const before: Record<string, MatchValue> = {};
  const after: Record<string, MatchValue> = {};
  let coverUrl: string | null = null;
  for (const { field, value } of accepted) {
    const row = rows.find((r) => r.field === field);
    const label = MATCH_FIELD_LABEL[field];
    if (!row || !sameMatchValue(field, row.next, value))
      throw new Error(`${label} changed since the preview. Search again.`);
    if (row.blocked) throw new Error(`${label}: ${row.blocked}`);
    before[field] = row.current;
    after[field] = row.next;
    if (field === "cover") coverUrl = row.next as string;
    else Object.assign(updates, { [COLUMN[field]]: row.next });
  }

  if (coverUrl) {
    const cover = await processAndUploadCover(editionId, coverUrl);
    if (!cover)
      throw new Error("The cover could not be downloaded. Untick it and save again.");
    updates.coverS3Key = cover.coverKey;
    updates.thumbnailS3Key = cover.thumbnailKey;
    updates.coverSourceUrl = coverUrl;
  }
  if (relink && edition.publisherLinksConfirmed)
    updates.publisherLinksConfirmed = false;
  if (accepted.length) {
    updates.metadataSource = source;
    updates.metadataLastFetched = new Date();
    if (record.googleBooksId) updates.googleBooksId = record.googleBooksId;
    if (record.openLibraryKey) updates.openLibraryKey = record.openLibraryKey;
  }
  updates.updatedAt = new Date();

  // The trigger relinks the house when the publisher, imprint or ISBN change
  await db.update(editions).set(updates).where(eq(editions.id, editionId));
  await autoResolveEditions([editionId]);

  recordActivity("work", edition.work.id, "work.rematched", {
    targetId: editionId,
    targetName: edition.title,
    newValue: MATCH_SOURCE_LABEL[source] ?? source,
    extra: {
      source,
      sourceId,
      fields: accepted.map((a) => MATCH_FIELD_LABEL[a.field]),
      before,
      after,
      relinked: updates.publisherLinksConfirmed === false,
    },
  });
  return { changed: accepted.length };
}
