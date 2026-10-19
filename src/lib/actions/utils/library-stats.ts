import { and, asc, count, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authors, editions, instances, workAuthors, works } from "@/lib/db/schema";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { bookPersonCondition } from "@/lib/catalogue/person-boundary";
import { alphabeticalWorkIds } from "@/lib/actions/utils/alphabetical-works";
import { posterTone, readingExtras } from "@/lib/actions/utils/work-card-query";
import { compareWorks } from "@/lib/utils/title-order";
import { countryDisplayName } from "@/lib/utils/labels";

/**
 * The library's figures and the dashboard's book shelves (`getLibraryStats`),
 * each read started at once and handed back on its own, so a page can go on
 * from one part without waiting for the rest (SLN-795):
 * - `library`: the counts, recent additions, highest rated and recent people,
 *   in one round trip;
 * - `wantedIds`: the wanted shelf's books, in alphabetical order, in the same
 *   round trip;
 * - `wanted`: those books' cards, one round trip after.
 */
export function libraryStatsReads({ shelf = 8 }: { shelf?: number } = {}) {
  // The library card's first edition, so a shelf shows the cover the library shows
  const firstEdition = [asc(editions.createdAt), asc(editions.id)];
  const worksWith = {
    workAuthors: {
      with: { author: true },
      orderBy: asc(workAuthors.sortOrder),
      limit: 1,
    },
    editions: {
      columns: {
        id: true,
        thumbnailS3Key: true,
        publicationYear: true,
        language: true,
        updatedAt: true,
      },
      orderBy: firstEdition,
      limit: 1,
      with: {
        instances: {
          columns: { id: true },
        },
      },
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
        createdAt: true,
      },
      extras: posterTone,
    },
  } as const;

  const wantedIds = alphabeticalWorkIds(
    inArray(works.catalogueStatus, ["wanted", "shortlisted"]),
    shelf,
  );
  const wanted = wantedIds
    .then((ids) =>
      db.query.works.findMany({
        where: inArray(works.id, ids),
        extras: readingExtras,
        with: worksWith,
      }),
    )
    .then((found) => found.sort(compareWorks));

  // Limit the candidate IDs before loading authors, editions and media. The
  // same total ordering is used below when the selected books are hydrated:
  // equal ratings and timestamps resolve by ID, including at the shelf edge.
  const topRatedOrder = [sql`${works.rating} desc nulls last`, desc(works.createdAt), asc(works.id)];
  const topRatedIds = db.select({ id: works.id }).from(works)
    .where(and(bookCondition, isNotNull(works.rating)))
    .orderBy(...topRatedOrder).limit(shelf);
  const library = Promise.all([
    db.select({ count: count() }).from(works).where(bookCondition),
    db.select({ count: count() }).from(editions),
    db.select({ count: count() }).from(instances),
    db.select({ count: count() }).from(authors).where(bookPersonCondition),
    // Recent additions
    db.query.works.findMany({
      where: bookCondition,
      orderBy: desc(works.createdAt),
      limit: shelf,
      extras: readingExtras,
      with: worksWith,
    }),
    // Top rated
    db.query.works.findMany({
      where: inArray(works.id, topRatedIds),
      orderBy: topRatedOrder,
      limit: shelf,
      extras: readingExtras,
      with: worksWith,
    }),
    // For recent authors: get more works so we can extract unique authors
    db.query.works.findMany({
      where: bookCondition,
      orderBy: desc(works.createdAt),
      limit: 40,
      with: {
        workAuthors: {
          with: {
            author: {
              with: {
                country: { columns: { name: true, alpha2: true } },
                workAuthors: { columns: { workId: true } },
                media: {
                  columns: {
                    s3Key: true,
                    thumbnailS3Key: true,
                    type: true,
                    isActive: true,
                  },
                  extras: posterTone,
                },
              },
            },
          },
          orderBy: asc(workAuthors.sortOrder),
          limit: 1,
        },
      },
    }),
  ]).then(([
    [workCount],
    [editionCount],
    [instanceCount],
    [authorCount],
    recentWorks,
    topRatedWorks,
    recentWorksForAuthors,
  ]) => {
    // De-duplicate authors from recent works, preserving recency order
    const seenAuthorIds = new Set<string>();
    const recentAuthors: Array<{
      id: string;
      slug: string | null;
      name: string;
      photoS3Key: string | null;
      photoTone: string | null;
      nationality: string | null;
      birthYear: number | null;
      deathYear: number | null;
      worksCount: number;
    }> = [];
    for (const work of recentWorksForAuthors) {
      const author = work.workAuthors[0]?.author;
      if (author && !seenAuthorIds.has(author.id)) {
        seenAuthorIds.add(author.id);
        // Prefer active poster from media table, fall back to legacy photoS3Key
        const activePoster = author.media?.find(
          (m: { type: string; isActive: boolean }) =>
            m.type === "poster" && m.isActive,
        );
        const photoKey =
          (activePoster as { thumbnailS3Key?: string; s3Key: string } | undefined)
            ?.thumbnailS3Key ??
          (activePoster as { s3Key: string } | undefined)?.s3Key ??
          author.photoS3Key;
        recentAuthors.push({
          id: author.id,
          slug: author.slug,
          name: author.name,
          photoS3Key: photoKey,
          photoTone:
            (activePoster as { tone?: string | null } | undefined)?.tone ?? null,
          nationality: countryDisplayName(author.country),
          birthYear: author.birthYear,
          deathYear: author.deathYear,
          worksCount: author.workAuthors.length,
        });
        if (recentAuthors.length >= 12) break;
      }
    }

    return {
      works: workCount.count,
      editions: editionCount.count,
      instances: instanceCount.count,
      authors: authorCount.count,
      recentWorks,
      topRatedWorks,
      recentAuthors,
    };
  });

  return { library, wantedIds, wanted };
}
