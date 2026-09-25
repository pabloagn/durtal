"use server";

import { randomUUID } from "node:crypto";
import { asc, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  authors,
  works,
  workAuthors,
  workRecommenders,
  editions,
  activityEvents,
} from "@/lib/db/schema";
import {
  fastTrackBookSchema,
  type FastTrackBookInput,
} from "@/lib/validations/fast-track";
import { defaultSortName } from "@/lib/utils/author-names";
import {
  generateAuthorSlug,
  generateWorkSlug,
  makeUnique,
} from "@/lib/utils/slugify";
import { processAndUploadCover, deleteFromS3 } from "@/lib/s3/covers";
import { authorNameEquals } from "@/lib/actions/utils/author-search";
import { invalidate, CACHE_TAGS } from "@/lib/cache";

type Result =
  | {
      ok: true;
      slug: string;
      workId: string;
      editionId: string;
      coverUnavailable: boolean;
    }
  | { ok: false; error: string };

async function uniqueSlug(table: typeof works | typeof authors, base: string) {
  const rows = await db
    .select({ slug: table.slug })
    .from(table)
    .where(like(table.slug, `${base}%`));
  return makeUnique(
    base,
    rows.flatMap((r) => (r.slug ? [r.slug] : [])),
  );
}

/** Save Details and one edition atomically. Never creates copies or categorization. */
export async function fastTrackBook(
  input: FastTrackBookInput,
): Promise<Result> {
  const parsed = fastTrackBookSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".")}: ${issue.message}` };
  }
  const { authorName, work, edition } = parsed.data;
  let cover: Awaited<ReturnType<typeof processAndUploadCover>> = null;
  try {
    if (edition.isbn13) {
      const existing = await db.query.editions.findFirst({
        where: eq(editions.isbn13, edition.isbn13),
        columns: { id: true },
      });
      if (existing)
        return {
          ok: false,
          error: `An edition with ISBN ${edition.isbn13} already exists. Open that book to add a copy.`,
        };
    }

    const author = await db.query.authors.findFirst({
      where: authorNameEquals(authorName),
      orderBy: [
        desc(sql`${authors.name} = ${authorName}`),
        asc(authors.createdAt),
      ],
      columns: { id: true, name: true },
    });
    const authorId = author?.id ?? randomUUID();
    const newAuthor = author
      ? null
      : {
          id: authorId,
          name: authorName,
          sortName: defaultSortName(authorName),
          slug: await uniqueSlug(authors, generateAuthorSlug(authorName)),
        };
    const workId = randomUUID();
    const editionId = randomUUID();
    const slug = await uniqueSlug(
      works,
      generateWorkSlug(work.title, author?.name ?? authorName, workId),
    );
    const { recommenderIds = [], ...workValues } = work;

    if (edition.coverSourceUrl)
      cover = await processAndUploadCover(editionId, edition.coverSourceUrl);

    // The ISBN and slug unique constraints also protect racing submissions.
    // Any failure rolls back the author, work and all relation rows together.
    await atomic((d) => [
      ...(newAuthor ? [d.insert(authors).values(newAuthor)] : []),
      d.insert(works).values({ ...workValues, id: workId, slug }),
      d
        .insert(workAuthors)
        .values({ workId, authorId, role: "author", sortOrder: 0 }),
      ...(recommenderIds.length
        ? [
            d.insert(workRecommenders).values(
              [...new Set(recommenderIds)].map((recommenderId) => ({
                workId,
                recommenderId,
              })),
            ),
          ]
        : []),
      d.insert(editions).values({
        ...edition,
        id: editionId,
        workId,
        title: work.title,
        ...(cover
          ? { coverS3Key: cover.coverKey, thumbnailS3Key: cover.thumbnailKey }
          : {}),
      }),
      d.insert(activityEvents).values([
        ...(newAuthor
          ? [
              {
                entityType: "author",
                entityId: authorId,
                eventKey: "author.created",
                metadata: { newValue: authorName },
              },
            ]
          : []),
        {
          entityType: "work",
          entityId: workId,
          eventKey: "work.created",
          metadata: { newValue: work.title },
        },
        {
          entityType: "work",
          entityId: workId,
          eventKey: "work.edition_added",
          metadata: {
            targetId: editionId,
            targetName: work.title,
            editionIsbn: edition.isbn13 ?? undefined,
          },
        },
      ]),
    ]);
    invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.authors);
    return {
      ok: true,
      slug,
      workId,
      editionId,
      coverUnavailable: !!edition.coverSourceUrl && !cover,
    };
  } catch (err) {
    if (cover)
      await Promise.allSettled([
        deleteFromS3(cover.coverKey),
        deleteFromS3(cover.thumbnailKey),
      ]);
    console.error("Fast Track failed", err);
    return { ok: false, error: "Could not add the book. Please try again." };
  }
}
