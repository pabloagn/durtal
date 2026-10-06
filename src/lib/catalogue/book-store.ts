import { randomUUID } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod/v4";
import { db } from "@/lib/db";
import {
  activityEvents,
  authors,
  editionGenres,
  editionTags,
  editions,
  works,
  workSubjects,
} from "@/lib/db/schema";
import { authorNameEquals } from "@/lib/actions/utils/author-search";
import { workSeriesPlan } from "@/lib/series/work-series";
import { deleteFromS3, processAndUploadCover } from "@/lib/s3/covers";
import { editionCoverPaletteFields } from "@/lib/color/color-buckets";
import { defaultSortName } from "@/lib/utils/author-names";
import { generateAuthorSlug, generateWorkSlug } from "@/lib/utils/slugify";
import type { createEditionSchema } from "@/lib/validations/editions";
import type { createWorkSchema } from "@/lib/validations/works";
import { bookAuthorQueries, editionContributorQueries } from "./book-credits";
import { curationQueries } from "./curation-store";
import { uniqueSlug } from "./slugs";
import type { Db } from "./work-store";

/**
 * The writes of a new book, its author and its editions, decided before
 * anything is written: ids and slugs are chosen first and a cover is uploaded
 * under its edition id, so every caller (the wizard, Fast Track, createWork,
 * createEdition) sends its rows as one atomic batch. A failed batch writes
 * nothing; the caller then discards the uploaded cover.
 */

/**
 * The author a book names: the one with that name, or a new row to insert with
 * the book. `taken` holds slugs already chosen for other new authors of the
 * same write.
 */
export async function bookAuthorFor(name: string, taken?: Iterable<string>) {
  const existing = await db.query.authors.findFirst({
    where: authorNameEquals(name),
    orderBy: [desc(sql`${authors.name} = ${name}`), asc(authors.createdAt)],
    columns: { id: true, name: true },
  });
  if (existing) return { id: existing.id, name: existing.name, row: null };
  const id = randomUUID();
  return {
    id,
    name,
    row: {
      id,
      name,
      sortName: defaultSortName(name),
      slug: await uniqueSlug(authors, generateAuthorSlug(name), { taken }),
    },
  };
}

/** Inserts a new author from `bookAuthorFor`, with its activity; nothing for an existing one. */
export function newAuthorQueries(
  d: Db,
  author: Awaited<ReturnType<typeof bookAuthorFor>>,
) {
  if (!author.row) return [];
  return [
    d.insert(authors).values(author.row),
    d.insert(activityEvents).values({
      entityType: "author",
      entityId: author.id,
      eventKey: "author.created",
      metadata: { newValue: author.name },
    }),
  ];
}

/**
 * Edition credits from a form: an entry names its author by id, or by name for
 * an author found by that name or created with the edition. A name given twice
 * is one author. Returns the credits by id and the new authors to insert.
 */
export async function resolveBookCredits(
  entries:
    | ({ role: string } & ({ authorId: string } | { authorName: string }))[]
    | undefined,
  /** Authors the same write already resolved (a new book's author) */
  known: Awaited<ReturnType<typeof bookAuthorFor>>[] = [],
) {
  if (!entries) return { credits: undefined, newAuthors: [] };
  // The database compares names with search_normalize: accents, case,
  // spaces and punctuation do not count
  const nameKey = (name: string) =>
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[\s\p{P}]+/gu, " ")
      .trim();
  const byName = new Map(known.map((author) => [nameKey(author.name), author]));
  const credits: { authorId: string; role: string }[] = [];
  for (const entry of entries) {
    if ("authorId" in entry) {
      credits.push({ authorId: entry.authorId, role: entry.role });
      continue;
    }
    const key = nameKey(entry.authorName);
    if (!byName.has(key)) {
      const taken = [...byName.values()].flatMap((a) => (a.row ? [a.row.slug] : []));
      byName.set(key, await bookAuthorFor(entry.authorName.trim(), taken));
    }
    credits.push({ authorId: byName.get(key)!.id, role: entry.role });
  }
  // One author may hold a role once
  const unique = [
    ...new Map(credits.map((c) => [`${c.authorId}:${c.role}`, c])).values(),
  ];
  return {
    credits: unique,
    newAuthors: [...byName.values()].filter((a) => a.row && !known.includes(a)),
  };
}

/** Replaces a book's subjects; nothing when the edit leaves them alone. */
export function workSubjectQueries(
  d: Db,
  workId: string,
  subjectIds: string[] | undefined,
) {
  if (!subjectIds) return [];
  return [
    d.delete(workSubjects).where(eq(workSubjects.workId, workId)),
    ...(subjectIds.length
      ? [
          d.insert(workSubjects).values(
            [...new Set(subjectIds)].map((subjectId) => ({ workId, subjectId })),
          ),
        ]
      : []),
  ];
}

/** A validated work: the title and authors, and any other create field. */
type WorkInput = Pick<z.output<typeof createWorkSchema>, "title" | "authorIds"> &
  Partial<z.output<typeof createWorkSchema>>;

/**
 * A new book work: its id and slug (`{title}-by-{author}`, numbered when
 * taken), and the writes of the work, its authors, subjects, recommendations
 * and its "created" activity.
 */
export async function planBookWork(input: WorkInput, primaryAuthorName: string) {
  const { authorIds, subjectIds, recommenderIds, ...values } = input;
  const id = randomUUID();
  const slug = await uniqueSlug(
    works,
    generateWorkSlug(values.title, primaryAuthorName, id),
  );
  const seriesPlan = workSeriesPlan(values);
  return {
    id,
    slug,
    queries: (d: Db) => [
      ...seriesPlan.queries(d),
      d.insert(works).values({ ...values, ...seriesPlan.values, id, slug }),
      ...bookAuthorQueries(d, id, authorIds),
      ...workSubjectQueries(d, id, subjectIds),
      ...curationQueries(d, { id, kind: "book" }, { recommenderIds }),
      d.insert(activityEvents).values({
        entityType: "work",
        entityId: id,
        eventKey: "work.created",
        metadata: { newValue: values.title },
      }),
    ],
  };
}

/** A validated edition: its work and title, any other create field, credits by id. */
type EditionInput = Pick<z.output<typeof createEditionSchema>, "workId" | "title"> &
  Partial<Omit<z.output<typeof createEditionSchema>, "contributorIds">> & {
    contributorIds?: { authorId: string; role: string }[];
  };

/**
 * A new edition: its id, its cover uploaded under that id (null when there is
 * no source or the download failed), and the writes of the edition, its
 * publisher links, contributors, genres, tags and its "added" activity. The
 * source URL is kept even when the download failed, so the cover can be
 * fetched again later.
 */
export async function planBookEdition(input: EditionInput) {
  const {
    publisherIds,
    contributorIds,
    genreIds,
    tagIds,
    coverSourceUrl,
    ...values
  } = input;
  const id = randomUUID();
  const cover = coverSourceUrl
    ? await processAndUploadCover(id, coverSourceUrl)
    : null;
  return {
    id,
    coverUnavailable: !!coverSourceUrl && !cover,
    queries: (d: Db) => [
      d.insert(editions).values({
        ...values,
        id,
        publisherLinksConfirmed: publisherIds !== undefined,
        coverSourceUrl: coverSourceUrl ?? null,
        ...(cover
          ? {
              coverS3Key: cover.coverKey,
              thumbnailS3Key: cover.thumbnailKey,
              ...editionCoverPaletteFields(cover.palette),
            }
          : {}),
      }),
      ...(publisherIds !== undefined
        ? [
            d.execute(
              sql`select set_edition_publishers(${id}::uuid, ARRAY(select jsonb_array_elements_text(${JSON.stringify(publisherIds)}::jsonb)::uuid))`,
            ),
          ]
        : []),
      ...(contributorIds?.length
        ? editionContributorQueries(d, id, contributorIds)
        : []),
      ...(genreIds?.length
        ? [
            d.insert(editionGenres).values(
              [...new Set(genreIds)].map((genreId) => ({ editionId: id, genreId })),
            ),
          ]
        : []),
      ...(tagIds?.length
        ? [
            d.insert(editionTags).values(
              [...new Set(tagIds)].map((tagId) => ({ editionId: id, tagId })),
            ),
          ]
        : []),
      d.insert(activityEvents).values({
        entityType: "work",
        entityId: values.workId,
        eventKey: "work.edition_added",
        metadata: {
          targetId: id,
          targetName: values.title,
          editionIsbn: values.isbn13 ?? undefined,
        },
      }),
    ],
    /** Removes the uploaded cover after a failed write; nothing references it. */
    discardCover: async () => {
      if (cover)
        await Promise.allSettled([
          deleteFromS3(cover.coverKey),
          deleteFromS3(cover.thumbnailKey),
        ]);
    },
  };
}
