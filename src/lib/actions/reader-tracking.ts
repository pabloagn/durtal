"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { readings, readingNotes, readingSessions, readerSittingReceipts } from "@/lib/db/schema";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { READING_HOME_KEY } from "@/lib/preferences";
import { readReaderSettings } from "@/lib/reader/settings-request";
import { planHighlight, createHighlight } from "@/lib/ebooks/annotations";
import { createReading, loadReading } from "@/lib/reading/service";
import { getReadingNote } from "@/lib/actions/reading-notes";
import { readerBookBinding, saveReaderSitting, ReaderTrackingConflict } from "@/lib/reading/reader-session-service";
import { lockReaderEbooks, withReaderWriteRetry } from "@/lib/reading/reader-write-locks";
import { parseReaderSession, type ReaderSessionSnapshot } from "@/lib/validations/reader-tracking";
import { cutChapter } from "@/lib/reading/reader-progress";
import { remapPosition } from "@/lib/reading/positions";
import { readingDay, timeZoneSchema } from "@/lib/reading/dates";
import type { DurtalLocator } from "@/lib/reader/engine";
import { readerPercent } from "@/lib/reader/events";
import { loadReaderTracking } from "@/lib/reading/reader";

export async function getReaderTracking(ebookId: string) {
  return loadReaderTracking({ ebookId: z.uuid().parse(ebookId).toLowerCase() });
}

/** Exact database versions, passed opaquely to 500's deferred atomic delete. No writes. */
export async function prepareReaderQuoteDelete(input: { ebookId: string; annotationId: string }) {
  const ebookId = z.uuid().parse(input.ebookId);
  const annotationId = z.uuid().parse(input.annotationId);
  const [binding] = resultRows<{ noteId: string; expectedNoteVersion: string; expectedBindingVersion: string }>(await db.execute(sql`
    select n.id as "noteId", to_char(n.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "expectedNoteVersion",
      a.quote_binding_version::text as "expectedBindingVersion"
    from reading_notes n join ebook_annotations a on a.id=n.ebook_annotation_id
    join ebooks eb on eb.id=a.ebook_id join instances i on i.id=eb.instance_id join editions e on e.id=i.edition_id
    where a.id=${annotationId}::uuid and a.ebook_id=${ebookId}::uuid and a.style='quote' and a.deleted_at is null
      and eb.match_state='linked' and n.work_id=e.work_id and n.kind='quote'
      and not exists(select 1 from ebook_annotation_retired_ids where id=a.id)`));
  if (!binding) throw new ReaderTrackingConflict("This quote changed; reload before removing its highlight");
  return binding;
}

const startSchema = z.strictObject({
  ebookId: z.uuid().transform((id) => id.toLowerCase()), startPercent: z.number().min(0).max(100),
  timeZone: timeZoneSchema, automatic: z.boolean().default(false),
  sitting: z.record(z.string(), z.unknown()).optional(),
});
const quoteSchema = z.strictObject({
  ebookId: z.uuid().transform((id) => id.toLowerCase()), fileId: z.uuid(),
  locator: z.custom<DurtalLocator>(), text: z.string().trim().min(1).max(20_000)
    .refine((text) => Array.from(text).length <= 10_000, "Select at most 10,000 characters"),
  chapter: z.string().max(2048).nullable().optional(), percent: z.number().min(0).max(100),
});

/** Browser never chooses the tracker source, catalogue binding or stored home. */
export async function startReaderReading(raw: z.input<typeof startSchema>) {
  const data = startSchema.parse(raw);
  return withReaderWriteRetry(async () => {
    const jar = await cookies();
    const deviceId = jar.get(DEVICE_COOKIE)?.value;
    if (!isDeviceId(deviceId)) throw new ReaderTrackingConflict("Open the reader to identify this device", 400);
    const settings = await readReaderSettings();
    const binding = await readerBookBinding(data.ebookId);
    if (!binding) throw new ReaderTrackingConflict("This eBook is not linked to a book", 404);
    const sitting = data.sitting ? parseReaderSession({ ...data.sitting, readingId: randomUUID() }, new Date(), data.timeZone) : null;
    if (sitting && sitting.startPercent !== Math.round(data.startPercent * 100) / 100)
      throw new ReaderTrackingConflict("The sitting's starting position changed", 400);
    if (sitting) {
      // Retrying a start after a lost response must not create or resurrect a reading.
      const [prior] = await db.select().from(readerSittingReceipts).where(eq(readerSittingReceipts.sittingId, sitting.sittingId));
      if (prior) {
        const ack = await saveReaderSitting({ ...sitting, readingId: prior.readingId }, { ebookId: data.ebookId, deviceId });
        const reading = await loadReading(prior.readingId);
        if (ack.status === "retired" || !reading) throw new ReaderTrackingConflict("This reading was changed or removed; reload before starting again");
        return { reading, ack, created: false };
      }
    }
    const open = resultRows<{ id: string }>(await db.execute(sql`select id from readings where work_id=${binding.workId}::uuid and status in ('reading','paused') limit 1`))[0];
    if (open) {
      const ack = sitting ? await saveReaderSitting({ ...sitting, readingId: open.id }, { ebookId: data.ebookId, deviceId }) : null;
      return { reading: (await loadReading(open.id))!, ack, created: false };
    }
    let home: string | null = null;
    try {
      const value: unknown = JSON.parse(jar.get(READING_HOME_KEY)?.value ?? "null");
      if (typeof value === "string" && z.uuid().safeParse(value).success) home = value;
    } catch { /* An absent/invalid home means no home, never the digital copy's location. */ }
    const reading = await createReading({ workId: binding.workId, editionId: binding.editionId, instanceId: binding.instanceId,
      locationId: home, format: "ebook", unit: "percent", totalPages: binding.totalPages ?? undefined,
      startPercent: data.startPercent, timeZone: data.timeZone,
      // The day the first counted sitting began (a day precision needs its date).
      startedOn: readingDay(sitting?.startedAt ?? new Date(), data.timeZone, settings.readingDayStartHour), startedPrecision: "day" }, {
      source: "reader",
      beforeInsert: (d) => [
        lockReaderEbooks(d, sql`select ${data.ebookId}::uuid`),
        d.execute(assertSql(sql`exists(select 1 from ebooks eb join instances i on i.id=eb.instance_id
          join editions e on e.id=i.edition_id where eb.id=${data.ebookId}::uuid and eb.match_state='linked'
          and i.id=${binding.instanceId}::uuid and e.id=${binding.editionId}::uuid and e.work_id=${binding.workId}::uuid)`, "The eBook binding changed; reload before starting")),
        ...(data.automatic ? [d.execute(assertSql(sql`${settings.readingAutoTrackEbooks} and
          (select reading_auto_track_ebooks from app_settings where id) and
          not exists(select 1 from readings where work_id=${binding.workId}::uuid and status in ('finished','abandoned'))`,
        "Start this re-read explicitly"))] : []),
      ],
      afterInsert: (d, created) => {
        if (!sitting) return [];
        const snapshot: ReaderSessionSnapshot = { ...sitting, readingId: created.id };
        const end = remapPosition(snapshot.endPercent, { totalPages: created.totalPages });
        return [
          d.insert(readingSessions).values({ id: snapshot.sittingId, readingId: created.id, editionId: binding.editionId,
            format: "ebook", source: "reader", readOn: readingDay(snapshot.startedAt, snapshot.timeZone, settings.readingDayStartHour),
            timeZone: snapshot.timeZone, startedAt: snapshot.startedAt, endedAt: snapshot.endedAt, durationSeconds: snapshot.activeSeconds,
            startPage: created.start.page, startPercent: created.start.percent, endPage: end.page, endPercent: snapshot.endPercent,
            endChapter: snapshot.endChapter, pagesTotal: created.totalPages }),
          d.insert(readerSittingReceipts).values({ ...snapshot, ebookId: data.ebookId, deviceId, originalSessionId: snapshot.sittingId,
            sessionId: snapshot.sittingId, goingBack: snapshot.goingBack === "went_back" }),
          d.execute(sql`select set_config('durtal.reader_tracking_session', ${snapshot.sittingId}, true)`),
          d.update(readings).set({ currentPage: end.page, currentPercent: snapshot.endPercent, currentChapter: snapshot.endChapter,
            lastReadAt: snapshot.endedAt }).where(eq(readings.id, created.id)),
          d.execute(sql`select set_config('durtal.reader_tracking_session', '', true)`),
        ];
      },
    });
    invalidate(CACHE_TAGS.reading, CACHE_TAGS.works);
    return { reading, created: true, ack: sitting ? { sittingId: sitting.sittingId, revision: sitting.revision, status: "saved" as const, sessionId: sitting.sittingId } : null };
  });
}

/** Use the actual 500 prepared highlight, then insert its linked quote in the same batch. */
export async function saveReaderQuote(raw: z.input<typeof quoteSchema>) {
  const data = quoteSchema.parse(raw);
  return withReaderWriteRetry(async () => {
    const binding = await readerBookBinding(data.ebookId);
    if (!binding) throw new ReaderTrackingConflict("This eBook is not linked to a book", 404);
    const plan = await planHighlight({ ebookId: data.ebookId, fileId: data.fileId, locator: data.locator,
      text: data.text, chapter: cutChapter(data.chapter), style: "quote" });
    if (Math.abs(readerPercent(plan.locator) - data.percent) > 0.01)
      throw new ReaderTrackingConflict("The selected passage's position changed", 400);
    const id = randomUUID();
    await atomic((d) => [
      d.execute(sql`select public.durtal_annotation_lock_book(${data.ebookId}::uuid)`),
      d.execute(sql`select public.durtal_annotation_lock_id(${plan.id}::uuid)`),
      d.execute(assertSql(sql`exists(select 1 from ebooks eb join instances i on i.id=eb.instance_id
        join editions e on e.id=i.edition_id where eb.id=${data.ebookId}::uuid and eb.match_state='linked'
        and i.id=${binding.instanceId}::uuid and e.id=${binding.editionId}::uuid and e.work_id=${binding.workId}::uuid)`, "The eBook binding changed; reload before saving the quote")),
      ...createHighlight(d, plan).queries,
      d.execute(sql`insert into reading_notes(id,work_id,edition_id,reading_id,kind,body,chapter,percent,source,ebook_annotation_id)
        values (${id}::uuid,${binding.workId}::uuid,${binding.editionId}::uuid,
          (select id from readings where work_id=${binding.workId}::uuid and status in ('reading','paused') limit 1),
          'quote',${plan.text},${plan.chapter},${readerPercent(plan.locator)},'reader',${plan.id}::uuid)`),
    ]);
    invalidate(CACHE_TAGS.reading, CACHE_TAGS.works);
    return { annotationId: plan.id, note: (await getReadingNote(id))!.note };
  });
}
