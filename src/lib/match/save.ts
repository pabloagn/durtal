/**
 * The server side of Match (tasks 0184, 0187): load an edition, plan a
 * source record against it, and save the accepted fields. Shared by Match
 * and the queue that identifies placeholder editions. Server only.
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
  type MatchRow,
  type MatchValue,
} from "@/lib/match/plan";
import {
  MATCH_SOURCE_LABEL,
  type MatchSource,
  type SourceRecord,
} from "@/lib/match/source";

export async function loadMatchEdition(editionId: string) {
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
export type MatchEdition = Awaited<ReturnType<typeof loadMatchEdition>>;

function currentValues(e: MatchEdition): MatchCurrent {
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

/** Titles of other editions that hold these ISBNs */
export async function isbnOwners(
  editionId: string,
  isbn13: string | null,
  isbn10: string | null,
) {
  const digits13 = sql`regexp_replace(coalesce(e.isbn_13, ''), '[^0-9]', '', 'g')`;
  const digits10 = sql`upper(regexp_replace(coalesce(e.isbn_10, ''), '[^0-9Xx]', '', 'g'))`;
  const owners = resultRows<{ on13: boolean; on10: boolean; title: string }>(
    await db.execute(sql`
      select ${digits13} = ${isbn13 ?? "-"} as on13,
        ${digits10} = ${isbn10 ?? "-"} as on10, w.title
      from editions e join works w on w.id = e.work_id
      where e.id <> ${editionId}::uuid
        and (${digits13} = ${isbn13 ?? "-"} or ${digits10} = ${isbn10 ?? "-"})`),
  );
  return {
    isbn13: owners.find((o) => o.on13)?.title,
    isbn10: owners.find((o) => o.on10)?.title,
  };
}

export async function planRecord(e: MatchEdition, record: SourceRecord) {
  return planMatch(currentValues(e), record, {
    workTitle: e.work.title,
    authors: e.work.workAuthors.map((a) => a.author.name),
    isbnOwners: await isbnOwners(e.id, record.isbn13, record.isbn10),
  });
}

export const MATCH_COLUMN: Record<
  Exclude<MatchField, "cover">,
  keyof typeof editions.$inferInsert
> = {
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

export interface SavedMatch {
  changed: number;
  /** Old and new value of each saved field */
  before: Partial<Record<MatchField, MatchValue>>;
  after: Partial<Record<MatchField, MatchValue>>;
  /** The edition's metadata source before the save */
  previousSource: string | null;
  /** The cover could not be downloaded and was left out */
  coverSkipped: boolean;
}

/**
 * Saves the accepted fields. Each value must be the one the reader saw in
 * `rows` (planned from a fresh read of the source); a blocked value stops the
 * save. With `coverOptional`, a cover that cannot be downloaded is left out
 * instead of stopping the save.
 */
export async function saveMatch(
  edition: MatchEdition,
  input: {
    source: MatchSource;
    sourceId: string;
    record: SourceRecord;
    rows: MatchRow[];
    accepted: { field: MatchField; value: MatchValue }[];
    relink?: boolean;
    coverOptional?: boolean;
  },
): Promise<SavedMatch> {
  const { source, sourceId, record, rows, accepted } = input;
  const relink = !!input.relink && edition.publisherLinksConfirmed;
  const result: SavedMatch = {
    changed: 0,
    before: {},
    after: {},
    previousSource: edition.metadataSource,
    coverSkipped: false,
  };
  if (!accepted.length && !relink) return result;

  const updates: Partial<typeof editions.$inferInsert> = {};
  let coverUrl: string | null = null;
  for (const { field, value } of accepted) {
    const row = rows.find((r) => r.field === field);
    const label = MATCH_FIELD_LABEL[field];
    if (!row || !sameMatchValue(field, row.next, value))
      throw new Error(`${label} changed since the preview. Search again.`);
    if (row.blocked) throw new Error(`${label}: ${row.blocked}`);
    if (field === "cover") coverUrl = row.next as string;
    else Object.assign(updates, { [MATCH_COLUMN[field]]: row.next });
    result.before[field] = row.current;
    result.after[field] = row.next;
  }

  if (coverUrl) {
    const cover = await processAndUploadCover(edition.id, coverUrl);
    if (cover) {
      updates.coverS3Key = cover.coverKey;
      updates.thumbnailS3Key = cover.thumbnailKey;
      updates.coverSourceUrl = coverUrl;
    } else if (input.coverOptional) {
      result.coverSkipped = true;
      delete result.before.cover;
      delete result.after.cover;
    } else {
      throw new Error(
        "The cover could not be downloaded. Untick it and save again.",
      );
    }
  }
  const fields = Object.keys(result.after) as MatchField[];
  result.changed = fields.length;
  if (relink) updates.publisherLinksConfirmed = false;
  if (fields.length) {
    updates.metadataSource = source;
    updates.metadataLastFetched = new Date();
    if (record.googleBooksId) updates.googleBooksId = record.googleBooksId;
    if (record.openLibraryKey) updates.openLibraryKey = record.openLibraryKey;
  }
  updates.updatedAt = new Date();

  // The trigger relinks the house when the publisher, imprint or ISBN change
  await db.update(editions).set(updates).where(eq(editions.id, edition.id));
  await autoResolveEditions([edition.id]);

  recordActivity("work", edition.work.id, "work.rematched", {
    targetId: edition.id,
    targetName: edition.title,
    newValue: MATCH_SOURCE_LABEL[source] ?? source,
    extra: {
      source,
      sourceId,
      fields: fields.map((f) => MATCH_FIELD_LABEL[f]),
      before: result.before,
      after: result.after,
      previousSource: result.previousSource,
      relinked: relink,
    },
  });
  return result;
}
