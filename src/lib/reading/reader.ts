import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { resultRows } from "@/lib/harmonization/store";
import { readReaderSettings } from "@/lib/reader/settings-request";
import { readerTrackingDataSchema } from "./reader-tracking-data";
import { getPaceContext } from "@/lib/actions/reading";
import { pagesPerHour, paceExplanation } from "./pace";
import { readingDay } from "./dates";
import { appTimeZone } from "@/lib/utils/date";

/** One binding/open-reading query; the request-scoped settings read is shared with 553. */
export async function loadReaderTracking({ ebookId }: { ebookId: string }) {
  const [settings, rows, jar] = await Promise.all([
    readReaderSettings(),
    db.execute(sql`select jsonb_build_object('workId', w.id, 'title', w.title, 'editionId', e.id, 'instanceId', i.id,
      'hasClosedHistory', exists(select 1 from readings h where h.work_id=w.id and h.status in ('finished','abandoned')),
      'reading', (select jsonb_build_object('id', r.id, 'fingerprint', md5(to_jsonb(r)::text), 'status', r.status,
        'unit', r.unit, 'percent', r.current_percent, 'page', r.current_page, 'totalPages', r.total_pages, 'chapter', r.current_chapter)
        from readings r where r.work_id=w.id and r.status in ('reading','paused') limit 1)) as linked
      from ebooks eb join instances i on i.id=eb.instance_id join editions e on e.id=i.edition_id
      join works w on w.id=e.work_id where eb.id=${ebookId}::uuid and eb.match_state='linked' and w.kind='book'`),
    cookies(),
  ]);
  const [row] = resultRows<{ linked: unknown }>(rows);
  const deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(deviceId)) throw new Error("Reader device is unavailable");
  const data = readerTrackingDataSchema.parse({ version: 1, ebookId, deviceId, autoTrack: settings.readingAutoTrackEbooks,
    dayStartHour: settings.readingDayStartHour, linked: row?.linked ?? null, estimate: null });
  if (data.linked?.reading) {
    const pace = await getPaceContext([data.linked.reading.id]);
    const reading = pace.readings[data.linked.reading.id];
    if (reading?.totalPages) data.estimate = {
      minutesPerPercent: reading.totalPages / 100 / pagesPerHour(reading, pace.priors).value * 60,
      explanation: paceExplanation(reading, pace.priors, readingDay(new Date(), appTimeZone(), settings.readingDayStartHour)),
    };
  }
  return data;
}
