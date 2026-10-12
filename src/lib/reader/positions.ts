import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import type { DurtalLocator } from "./engine";

/**
 * The reader's place per file and device (eBooks sub-issue 3), in
 * ebook_positions. The newest place by the reader's own clock wins, so a
 * late request never moves a device back; furthest_progression keeps the
 * greatest progression ever sent from that device.
 */

/** A chapter label is cut to this length */
export const CHAPTER_CHARS = 300;
/** A place sent from a clock this far ahead is refused */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const unit = z.number().min(0).max(1);
const rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** A DurtalLocator, as the epic's contract shapes it. Unknown keys are dropped. */
export const locatorSchema = z.object({
  v: z.literal(1),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/, "fileHash is a sha256"),
  href: z.string().max(2048),
  sectionIndex: z.number().int().min(0),
  progression: unit,
  totalProgression: unit,
  position: z.number().min(0).optional(),
  cfi: z.string().max(4096).optional(),
  pdf: z
    .object({
      page: z.number().int().min(1),
      rects: z.array(rect).max(200).optional(),
    })
    .optional(),
  text: z
    .object({
      before: z.string().max(512).optional(),
      highlight: z.string().max(2048).optional(),
      after: z.string().max(512).optional(),
    })
    .optional(),
  tocLabel: z.string().max(CHAPTER_CHARS).optional(),
  pageLabel: z.string().max(40).optional(),
});

/** POST /api/reader/[ebookId]/position */
export function positionBodySchema(now = Date.now()) {
  return z.object({
    fileId: z.uuid(),
    locator: locatorSchema,
    chapter: z
      .string()
      .nullish()
      .transform((chapter) => chapter?.trim().slice(0, CHAPTER_CHARS) || null),
    clientUpdatedAt: z.iso
      .datetime({ offset: true })
      .transform((at) => new Date(at))
      .refine(
        (at) => at.getTime() <= now + MAX_CLOCK_SKEW_MS,
        "clientUpdatedAt is in the future",
      ),
  });
}

export type PositionBody = z.infer<ReturnType<typeof positionBodySchema>>;

export interface SavedPosition {
  fileId: string;
  locator: DurtalLocator;
  progression: number;
  furthestProgression: number;
  chapter: string | null;
  deviceLabel: string;
  clientUpdatedAt: Date;
  updatedAt: Date;
}

/** Whether an e-book exists, and whether a file is one of its own */
export async function ebookAndFile(
  ebookId: string,
  fileId: string,
): Promise<{ ebook: boolean; fileOfEbook: boolean }> {
  const [row] = resultRows<{ fileEbookId: string | null }>(
    await db.execute(sql`select f.ebook_id as "fileEbookId"
      from ebooks eb left join ebook_files f on f.id = ${fileId}::uuid
      where eb.id = ${ebookId}::uuid`),
  );
  return { ebook: !!row, fileOfEbook: row?.fileEbookId === ebookId };
}

export async function ebookExists(ebookId: string): Promise<boolean> {
  const rows = resultRows(
    await db.execute(sql`select 1 from ebooks where id = ${ebookId}::uuid`),
  );
  return rows.length > 0;
}

const POSITION_COLUMNS = sql`file_id as "fileId", locator, progression, furthest_progression as "furthestProgression",
  chapter, device_label as "deviceLabel", client_updated_at as "clientUpdatedAt", updated_at as "updatedAt"`;

type PositionRow = Omit<SavedPosition, "clientUpdatedAt" | "updatedAt"> & {
  clientUpdatedAt: string | Date;
  updatedAt: string | Date;
};

const toPosition = (row: PositionRow): SavedPosition => ({
  ...row,
  progression: Number(row.progression),
  furthestProgression: Number(row.furthestProgression),
  clientUpdatedAt: new Date(row.clientUpdatedAt),
  updatedAt: new Date(row.updatedAt),
});

/**
 * Saves a device's place in a file. A place older than the stored one
 * changes nothing but furthest_progression. Returns whether it was the
 * newest, and the row as it stands.
 */
export async function savePosition(input: {
  ebookId: string;
  deviceId: string;
  deviceLabel: string;
  body: PositionBody;
}): Promise<{ saved: boolean; position: SavedPosition }> {
  const { ebookId, deviceId, deviceLabel, body } = input;
  const progression = body.locator.totalProgression;
  const at = body.clientUpdatedAt.toISOString();
  const newer = sql`ebook_positions.client_updated_at < excluded.client_updated_at`;
  const [row] = resultRows<PositionRow & { saved: boolean }>(
    await db.execute(sql`insert into ebook_positions
        (ebook_id, file_id, device_id, device_label, locator, progression, furthest_progression, chapter, client_updated_at)
      values (${ebookId}::uuid, ${body.fileId}::uuid, ${deviceId}, ${deviceLabel}, ${JSON.stringify(body.locator)}::jsonb,
        ${progression}, ${progression}, ${body.chapter}, ${at}::timestamptz)
      on conflict (file_id, device_id) do update set
        device_label = case when ${newer} then excluded.device_label else ebook_positions.device_label end,
        locator = case when ${newer} then excluded.locator else ebook_positions.locator end,
        progression = case when ${newer} then excluded.progression else ebook_positions.progression end,
        chapter = case when ${newer} then excluded.chapter else ebook_positions.chapter end,
        furthest_progression = greatest(ebook_positions.furthest_progression, excluded.furthest_progression),
        updated_at = case when ${newer} then now() else ebook_positions.updated_at end,
        client_updated_at = greatest(ebook_positions.client_updated_at, excluded.client_updated_at)
      returning ${POSITION_COLUMNS}, client_updated_at = ${at}::timestamptz as saved`),
  );
  const { saved, ...position } = row;
  return { saved, position: toPosition(position) };
}

/** This device's place in each file of an e-book, newest first */
export async function devicePositions(
  ebookId: string,
  deviceId: string,
): Promise<SavedPosition[]> {
  const rows = resultRows<PositionRow>(
    await db.execute(sql`select ${POSITION_COLUMNS} from ebook_positions
      where ebook_id = ${ebookId}::uuid and device_id = ${deviceId}
      order by client_updated_at desc, file_id`),
  );
  return rows.map(toPosition);
}

/** All file/device places, ordered by the reader clock, without changing save semantics. */
export async function allDevicePositions(
  ebookId: string,
  deviceId: string | null,
) {
  const rows = resultRows<PositionRow & { deviceId: string }>(
    await db.execute(sql`select
    ${POSITION_COLUMNS}, device_id as "deviceId" from ebook_positions
    where ebook_id = ${ebookId}::uuid order by client_updated_at desc, device_id, file_id`),
  );
  return rows.map((row) => {
    const place = toPosition(row);
    return {
      deviceId: row.deviceId,
      deviceLabel: place.deviceLabel,
      fileId: place.fileId,
      locator: place.locator,
      progression: place.progression,
      furthestProgression: place.furthestProgression,
      chapter: place.chapter,
      clientUpdatedAt: place.clientUpdatedAt,
      thisDevice: row.deviceId === deviceId,
    };
  });
}
