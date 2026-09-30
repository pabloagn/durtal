"use server";

import { bookCondition, requireBookWorks } from "@/lib/catalogue/book-boundary";

import { workCardWith } from "@/lib/actions/utils/work-card-query";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { series, works, workAuthors } from "@/lib/db/schema";
import { eq, asc, desc, count, sql, and, inArray, ne } from "drizzle-orm";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import {
  textSearchCondition,
  textSearchRank,
} from "@/lib/actions/utils/text-search";
import { makeUnique, slugify } from "@/lib/utils/slugify";
import {
  positionValue,
  seriesInputSchema,
  seriesPositionSchema,
  type SeriesInput,
} from "@/lib/validations/series";

/** Numeric order of `works.series_position` ("2" before "10"); blanks last. */
const positionOrder = sql`case when ${works.seriesPosition} ~ '^[0-9]+(\\.[0-9]+)?$' then ${works.seriesPosition}::numeric end`;

function rows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
}

/** All series with their works (used by the book edit dialogs and older callers). */
export async function getSeries(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const { search } = opts ?? {};
  return db.query.series.findMany({
    where: search
      ? textSearchCondition(sql`search_normalize(${series.title})`, search)
      : undefined,
    orderBy: [asc(series.title), asc(series.id)],
    limit: opts?.limit,
    offset: opts?.offset,
    with: {
      works: {
        where: bookCondition,
        columns: { id: true, seriesPosition: true, catalogueStatus: true },
        with: {
          editions: {
            columns: { id: true },
            with: { instances: { columns: { id: true } } },
          },
        },
      },
    },
  });
}

const haystack = sql`search_normalize(${series.title} || ' ' || coalesce(${series.originalTitle}, ''))`;
const bookCount = sql<number>`(select count(*)::int from works w where w.kind = 'book' and w.series_id = "series"."id")`;
const ownedCount = sql<number>`(select count(*)::int from works w where w.kind = 'book' and w.series_id = "series"."id" and exists (select 1 from editions e join instances i on i.edition_id = e.id where e.work_id = w.id and i.status <> 'deaccessioned'))`;

const listSchema = z.object({
  search: z.string().max(200).optional(),
  sort: z.enum(["relevance", "title", "books", "recent"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Series list with counts and up to four member covers, searched like authors. */
export async function getSeriesList(options: z.input<typeof listSchema> = {}) {
  const o = listSchema.parse(options);
  const q = (o.search ?? "").trim();
  const sort = o.sort ?? (q ? "relevance" : "title");
  const dir =
    (o.order ?? (sort === "title" ? "asc" : "desc")) === "asc" ? asc : desc;
  const where = textSearchCondition(haystack, q);
  const orderBy =
    sort === "relevance" && q
      ? [
          dir(textSearchRank(haystack, sql`${series.title}`, q)),
          asc(series.title),
        ]
      : sort === "books"
        ? [dir(bookCount), asc(series.title)]
        : sort === "recent"
          ? [dir(series.createdAt), asc(series.title)]
          : [dir(sql`lower(${series.title})`)];
  const [list, [total]] = await Promise.all([
    db
      .select({
        id: series.id,
        title: series.title,
        originalTitle: series.originalTitle,
        totalVolumes: series.totalVolumes,
        isComplete: series.isComplete,
        createdAt: series.createdAt,
        bookCount,
        ownedCount,
      })
      .from(series)
      .where(where)
      .orderBy(...orderBy, asc(series.id))
      .limit(o.limit ?? 48)
      .offset(o.offset ?? 0),
    db.select({ count: count() }).from(series).where(where),
  ]);
  const ids = list.map((s) => s.id);
  const covers = ids.length
    ? rows<{ seriesId: string; s3Key: string }>(
        await db.execute(sql`select series_id as "seriesId", cover as "s3Key" from (
          select w.series_id, coalesce(
            (select coalesce(m.thumbnail_s3_key, m.s3_key) from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1),
            (select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.work_id = w.id and coalesce(e.thumbnail_s3_key, e.cover_s3_key) is not null limit 1)
          ) as cover,
          row_number() over (partition by w.series_id order by case when w.series_position ~ '^[0-9]+(\\.[0-9]+)?$' then w.series_position::numeric end nulls last, lower(w.title)) as n
          from works w where w.kind = 'book' and w.series_id = any(${sql`ARRAY[${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]::uuid[]`})
        ) c where n <= 4 and cover is not null order by series_id, n`),
      )
    : [];
  return {
    rows: list.map((s) => ({
      ...s,
      covers: covers.filter((c) => c.seriesId === s.id).map((c) => c.s3Key),
    })),
    total: total.count,
  };
}

export async function getSeriesCount(search?: string) {
  const [result] = await db
    .select({ count: count() })
    .from(series)
    .where(textSearchCondition(haystack, search ?? ""));
  return result.count;
}

/** One series with its works in reading order (numeric positions, then title). */
export async function getSeriesDetail(id: string) {
  if (!z.uuid().safeParse(id).success) return undefined;
  return db.query.series.findFirst({
    where: eq(series.id, id),
    with: {
      works: {
        where: bookCondition,
        orderBy: () => [
          sql`${positionOrder} nulls last`,
          sql`lower(${works.title})`,
        ],
        with: {
          workAuthors: {
            with: { author: true },
            orderBy: asc(workAuthors.sortOrder),
          },
          editions: {
            columns: {
              id: true,
              thumbnailS3Key: true,
              publicationYear: true,
              language: true,
            },
            with: { instances: { columns: { id: true, status: true } } },
            limit: 1,
          },
          media: {
            columns: {
              s3Key: true,
              thumbnailS3Key: true,
              type: true,
              isActive: true,
              cropX: true,
              cropY: true,
              cropZoom: true,
              brightness: true,
              contrast: true,
            },
          },
        },
      },
    },
  });
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function invalid(error: z.ZodError): { ok: false; error: string } {
  return {
    ok: false,
    error: error.issues[0]?.message ?? "Check the series details",
  };
}

async function uniqueSlug(title: string, exceptId?: string) {
  const base = slugify(title) || "series";
  const taken = await db
    .select({ slug: series.slug })
    .from(series)
    .where(
      and(
        sql`${series.slug} like ${`${base}%`}`,
        exceptId ? ne(series.id, exceptId) : undefined,
      ),
    );
  return makeUnique(
    base,
    taken.map((r) => r.slug),
  );
}

export async function createSeries(
  input: SeriesInput,
): Promise<Result<typeof series.$inferSelect>> {
  const parsed = seriesInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const [row] = await db
    .insert(series)
    .values({
      ...parsed.data,
      isComplete: parsed.data.isComplete ?? false,
      slug: await uniqueSlug(parsed.data.title),
    })
    .returning();
  changed();
  return { ok: true, value: row };
}

export async function updateSeries(
  id: string,
  input: SeriesInput,
): Promise<Result<typeof series.$inferSelect>> {
  z.uuid().parse(id);
  const parsed = seriesInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const [row] = await db
    .update(series)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(series.id, id))
    .returning();
  if (!row) return { ok: false, error: "This series no longer exists" };
  changed();
  return { ok: true, value: row };
}

/** Deletes the series; its books stay and lose only their series and position. */
export async function deleteSeries(id: string) {
  z.uuid().parse(id);
  const members = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.seriesId, id));
  await atomic((d) => [
    d
      .update(works)
      .set({
        seriesId: null,
        seriesName: null,
        seriesPosition: null,
        updatedAt: new Date(),
      })
      .where(eq(works.seriesId, id)),
    d.delete(series).where(eq(series.id, id)),
  ]);
  for (const m of members)
    recordActivity("work", m.id, "work.series_changed", {
      oldValue: id,
      newValue: null,
    });
  changed();
  return { removedFrom: members.length };
}

/**
 * Put works into a series. Works already in it are left alone; works in
 * another series move (a work belongs to one series). New members without a
 * position get the next whole number after the highest one.
 */
export async function addWorksToSeries(seriesId: string, workIds: string[]) {
  z.uuid().parse(seriesId);
  const ids = [...new Set(z.array(z.uuid()).max(500).parse(workIds))];
  if (!ids.length) return { added: 0 };
  await requireBookWorks(ids);
  const [target] = await db
    .select({ id: series.id })
    .from(series)
    .where(eq(series.id, seriesId));
  if (!target) throw new Error("This series no longer exists");
  const [current, members] = await Promise.all([
    db
      .select({ id: works.id, seriesId: works.seriesId, title: works.title })
      .from(works)
      .where(inArray(works.id, ids)),
    db
      .select({ position: works.seriesPosition })
      .from(works)
      .where(eq(works.seriesId, seriesId)),
  ]);
  let next = Math.floor(
    Math.max(
      0,
      ...members.map((m) => positionValue(m.position)).filter(Number.isFinite),
    ),
  );
  const incoming = current
    .filter((w) => w.seriesId !== seriesId)
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (!incoming.length) return { added: 0 };
  await atomic((d) =>
    incoming.map((w) =>
      d
        .update(works)
        .set({
          seriesId,
          seriesName: null,
          seriesPosition: String(++next),
          updatedAt: new Date(),
        })
        .where(eq(works.id, w.id)),
    ),
  );
  for (const w of incoming)
    recordActivity("work", w.id, "work.series_changed", {
      oldValue: w.seriesId,
      newValue: seriesId,
    });
  changed();
  return { added: incoming.length };
}

export async function removeWorkFromSeries(seriesId: string, workId: string) {
  z.uuid().parse(seriesId);
  z.uuid().parse(workId);
  const [row] = await db
    .update(works)
    .set({
      seriesId: null,
      seriesName: null,
      seriesPosition: null,
      updatedAt: new Date(),
    })
    .where(and(bookCondition, eq(works.id, workId), eq(works.seriesId, seriesId)))
    .returning({ id: works.id });
  if (row) {
    recordActivity("work", workId, "work.series_changed", {
      oldValue: seriesId,
      newValue: null,
    });
    changed();
  }
  return { removed: row ? 1 : 0 };
}

export async function setSeriesPosition(
  seriesId: string,
  workId: string,
  position: string | null,
): Promise<Result<string | null>> {
  z.uuid().parse(seriesId);
  z.uuid().parse(workId);
  const parsed = seriesPositionSchema.safeParse(position);
  if (!parsed.success) return invalid(parsed.error);
  const [row] = await db
    .update(works)
    .set({ seriesPosition: parsed.data, updatedAt: new Date() })
    .where(and(bookCondition, eq(works.id, workId), eq(works.seriesId, seriesId)))
    .returning({ position: works.seriesPosition });
  if (!row) return { ok: false, error: "This book is no longer in the series" };
  changed();
  return { ok: true, value: row.position };
}

/**
 * Move a work one place earlier or later in reading order. Positions are
 * swapped with the neighbour; if any member has no position yet, the whole
 * series is first numbered 1, 2, 3… in its current order.
 */
export async function moveSeriesWork(
  seriesId: string,
  workId: string,
  direction: -1 | 1,
) {
  z.uuid().parse(seriesId);
  z.uuid().parse(workId);
  z.union([z.literal(-1), z.literal(1)]).parse(direction);
  const members = await db
    .select({
      id: works.id,
      position: works.seriesPosition,
      title: works.title,
    })
    .from(works)
    .where(eq(works.seriesId, seriesId))
    .orderBy(sql`${positionOrder} nulls last`, sql`lower(${works.title})`);
  const index = members.findIndex((m) => m.id === workId);
  const other = members[index + direction];
  if (index < 0 || !other) return;
  const numbered = members.every((m) =>
    Number.isFinite(positionValue(m.position)),
  );
  const positions = numbered
    ? members.map((m) => m.position!)
    : members.map((_, i) => String(i + 1));
  [positions[index], positions[index + direction]] = [
    positions[index + direction],
    positions[index],
  ];
  await atomic((d) =>
    members.map((m, i) =>
      d
        .update(works)
        .set({ seriesPosition: positions[i] })
        .where(eq(works.id, m.id)),
    ),
  );
  changed();
}

export interface SeriesSuggestion {
  seriesId: string;
  seriesTitle: string;
  workId: string;
  workTitle: string;
  authors: string | null;
  currentSeriesId: string | null;
  currentSeriesTitle: string | null;
}

/**
 * Books whose title matches a series title or one of its parts ("A and B",
 * "A, B, and C", "Trilogy: A, B"), ignoring accents and case. Books already
 * in that series are left out; books in another series are flagged.
 * Suggestions only: nothing is linked until the user confirms.
 */
export async function getSeriesSuggestions(seriesId?: string) {
  if (seriesId) z.uuid().parse(seriesId);
  const only = seriesId ? sql`s.id = ${seriesId}::uuid` : sql`true`;
  const result = await db.execute(sql`
    with parts as (
      select s.id as sid, s.title as stitle, trim(p.part) as part, p.n::int as n
      from series s, regexp_split_to_table(s.title, '\\s*,\\s*(and\\s+)?|\\s+and\\s+') with ordinality as p(part, n)
      where ${only}
      union
      select s.id, s.title, s.title, 0 from series s where ${only}
    ), expanded as (
      select sid, stitle, part, n from parts
      union
      select sid, stitle, trim(substring(part from position(': ' in part) + 2)), n from parts where position(': ' in part) > 0
    )
    select x.sid as "seriesId", x.stitle as "seriesTitle", w.id as "workId", w.title as "workTitle",
      (select string_agg(a.name, ' & ' order by wa.sort_order) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id) as "authors",
      w.series_id as "currentSeriesId", cs.title as "currentSeriesTitle"
    from expanded x
    join works w on w.kind = 'book' and search_normalize(w.title) = search_normalize(x.part)
    left join series cs on cs.id = w.series_id
    where length(search_normalize(x.part)) > 0 and w.series_id is distinct from x.sid
    group by x.sid, x.stitle, w.id, w.title, w.series_id, cs.title
    -- Books in the order the series title names them, so "Link all" numbers them right
    order by "seriesTitle", min(x.n), "workTitle"`);
  return rows<SeriesSuggestion>(result);
}

/** Works for the add-books picker, with the series each one is in now. */
export async function searchWorksForSeries(query: string) {
  const q = z.string().max(200).parse(query).trim();
  if (!q) return [];
  const titleHaystack = sql`search_normalize(${works.title} || ' ' || coalesce((select string_agg(a.name, ' ') from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = "works"."id"), ''))`;
  return db
    .select({
      id: works.id,
      title: works.title,
      seriesId: works.seriesId,
      seriesTitle: sql<
        string | null
      >`(select s.title from series s where s.id = "works"."series_id")`,
      authors: sql<
        string | null
      >`(select string_agg(a.name, ' & ' order by wa.sort_order) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = "works"."id")`,
      cover: sql<
        string | null
      >`(select coalesce(m.thumbnail_s3_key, m.s3_key) from media m where m.work_id = "works"."id" and m.type = 'poster' and m.is_active limit 1)`,
    })
    .from(works)
    .where(and(bookCondition, textSearchCondition(titleHaystack, q)))
    .orderBy(
      desc(textSearchRank(titleHaystack, sql`${works.title}`, q)),
      asc(works.title),
    )
    .limit(30);
}

/** Sibling works in reading order, excluding the currently open book. */
export async function getOtherWorksInSeries(seriesId: string, workId: string) {
  z.uuid().parse(seriesId);
  z.uuid().parse(workId);
  return db.query.works.findMany({
    where: and(bookCondition, eq(works.seriesId, seriesId), ne(works.id, workId)),
    orderBy: [
      sql`${positionOrder} nulls last`,
      asc(works.title),
      asc(works.id),
    ],
    with: workCardWith,
  });
}
