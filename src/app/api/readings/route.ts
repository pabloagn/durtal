import { NextRequest } from "next/server";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { readJson } from "@/lib/api/rest";
import { requireReadingsToken, spoken, spokenError, zoneOf } from "@/lib/api/readings";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { readingEvent } from "@/lib/reading/activity";
import { createReading, openReadingOf } from "@/lib/reading/service";
import { isbn10To13, validIsbn10, validIsbn13 } from "@/lib/match/plan";

const bodySchema = z
  .object({ isbn: z.string().trim().min(10).max(20).optional(), workId: z.uuid().optional(), tz: z.unknown().optional() })
  .refine((b) => (b.isbn === undefined) !== (b.workId === undefined), "Send an isbn or a workId");

/**
 * POST /api/readings (SLN-451): starts reading a book, for a Shortcut that
 * scans the barcode. An ISBN starts its edition, with its copy when the
 * edition has exactly one copy still held; an unknown ISBN answers 404 with
 * the add-book link.
 */
export async function POST(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const parsed = bodySchema.safeParse((await readJson(req)) ?? {});
    if (!parsed.success) return spoken(400, parsed.error.issues[0]?.message ?? "Send an isbn or a workId", { issues: parsed.error.issues });
    const tz = zoneOf(parsed.data.tz);
    if (tz === null) return spoken(400, "The time zone is not one Durtal knows, such as Europe/Amsterdam");
    let workId = parsed.data.workId ?? null;
    let editionId: string | null = null;
    let instanceId: string | null = null;
    if (parsed.data.isbn) {
      const digits = parsed.data.isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
      const thirteen = validIsbn13(digits) ?? (validIsbn10(digits) ? isbn10To13(validIsbn10(digits)!) : null);
      const ten = validIsbn10(digits);
      if (!thirteen && !ten) return spoken(400, "That is not an ISBN");
      const [match] = resultRows<{ workId: string; editionId: string; copies: string[] }>(
        await db.execute(sql`
          select e.work_id::text as "workId", e.id::text as "editionId",
            coalesce((select jsonb_agg(i.id::text) from instances i where i.edition_id = e.id and i.status <> 'deaccessioned'), '[]'::jsonb) as copies
          from editions e join works w on w.id = e.work_id and w.kind = 'book'
          where e.isbn_13 = ${thirteen ?? ""} or e.isbn_10 = ${ten ?? ""}
          order by e.created_at limit 1`),
      );
      const isbn = thirteen ?? ten!;
      if (!match) return spoken(404, "Not in Durtal yet", { addUrl: `/library/new?isbn=${isbn}` });
      workId = match.workId;
      editionId = match.editionId;
      instanceId = match.copies.length === 1 ? match.copies[0] : null;
    }
    const [work] = resultRows<{ title: string; kind: string }>(await db.execute(sql`select title, kind from works where id = ${workId}::uuid`));
    if (!work || work.kind !== "book") return spoken(404, "No such book in Durtal");
    const open = await openReadingOf(workId!);
    if (open) return spoken(409, `${work.title} is already being read`, { readingId: open.id });
    const reading = await createReading({ workId: workId!, editionId, instanceId, timeZone: tz }, { source: "manual" });
    readingEvent(workId!, "work.reading_started", reading, { percent: reading.currentPercent });
    invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
    return spoken(201, `Started reading ${work.title}`, {
      readingId: reading.id,
      position: { page: reading.currentPage, percent: reading.currentPercent, minutes: reading.currentMinutes },
    });
  } catch (err) {
    return spokenError(err, "Could not start the book");
  }
}
