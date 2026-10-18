"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  addMembers,
  addWorkMembers,
  idArray,
  lockCollection,
  moveMember,
} from "@/lib/collections/members";
import {
  collections,
  collectionEditions,
  collectionWorks,
  editions,
  works,
  media,
} from "@/lib/db/schema";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import { textContains, textSearchCondition } from "@/lib/actions/utils/text-search";
import { eq, asc, count, ilike, or, sql, inArray, and } from "drizzle-orm";
import { containsPattern } from "@/lib/utils/like";
import { authorSearchCondition } from "@/lib/actions/utils/author-search";
import {
  collectionDetailsSchema,
  collectionIdsSchema,
  collectionUpdateSchema,
} from "@/lib/validations/collections";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { collectionCounts } from "@/lib/collections/counts";
import { byAddRecency } from "@/lib/collections/recency";
import { resultRows } from "@/lib/harmonization/store";
import { icons } from "lucide-react";

function changed() {
  invalidate(
    CACHE_TAGS.collections,
    CACHE_TAGS.works,
    CACHE_TAGS.activity,
    CACHE_TAGS.media,
  );
}
/** Active poster and background rows, the same presentation data works and authors use. */
const activeArtwork = {
  where: eq(media.isActive, true),
  orderBy: [asc(media.type), asc(media.sortOrder)],
};

/** Enough of each member to count it as the page shows it (collectionCounts) */
const memberSummary = {
  collectionEditions: {
    columns: { editionId: true },
    with: { edition: { columns: { workId: true } } },
  },
  // Each whole work's kind, for the count line ("3 books · 1 perfume")
  collectionWorks: { columns: { workId: true }, with: { work: { columns: { kind: true } } } },
  media: activeArtwork,
} as const;

function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}
export async function getCollections(pagination?: {
  limit: number;
  offset: number;
  query?: string;
  favourites?: boolean;
}) {
  const search = (pagination?.query ?? "").trim().slice(0, 160);
  return db.query.collections.findMany({
    where: collectionListCondition(search, pagination?.favourites),
    orderBy: [
      asc(collections.sortOrder),
      asc(collections.name),
      asc(collections.id),
    ],
    limit: pagination?.limit,
    offset: pagination?.offset,
    with: memberSummary,
  });
}
export async function getCollectionCount(query = "", favourites = false) {
  const value = query.trim().slice(0, 160);
  const [result] = await db
    .select({ count: count() })
    .from(collections)
    .where(collectionListCondition(value, favourites));
  return result.count;
}

/** The collections a list shows: by name, and favourites only when asked */
function collectionListCondition(search: string, favourites?: boolean) {
  return and(
    // Accents and case ignored, as every search (SLN-881)
    search ? textContains(collections.name, search) : undefined,
    favourites ? eq(collections.isFavourite, true) : undefined,
  );
}
export async function getCollection(id: string) {
  z.string().uuid().parse(id);
  return db.query.collections.findFirst({
    where: eq(collections.id, id),
    with: {
      media: activeArtwork,
      collectionEditions: {
        orderBy: [
          asc(collectionEditions.sortOrder),
          asc(collectionEditions.addedAt),
          asc(collectionEditions.editionId),
        ],
        with: {
          edition: {
            with: {
              work: {
                with: {
                  workAuthors: {
                    orderBy: (a, { asc }) => [
                      asc(a.sortOrder),
                      asc(a.authorId),
                    ],
                    with: { author: true },
                  },
                  media: {
                    where: (m, { and, eq }) =>
                      and(eq(m.type, "poster"), eq(m.isActive, true)),
                    limit: 1,
                  },
                },
              },
              instances: { columns: { id: true } },
            },
          },
        },
      },
      collectionWorks: {
        orderBy: [
          asc(collectionWorks.sortOrder),
          asc(collectionWorks.addedAt),
          asc(collectionWorks.workId),
        ],
        with: {
          work: {
            columns: { id: true, kind: true, title: true, slug: true },
            with: {
              workAuthors: {
                orderBy: (a, { asc }) => [asc(a.sortOrder), asc(a.authorId)],
                with: { author: { columns: { name: true } } },
              },
              media: {
                where: (m, { and, eq }) =>
                  and(eq(m.type, "poster"), eq(m.isActive, true)),
                limit: 1,
              },
              // A whole book with no poster shows its first edition cover
              editions: {
                columns: { thumbnailS3Key: true, coverS3Key: true },
                where: (e, { or, isNotNull }) => or(isNotNull(e.thumbnailS3Key), isNotNull(e.coverS3Key)),
                orderBy: (e, { asc }) => [asc(e.createdAt), asc(e.id)],
                limit: 1,
              },
            },
          },
        },
      },
    },
  });
}

/** A retry with the same request ID cannot create a second collection. Membership and events commit together. */
export async function createCollection(
  input: z.input<typeof collectionDetailsSchema>,
  editionIds: string[] = [],
  requestId?: string,
  /** Whole works to add after the editions (films, perfumes, paintings, books with no edition) */
  workIds: string[] = [],
) {
  const data = collectionDetailsSchema.parse(input);
  const ids = collectionIdsSchema.parse(editionIds);
  const wids = collectionIdsSchema.parse(workIds);
  const id = requestId ? z.string().uuid().parse(requestId) : randomUUID();
  await atomic((d) => [
    d
      .insert(collections)
      .values({ ...data, id })
      .onConflictDoNothing(),
    d.execute(lockCollection(id)),
    ...(ids.length ? [d.execute(addMembers(id, ids))] : []),
    ...(wids.length ? [d.execute(addWorkMembers(id, wids))] : []),
  ]);
  changed();
  return (await db.select().from(collections).where(eq(collections.id, id)))[0];
}
export async function updateCollection(
  id: string,
  input: z.input<typeof collectionUpdateSchema>,
) {
  z.string().uuid().parse(id);
  const data = collectionUpdateSchema.parse(input);
  const [row] = await db
    .update(collections)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning();
  if (!row) throw new Error("Collection no longer exists");
  changed();
  return row;
}
/** The SQL that removes editions from a collection, with one activity per work */
function removeEditionMembers(collectionId: string, ids: string[]) {
  return sql`with removed as (
    delete from collection_editions where collection_id=${collectionId}::uuid and edition_id=any(${idArray(ids)}) returning edition_id
  ), events as (
    insert into activity_events(entity_type,entity_id,event_key,metadata)
    select distinct 'work',e.work_id,'work.collection_removed',jsonb_build_object('collectionName',c.name,'extra',jsonb_build_object('collectionId',c.id))
    from removed join editions e on e.id=removed.edition_id cross join collections c where c.id=${collectionId}::uuid
  ) select count(*)::int as changed from removed`;
}

/** The SQL that removes whole works from a collection, with one activity each */
function removeWorkMembers(collectionId: string, ids: string[]) {
  return sql`with removed as (
    delete from collection_works where collection_id=${collectionId}::uuid and work_id=any(${idArray(ids)}) returning work_id
  ), events as (
    insert into activity_events(entity_type,entity_id,event_key,metadata)
    select 'work',removed.work_id,'work.collection_removed',jsonb_build_object('collectionName',c.name,'extra',jsonb_build_object('collectionId',c.id))
    from removed cross join collections c where c.id=${collectionId}::uuid
  ) select count(*)::int as changed from removed`;
}

/** Editions and whole works for one membership change, each list checked */
function memberIds(members: { editionIds?: string[]; workIds?: string[] }) {
  return {
    editionIds: collectionIdsSchema.parse(members.editionIds ?? []),
    workIds: collectionIdsSchema.parse(members.workIds ?? []),
  };
}

/** The changed rows of each write after the lock, summed */
function changedRows(results: unknown[]) {
  return {
    changed: results
      .slice(1)
      .reduce<number>((sum, result) => sum + (rows<{ changed: number }>(result)[0]?.changed ?? 0), 0),
  };
}

/**
 * Adds editions and whole works (films, perfumes, paintings, or books with
 * no edition chosen) in one transaction (SLN-573): either every member joins
 * or none does, so a member deleted meanwhile never leaves the others half
 * added. New members join the collection's one order after its last member;
 * members already there are skipped.
 */
export async function addToCollection(
  collectionId: string,
  members: { editionIds?: string[]; workIds?: string[] },
) {
  z.string().uuid().parse(collectionId);
  const { editionIds, workIds } = memberIds(members);
  if (!editionIds.length && !workIds.length) return { changed: 0 };
  if (workIds.length) {
    // Only works of an open collection can join
    const open = await db
      .select({ id: works.id })
      .from(works)
      .where(and(inArray(works.id, workIds), inArray(works.kind, getEnabledWorkKinds())));
    if (open.length !== workIds.length) throw new Error("A work was not found");
  }
  const result = await atomic((d) => [
    d.execute(lockCollection(collectionId)),
    ...(editionIds.length ? [d.execute(addMembers(collectionId, editionIds))] : []),
    ...(workIds.length ? [d.execute(addWorkMembers(collectionId, workIds))] : []),
  ]);
  changed();
  return changedRows(result);
}

/** Removes editions and whole works in one transaction (SLN-573) */
export async function removeFromCollection(
  collectionId: string,
  members: { editionIds?: string[]; workIds?: string[] },
) {
  z.string().uuid().parse(collectionId);
  const { editionIds, workIds } = memberIds(members);
  if (!editionIds.length && !workIds.length) return { changed: 0 };
  const result = await atomic((d) => [
    d.execute(lockCollection(collectionId)),
    ...(editionIds.length ? [d.execute(removeEditionMembers(collectionId, editionIds))] : []),
    ...(workIds.length ? [d.execute(removeWorkMembers(collectionId, workIds))] : []),
  ]);
  changed();
  return changedRows(result);
}

export async function bulkAddEditionsToCollection(
  collectionId: string,
  editionIds: string[],
) {
  return addToCollection(collectionId, { editionIds });
}
export async function removeEditionsFromCollection(
  collectionId: string,
  editionIds: string[],
) {
  return removeFromCollection(collectionId, { editionIds });
}
export async function removeEditionFromCollection(
  collectionId: string,
  editionId: string,
) {
  return removeEditionsFromCollection(collectionId, [editionId]);
}

/** Adds whole works: films, perfumes, paintings, or books with no edition chosen */
export async function bulkAddWorksToCollection(collectionId: string, workIds: string[]) {
  return addToCollection(collectionId, { workIds });
}
export async function removeWorksFromCollection(collectionId: string, workIds: string[]) {
  return removeFromCollection(collectionId, { workIds });
}

/**
 * Moves an edition or a whole work one place in the collection's one order
 * (the complete collection, not just the visible page).
 */
export async function moveCollectionMember(
  collectionId: string,
  member: { kind: "edition" | "work"; id: string },
  direction: -1 | 1,
) {
  z.string().uuid().parse(collectionId);
  const m = z.object({ kind: z.enum(["edition", "work"]), id: z.string().uuid() }).parse(member);
  z.union([z.literal(-1), z.literal(1)]).parse(direction);
  await atomic((d) => [
    d.execute(lockCollection(collectionId)),
    d.execute(moveMember(collectionId, m, direction)),
  ]);
  changed();
}

/** Move within the complete collection, not just the currently visible page. */
export async function moveCollectionEdition(
  collectionId: string,
  editionId: string,
  direction: -1 | 1,
) {
  return moveCollectionMember(collectionId, { kind: "edition", id: editionId }, direction);
}

/**
 * Works to add to a collection, by title, from one open collection kind;
 * books carry their authors. Already-held works are marked by the caller.
 */
export async function searchWorksForCollection(search: string, kind: WorkKind, limit = 30) {
  const value = z.string().trim().max(300).parse(search);
  const k = z.enum(WORK_KINDS).parse(kind);
  const size = z.number().int().min(1).max(100).parse(limit);
  if (!getEnabledWorkKinds().includes(k)) return [];
  // Each query word may match the title or a creator: every name form of an
  // author, director, perfumer or painter, or the credited text of a credit
  // with no person ("huysmans damned" finds "The Damned").
  const searchText = sql`concat_ws(' ', search_normalize(w.title),
    (select string_agg(a.search_text, ' ') from work_authors wa join authors a on a.id=wa.author_id where wa.work_id=w.id),
    (select string_agg(coalesce(a.search_text, search_normalize(c.credited_as)), ' ') from work_credits c left join authors a on a.id=c.person_id
      where c.work_id=w.id and c.role_id in ('film.director','perfume.perfumer','painting.painter')))`;
  const match = value ? textSearchCondition(searchText, value) : undefined;
  return rows<{
    workId: string;
    kind: WorkKind;
    title: string;
    creators: string | null;
    imageS3Key: string | null;
  }>(
    await db.execute(sql`select w.id as "workId", w.kind, w.title,
      coalesce(
        (select string_agg(a.name, ' & ' order by wa.sort_order, a.id) from work_authors wa join authors a on a.id=wa.author_id where wa.work_id=w.id),
        (select string_agg(coalesce(a.name, c.credited_as), ' & ' order by c.sort_order, c.id) from work_credits c left join authors a on a.id=c.person_id
          where c.work_id=w.id and c.role_id in ('film.director','perfume.perfumer','painting.painter') and coalesce(a.name, c.credited_as) is not null)
      ) as creators,
      (select coalesce(m.thumbnail_s3_key, m.s3_key) from media m where m.work_id=w.id and m.type='poster' and m.is_active order by m.id limit 1) as "imageS3Key"
      from works w where w.kind=${k} ${match ? sql`and ${match}` : sql``}
      order by lower(w.title), w.id limit ${size}`),
  );
}

/**
 * When each collection last gained a member, in epoch milliseconds. A
 * membership's `added_at` is set once, by the insert that adds it: adding
 * something already there inserts nothing, and removing, reordering, renaming
 * or a new cover never touch it. So the latest one is the last real addition,
 * single or bulk, on every device. Read live for the picker (SLN-570).
 */
async function collectionAddRecency(): Promise<Map<string, number>> {
  const rows = resultRows<{ collection_id: string; last_added: number }>(
    await db.execute(sql`
      select collection_id, (extract(epoch from max(added_at)) * 1000)::float8 as last_added from (
        select collection_id, added_at from collection_editions
        union all
        select collection_id, added_at from collection_works
      ) members group by collection_id`),
  );
  return new Map(rows.map((row) => [row.collection_id, Number(row.last_added)]));
}
export async function getCollectionSelection(
  workIds: string[],
  editionIds: string[] = [],
) {
  const wids = collectionIdsSchema.parse(workIds),
    eids = collectionIdsSchema.parse(editionIds);
  const [cols, lastAdded, selected, selectedWorks] = await Promise.all([
    getCollections(),
    collectionAddRecency(),
    wids.length || eids.length
      ? db.query.editions.findMany({
          where: or(
            wids.length ? inArray(editions.workId, wids) : undefined,
            eids.length ? inArray(editions.id, eids) : undefined,
          ),
          orderBy: [
            asc(editions.title),
            asc(editions.publicationYear),
            asc(editions.id),
          ],
          columns: {
            id: true,
            title: true,
            workId: true,
            publisher: true,
            publicationYear: true,
            language: true,
            isbn13: true,
          },
        })
      : [],
    wids.length
      ? db
          .select({ id: works.id, title: works.title, kind: works.kind })
          .from(works)
          .where(and(inArray(works.id, wids), inArray(works.kind, getEnabledWorkKinds())))
      : [],
  ]);
  return {
    collections: byAddRecency(cols, lastAdded),
    editions: selected,
    /**
     * Works that join as whole works: films, perfumes, paintings, and books
     * with no edition (no placeholder edition is made for them)
     */
    works: selectedWorks.filter(
      (w) => !(w.kind === "book" && selected.some((e) => e.workId === w.id)),
    ),
  };
}
export async function getEditionCollections(editionId: string) {
  z.string().uuid().parse(editionId);
  const result = await db.query.collectionEditions.findMany({
    where: eq(collectionEditions.editionId, editionId),
    with: { collection: true },
  });
  return result.map((ce) => ce.collection);
}
export async function searchEditionsForPicker(search: string, limit = 30) {
  const value = z.string().trim().max(300).parse(search);
  const size = z.number().int().min(1).max(100).parse(limit);
  const authorCondition =
    authorSearchCondition(value, { fuzzy: false }) ?? sql`false`;
  const term = containsPattern(value);
  return db
    .select({
      editionId: editions.id,
      editionTitle: editions.title,
      thumbnailS3Key: sql<
        string | null
      >`coalesce(${editions.thumbnailS3Key},${editions.coverS3Key},(select coalesce(m.thumbnail_s3_key,m.s3_key) from media m where m.work_id=${works.id} and m.type='poster' and m.is_active order by m.id limit 1))`,
      publicationYear: editions.publicationYear,
      publisher: editions.publisher,
      isbn13: editions.isbn13,
      language: editions.language,
      workId: works.id,
      workTitle: works.title,
      authorName: sql<
        string | null
      >`(select string_agg(a.name, ' & ' order by wa.sort_order,a.id) from work_authors wa join authors a on a.id=wa.author_id where wa.work_id=${works.id})`,
    })
    .from(editions)
    .innerJoin(works, eq(works.id, editions.workId))
    .where(
      value
        ? or(
            // Accents and case ignored, as the author match (SLN-881)
            textContains(editions.title, value),
            textContains(works.title, value),
            ilike(editions.isbn13, term),
            ilike(editions.isbn10, term),
            sql`exists(select 1 from work_authors wa join authors on authors.id=wa.author_id where wa.work_id=${works.id} and ${authorCondition})`,
          )
        : undefined,
    )
    .orderBy(asc(works.title), asc(editions.publicationYear), asc(editions.id))
    .limit(size);
}

/** Sets or clears a collection's icon. Only real Lucide icon names are stored. */
export async function setCollectionIcon(id: string, icon: string | null) {
  z.string().uuid().parse(id);
  const value = z
    .string()
    .max(64)
    .refine((name) => Object.hasOwn(icons, name), "Unknown icon")
    .nullable()
    .parse(icon);
  const [row] = await db
    .update(collections)
    .set({ icon: value, updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning({ icon: collections.icon });
  if (!row) throw new Error("Collection not found");
  changed();
  return row;
}

export async function deleteCollection(id: string) {
  z.string().uuid().parse(id);
  const results = await atomic((d) => [
    d.execute(lockCollection(id)),
    d.execute(sql`with affected as (
    select e.work_id from collection_editions ce join editions e on e.id=ce.edition_id where ce.collection_id=${id}::uuid
    union select cw.work_id from collection_works cw where cw.collection_id=${id}::uuid
  ), removed as (delete from collections where id=${id}::uuid returning *), events as (
    insert into activity_events(entity_type,entity_id,event_key,metadata)
    select 'work',affected.work_id,'work.collection_removed',jsonb_build_object('collectionName',removed.name,'extra',jsonb_build_object('collectionId',removed.id)) from affected cross join removed
  ) select * from removed`),
  ]);
  const [removed] = rows<Record<string, unknown>>(results[1]);
  changed();
  if (!removed) return { id, cleanupPending: false };
  const { cleanupCollectionArtwork } =
    await import("@/lib/s3/collection-cleanup");
  // Media rows went with the collection (cascade); sweep its S3 namespace.
  const cleanupPending = await cleanupCollectionArtwork(id, []);
  return { id, cleanupPending };
}

export async function getCollectionCoverPreviews(collectionIds: string[]) {
  const ids = collectionIdsSchema.parse(collectionIds);
  if (!ids.length) return [];
  // The first four images in each collection's one order: an edition's
  // cover (else its book's poster), a whole work's active image (else, for a
  // book, its first edition cover, as a series takes it)
  const poster = (work: ReturnType<typeof sql>) =>
    sql`(select coalesce(m.thumbnail_s3_key,m.s3_key) from media m where m.work_id=${work} and m.type='poster' and m.is_active order by m.id limit 1)`;
  const result =
    await db.execute(sql`select collection_id as "collectionId",cover as "s3Key" from (
    select collection_id, cover, row_number() over(partition by collection_id order by sort_order,added_at,member_id) as position from (
      select ce.collection_id,ce.sort_order,ce.added_at,ce.edition_id as member_id,
        coalesce(e.thumbnail_s3_key,e.cover_s3_key,${poster(sql`e.work_id`)}) as cover
      from collection_editions ce join editions e on e.id=ce.edition_id where ce.collection_id=any(${idArray(ids)})
      union all
      select cw.collection_id,cw.sort_order,cw.added_at,cw.work_id,coalesce(${poster(sql`cw.work_id`)},
        (select coalesce(e.thumbnail_s3_key,e.cover_s3_key) from editions e where e.work_id=cw.work_id and coalesce(e.thumbnail_s3_key,e.cover_s3_key) is not null order by e.created_at,e.id limit 1))
      from collection_works cw where cw.collection_id=any(${idArray(ids)})
        and not exists(select 1 from collection_editions ce join editions e on e.id=ce.edition_id where ce.collection_id=cw.collection_id and e.work_id=cw.work_id)
    ) members where cover is not null
  ) previews where position<=4 order by collection_id,position`);
  return rows<{ collectionId: string; s3Key: string }>(result);
}

/**
 * Collections that hold any edition of a work, for the book page. Each entry
 * lists which of the work's editions it holds, its size, and its active poster.
 */
export async function getCollectionsForWork(workId: string) {
  z.string().uuid().parse(workId);
  const memberships = await db
    .select({
      collectionId: collectionEditions.collectionId,
      editionId: editions.id,
      editionTitle: editions.title,
      publicationYear: editions.publicationYear,
    })
    .from(collectionEditions)
    .innerJoin(editions, eq(editions.id, collectionEditions.editionId))
    .where(eq(editions.workId, workId));
  // Collections that hold the work itself, with no edition chosen
  const asWork = await db
    .select({ collectionId: collectionWorks.collectionId })
    .from(collectionWorks)
    .where(eq(collectionWorks.workId, workId));
  const ids = [
    ...new Set([...memberships, ...asWork].map((m) => m.collectionId)),
  ];
  if (!ids.length) return [];
  const found = await db.query.collections.findMany({
    where: inArray(collections.id, ids),
    orderBy: [
      asc(collections.sortOrder),
      asc(collections.name),
      asc(collections.id),
    ],
    with: memberSummary,
  });
  return found.map((collection) => ({
    ...collection,
    ...collectionCounts(collection),
    /** The collection holds the work as a whole, not (only) an edition of it */
    holdsWork: asWork.some((m) => m.collectionId === collection.id),
    heldEditions: memberships
      .filter((m) => m.collectionId === collection.id)
      .map(({ editionId, editionTitle, publicationYear }) => ({
        editionId,
        editionTitle,
        publicationYear,
      })),
  }));
}
