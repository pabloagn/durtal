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
import { resultRows } from "@/lib/publishers/resolution";
import type { MatchField, MatchPlan, MatchValue } from "@/lib/match/plan";
import {
  MATCH_SOURCE_LABEL,
  fetchSourceRecord,
  type MatchSource,
} from "@/lib/match/source";
import { loadMatchEdition, planRecord, saveMatch } from "@/lib/match/save";

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
  const edition = await loadMatchEdition(editionId);
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
  const result = await planRecord(
    edition,
    await fetchSourceRecord(source, sourceId),
  );
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
  const edition = await loadMatchEdition(editionId);
  if (edition.metadataLocked)
    throw new Error("Unlock this edition before you match it again");
  if (!accepted.length && !(relink && edition.publisherLinksConfirmed))
    return { changed: 0 };
  const record = await fetchSourceRecord(source, sourceId);
  const { rows } = await planRecord(edition, record);
  const saved = await saveMatch(edition, {
    source,
    sourceId,
    record,
    rows,
    accepted,
    relink,
  });
  return { changed: saved.changed };
}
