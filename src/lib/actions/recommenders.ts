"use server";

import { bookReferenceCondition } from "@/lib/catalogue/book-boundary";

import { z } from "zod/v4";
import { compareWorks } from "@/lib/utils/title-order";
import { db } from "@/lib/db";
import { recommenders, workRecommenders } from "@/lib/db/schema";
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  textSearchCondition,
  textSearchRank,
} from "@/lib/actions/utils/text-search";
import {
  recommenderInputSchema,
  type RecommenderInput,
} from "@/lib/validations/recommenders";

export const getRecommenders = cached(
  () => db.select().from(recommenders).orderBy(asc(recommenders.name)),
  ["recommenders"],
  [CACHE_TAGS.recommenders],
);

const haystack = sql`search_normalize(${recommenders.name})`;
const bookCount = sql<number>`(select count(*)::int from work_recommenders wr join works w on w.id = wr.work_id and w.kind = 'book' where wr.recommender_id = "recommenders"."id")`;

const listSchema = z.object({
  search: z.string().max(200).optional(),
  sort: z.enum(["relevance", "name", "books", "recent"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

/** Recommenders with their book counts, searched with the shared engine. */
export async function getRecommenderList(
  options: z.input<typeof listSchema> = {},
) {
  const o = listSchema.parse(options);
  const q = (o.search ?? "").trim();
  const sort = o.sort ?? (q ? "relevance" : "name");
  const dir =
    (o.order ?? (sort === "name" ? "asc" : "desc")) === "asc" ? asc : desc;
  const where = textSearchCondition(haystack, q);
  const orderBy =
    sort === "relevance" && q
      ? [
          dir(textSearchRank(haystack, sql`${recommenders.name}`, q)),
          asc(recommenders.name),
        ]
      : sort === "books"
        ? [dir(bookCount), asc(recommenders.name)]
        : sort === "recent"
          ? [dir(recommenders.createdAt), asc(recommenders.name)]
          : [dir(sql`lower(${recommenders.name})`)];
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: recommenders.id,
        name: recommenders.name,
        url: recommenders.url,
        createdAt: recommenders.createdAt,
        bookCount,
      })
      .from(recommenders)
      .where(where)
      .orderBy(...orderBy, asc(recommenders.id))
      .limit(o.limit ?? 48)
      .offset(o.offset ?? 0),
    db.select({ count: count() }).from(recommenders).where(where),
  ]);
  return { rows, total: total.count };
}

/** One recommender with every book they recommended, shaped like an author's works. */
export async function getRecommender(id: string) {
  if (!z.uuid().safeParse(id).success) return undefined;
  const recommender = await db.query.recommenders.findFirst({
    where: eq(recommenders.id, id),
    with: {
      workRecommenders: {
        where: (link) => bookReferenceCondition(link.workId),
        with: {
          work: {
            with: {
              editions: {
                columns: {
                  id: true,
                  title: true,
                  thumbnailS3Key: true,
                  publicationYear: true,
                  language: true,
                },
                limit: 1,
                with: { instances: { columns: { id: true } } },
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
              workAuthors: {
                with: { author: { columns: { name: true } } },
                orderBy: (wa, { asc }) => [asc(wa.sortOrder)],
              },
            },
          },
        },
      },
    },
  });
  if (!recommender) return undefined;
  const books = recommender.workRecommenders
    .map((wr) => wr.work)
    .sort(compareWorks);
  return { ...recommender, books };
}

/** The existing name that clashes with `name` (ignoring case and accents), if any. */
async function nameClash(name: string, exceptId?: string) {
  const [clash] = await db
    .select({ name: recommenders.name })
    .from(recommenders)
    .where(
      and(
        sql`search_normalize(${recommenders.name}) = search_normalize(${name})`,
        exceptId ? ne(recommenders.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return clash?.name ?? null;
}

function changed() {
  invalidate(CACHE_TAGS.recommenders, CACHE_TAGS.works);
}

type Saved =
  | { ok: true; recommender: typeof recommenders.$inferSelect }
  | { ok: false; error: string };

/** Validation problems come back as `{ ok: false, error }`: thrown messages are hidden in production. */
function invalid(error: unknown): Saved {
  const issue = error instanceof z.ZodError ? error.issues[0]?.message : null;
  return { ok: false, error: issue ?? "Check the name and website" };
}

export async function createRecommender(
  input: RecommenderInput,
): Promise<Saved> {
  const parsed = recommenderInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const clash = await nameClash(data.name);
  if (clash) return { ok: false, error: `"${clash}" already exists` };
  const [row] = await db
    .insert(recommenders)
    .values({ name: data.name, url: data.url ?? null })
    .returning();
  changed();
  return { ok: true, recommender: row };
}

export async function updateRecommender(
  id: string,
  input: RecommenderInput,
): Promise<Saved> {
  z.uuid().parse(id);
  const parsed = recommenderInputSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const clash = await nameClash(data.name, id);
  if (clash) return { ok: false, error: `"${clash}" already exists` };
  const [row] = await db
    .update(recommenders)
    .set({ name: data.name, url: data.url ?? null, updatedAt: new Date() })
    .where(eq(recommenders.id, id))
    .returning();
  if (!row) return { ok: false, error: "This recommender no longer exists" };
  changed();
  return { ok: true, recommender: row };
}

/** Deletes the recommender and its recommendation links; the books stay. */
export async function deleteRecommender(id: string) {
  z.uuid().parse(id);
  await db.delete(recommenders).where(eq(recommenders.id, id));
  changed();
}

/**
 * Adds recommenders to a work and keeps the ones it already has (the Edit
 * dialog replaces the whole list instead). Returns how many links are new.
 */
export async function addWorkRecommenders(
  workId: string,
  recommenderIds: string[],
): Promise<number> {
  z.uuid().parse(workId);
  z.array(z.uuid()).parse(recommenderIds);
  if (recommenderIds.length === 0) return 0;
  const added = await db
    .insert(workRecommenders)
    .values(recommenderIds.map((recommenderId) => ({ workId, recommenderId })))
    .onConflictDoNothing()
    .returning();
  if (added.length > 0) changed();
  return added.length;
}
