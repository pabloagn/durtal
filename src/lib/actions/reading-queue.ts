"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { editions, readingQueue, readings, works } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import { requireBookWork, requireBookWorks } from "@/lib/catalogue/book-boundary";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { atHandCopySql } from "@/lib/reading/at-hand";
import { QUEUE_GAP } from "@/lib/reading/constants";
import { readingToday } from "@/lib/reading/day";
import { lastFinishedOnSql, readCountSql } from "@/lib/reading/summary";
import { positionBetween, renumbered, type QueueEdition } from "@/lib/reading/queue";
import {
  addManyToQueueSchema,
  addToQueueSchema,
  getQueueSchema,
  moveQueueItemSchema,
  queueSnapshotSchema,
  queueWorkSchema,
  updateQueueItemSchema,
} from "@/lib/validations/reading-queue";

/*
 * Up Next (SLN-452): the books he wants to read next, in his order. Books
 * only; it never changes catalogue_status. Starting a book takes it off the
 * list (createReading and writeReadings). Every write invalidates the reading
 * and works tags: the library's filter and sort read the queue.
 */

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
}

async function titleOf(workId: string) {
  const [row] = await db.select({ title: works.title }).from(works).where(eq(works.id, workId));
  return row?.title ?? "This book";
}

/** A queued book's row and its place in the list (1 for the top) */
async function queuedPlace(workId: string) {
  const [row] = resultRows<{ id: string; position: number; place: number }>(
    await db.execute(sql`select q.id, q.position,
        (select count(*)::int from reading_queue o where o.position < q.position or (o.position = q.position and o.work_id < q.work_id)) + 1 as place
      from reading_queue q where q.work_id = ${workId}::uuid`),
  );
  return row ?? null;
}

/** The refusal for a book being read, or null */
async function openReadingRefusal(workId: string) {
  const [open] = await db
    .select({ status: readings.status })
    .from(readings)
    .where(and(eq(readings.workId, workId), inArray(readings.status, ["reading", "paused"])));
  if (!open) return null;
  const title = await titleOf(workId);
  return open.status === "paused" ? `${title} has a paused reading` : `${title} is being read`;
}

async function requireEditionOf(editionId: string | null | undefined, workId: string) {
  if (!editionId) return;
  const [edition] = await db.select({ workId: editions.workId }).from(editions).where(eq(editions.id, editionId));
  if (!edition) throw new Error("This edition no longer exists");
  if (edition.workId !== workId) throw new Error("This edition belongs to another book");
}

/** At most one queued and one unqueued entry per book per reading day */
async function queueEvent(workId: string, key: "work.queued" | "work.unqueued", extra: Record<string, unknown> = {}) {
  const day = await readingToday();
  const [seen] = resultRows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from activity_events
      where entity_type = 'work' and entity_id = ${workId}::uuid and event_key = ${key} and metadata->'extra'->>'day' = ${day}`),
  );
  if (seen?.n) return;
  recordActivity("work", workId, key, { extra: { day, ...extra } });
}

/** Adds a book to Up Next, at the bottom unless `at: "top"`; refused for a queued book or one being read */
export async function addToQueue(input: z.input<typeof addToQueueSchema>) {
  const data = addToQueueSchema.parse(input);
  await requireBookWork(data.workId);
  const queued = await queuedPlace(data.workId);
  if (queued) throw new Error(`Already in Up Next, at ${queued.place}`);
  const refusal = await openReadingRefusal(data.workId);
  if (refusal) throw new Error(refusal);
  await requireEditionOf(data.editionId, data.workId);
  const position =
    data.at === "top"
      ? sql`coalesce((select min(position) from reading_queue), ${2 * QUEUE_GAP}) - ${QUEUE_GAP}`
      : sql`coalesce((select max(position) from reading_queue), 0) + ${QUEUE_GAP}`;
  await withReadableErrors(() =>
    atomic((d) => [
      d.execute(sql`insert into reading_queue (work_id, edition_id, note, source, position)
        values (${data.workId}::uuid, ${data.editionId ?? null}::uuid, ${data.note || null}, ${data.from === "suggestion" ? "suggestion" : "manual"}, ${position})`),
    ]),
  );
  changed();
  const place = (await queuedPlace(data.workId))!;
  await queueEvent(data.workId, "work.queued", { position: place.place });
  return { workId: data.workId, place: place.place };
}

/** The bulk toolbar's Add to Up Next: appended in the given order; queued books and books being read are counted, not added */
export async function addManyToQueue(input: z.input<typeof addManyToQueueSchema>) {
  const workIds = [...new Set(addManyToQueueSchema.parse(input).workIds)];
  await requireBookWorks(workIds);
  const queued = new Set(
    (await db.select({ workId: readingQueue.workId }).from(readingQueue).where(inArray(readingQueue.workId, workIds))).map((r) => r.workId),
  );
  const open = new Set(
    (
      await db
        .select({ workId: readings.workId })
        .from(readings)
        .where(and(inArray(readings.workId, workIds), inArray(readings.status, ["reading", "paused"])))
    ).map((r) => r.workId),
  );
  const toAdd = workIds.filter((id) => !queued.has(id) && !open.has(id));
  if (toAdd.length) {
    await withReadableErrors(() =>
      atomic((d) => [
        d.execute(sql`insert into reading_queue (work_id, position)
          select v.work_id, coalesce((select max(position) from reading_queue), 0) + v.n * ${QUEUE_GAP}
          from unnest(${`{${toAdd.join(",")}}`}::uuid[]) with ordinality as v(work_id, n)
          on conflict (work_id) do nothing`),
      ]),
    );
    changed();
    for (const workId of toAdd) await queueEvent(workId, "work.queued");
  }
  return { added: toAdd.length, alreadyQueued: workIds.filter((id) => queued.has(id)).length, beingRead: workIds.filter((id) => open.has(id) && !queued.has(id)).length };
}

/** Takes a book off Up Next; returns the row for its Undo */
export async function removeFromQueue(input: z.input<typeof queueWorkSchema>) {
  const { workId } = queueWorkSchema.parse(input);
  await requireBookWork(workId);
  const [row] = await db.delete(readingQueue).where(eq(readingQueue.workId, workId)).returning();
  if (!row) throw new Error("Not in Up Next");
  changed();
  await queueEvent(workId, "work.unqueued");
  return row;
}

/** The Undo of a remove: the row back with its id at its old position, or the next free one after it */
export async function restoreQueueItem(input: z.input<typeof queueSnapshotSchema>) {
  const snap = queueSnapshotSchema.parse(input);
  await requireBookWork(snap.workId);
  if (await queuedPlace(snap.workId)) throw new Error(`${await titleOf(snap.workId)} is in Up Next again`);
  if (await openReadingRefusal(snap.workId)) throw new Error(`${await titleOf(snap.workId)} was started meanwhile`);
  // An edition deleted or moved meanwhile comes back empty
  const [edition] = snap.editionId ? await db.select({ workId: editions.workId }).from(editions).where(eq(editions.id, snap.editionId)) : [];
  const editionId = edition?.workId === snap.workId ? snap.editionId : null;
  await withReadableErrors(() =>
    atomic((d) => [
      d.execute(sql`insert into reading_queue (id, work_id, edition_id, position, note, source, import_id, source_key, added_at)
        values (${snap.id}::uuid, ${snap.workId}::uuid, ${editionId}::uuid, (select min(p)::int from generate_series(${snap.position}::int, ${snap.position}::int + ${QUEUE_GAP * 4}) p
            where not exists (select 1 from reading_queue q where q.position = p)),
          ${snap.note}, ${snap.source}, (select id from imports where id = ${snap.importId}::uuid), ${snap.sourceKey}, ${snap.addedAt.toISOString()}::timestamptz)`),
    ]),
  );
  changed();
  return { workId: snap.workId, place: (await queuedPlace(snap.workId))!.place };
}

/**
 * Places an item between its new neighbours: after `afterWorkId` (the item
 * above) and before `beforeWorkId` (the item below). When no gap is left,
 * every position is renumbered in steps of 1024 in the same write.
 */
export async function moveQueueItem(input: z.input<typeof moveQueueItemSchema>) {
  const data = moveQueueItemSchema.parse(input);
  await requireBookWork(data.workId);
  const rows = await db
    .select({ id: readingQueue.id, workId: readingQueue.workId, position: readingQueue.position })
    .from(readingQueue)
    .orderBy(readingQueue.position, readingQueue.workId);
  const item = rows.find((r) => r.workId === data.workId);
  if (!item) throw new Error("Not in Up Next");
  const above = data.afterWorkId ? rows.find((r) => r.workId === data.afterWorkId) : null;
  const below = data.beforeWorkId ? rows.find((r) => r.workId === data.beforeWorkId) : null;
  if ((data.afterWorkId && !above) || (data.beforeWorkId && !below)) throw new Error("Up Next changed elsewhere; reload");
  const others = rows.filter((r) => r.workId !== data.workId);
  // Where it goes among the others: right after the item above, else right before the item below, else the top
  const index = above ? others.indexOf(above) + 1 : below ? others.indexOf(below) : 0;
  const prev = others[index - 1] ?? null;
  const next = others[index] ?? null;
  const position = positionBetween(prev?.position ?? null, next?.position ?? null);
  await withReadableErrors(() =>
    atomic((d) => {
      if (position !== null) return [d.update(readingQueue).set({ position }).where(eq(readingQueue.id, item.id))];
      const order = [...others.slice(0, index), item, ...others.slice(index)];
      const numbered = renumbered(order);
      return [
        d.execute(sql`update reading_queue q set position = v.position
          from unnest(${`{${numbered.map((n) => n.item.id).join(",")}}`}::uuid[], ${`{${numbered.map((n) => n.position).join(",")}}`}::int[]) as v(id, position)
          where q.id = v.id`),
      ];
    }),
  );
  changed();
  return { workId: data.workId, place: index + 1, total: rows.length };
}

/** The edition he means to read, and the note */
export async function updateQueueItem(input: z.input<typeof updateQueueItemSchema>) {
  const data = updateQueueItemSchema.parse(input);
  await requireBookWork(data.workId);
  await requireEditionOf(data.editionId, data.workId);
  const set: Partial<typeof readingQueue.$inferInsert> = {};
  if (data.editionId !== undefined) set.editionId = data.editionId;
  if (data.note !== undefined) set.note = data.note || null;
  if (!Object.keys(set).length) return { workId: data.workId };
  const [row] = await withReadableErrors(() => db.update(readingQueue).set(set).where(eq(readingQueue.workId, data.workId)).returning({ id: readingQueue.id }));
  if (!row) throw new Error("Not in Up Next");
  changed();
  return { workId: data.workId };
}

export interface QueueItem {
  id: string;
  workId: string;
  title: string;
  slug: string | null;
  author: string | null;
  /** The queued edition, when one is chosen */
  editionId: string | null;
  position: number;
  note: string | null;
  source: string;
  addedAt: string;
  owned: boolean;
  atHandCopyId: string | null;
  workCover: string | null;
  readCount: number;
  lastFinishedOn: string | null;
  editions: QueueEdition[];
}

/**
 * The whole list in one query, in order: each book with its author, cover,
 * editions and copies (to pick the edition he means and say where the copy
 * is), the last known audio length of each edition, ownership, the copy at
 * hand at the home, and its reading history.
 */
export async function getQueue(input?: z.input<typeof getQueueSchema>): Promise<QueueItem[]> {
  const homeId = getQueueSchema.parse(input)?.homeId ?? null;
  return resultRows<QueueItem>(
    await db.execute(sql`
      select q.id::text as id, w.id::text as "workId", w.title, w.slug, q.edition_id::text as "editionId", q.position, q.note, q.source,
        q.added_at::text as "addedAt",
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order, a.name limit 1) as author,
        ${ownedBookCondition(sql`w.id`)} as owned,
        (${atHandCopySql(sql`w.id`, homeId)} limit 1)::text as "atHandCopyId",
        (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1) as "workCover",
        ${readCountSql(sql`w.id`)}::int as "readCount",
        ${lastFinishedOnSql(sql`w.id`)} as "lastFinishedOn",
        coalesce((select jsonb_agg(jsonb_build_object(
            'id', e.id, 'title', e.title, 'language', e.language, 'pageCount', e.page_count, 'thumbnail', e.thumbnail_s3_key,
            'audioMinutes', (select r.total_minutes from readings r where r.edition_id = e.id and r.total_minutes is not null
              order by coalesce(r.finished_on, r.started_on) desc nulls last, r.created_at desc limit 1),
            'copies', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'status', i.status, 'format', i.format, 'locationId', i.location_id, 'locationType', l.type,
                'locationName', l.name, 'subLocationName', sl.name, 'lentTo', i.lent_to, 'lentDate', i.lent_date::text)
                order by i.created_at, i.id)
              from instances i left join locations l on l.id = i.location_id left join sub_locations sl on sl.id = i.sub_location_id
              where i.edition_id = e.id), '[]'::jsonb))
            order by e.publication_year nulls last, e.created_at, e.id)
          from editions e where e.work_id = w.id), '[]'::jsonb) as editions
      from reading_queue q join works w on w.id = q.work_id
      order by q.position, q.work_id`),
  );
}

/** The first queued books, for the hub's strip */
export async function getQueueHead(limit = 5) {
  return resultRows<{ workId: string; title: string; slug: string | null; editionId: string | null; cover: string | null }>(
    await db.execute(sql`
      select w.id::text as "workId", w.title, w.slug, q.edition_id::text as "editionId",
        coalesce((select e.thumbnail_s3_key from editions e where e.id = q.edition_id),
          (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1),
          (select e.thumbnail_s3_key from editions e where e.work_id = w.id and e.thumbnail_s3_key is not null order by e.created_at limit 1)) as cover
      from reading_queue q join works w on w.id = q.work_id
      order by q.position, q.work_id limit ${limit}`),
  );
}

/** A book's place in Up Next, for its page: null when not queued */
export async function getQueuePlace(workId: string) {
  const row = await queuedPlace(z.uuid().parse(workId));
  return row ? { place: row.place } : null;
}
