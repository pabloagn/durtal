import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions, works } from "@/lib/db/schema";
import {
  workCardExtras,
  workCardWith,
} from "@/lib/actions/utils/work-card-query";

export interface BookCardChoice {
  workId: string;
  editionId?: string | null;
}

/** Hydrate only selected books and matching editions, shared across related rows. */
export async function loadRelatedBooks(choices: BookCardChoice[]) {
  const ids = [...new Set(choices.map((choice) => choice.workId))];
  const selected = [
    ...new Set(
      choices.flatMap((choice) => (choice.editionId ? [choice.editionId] : [])),
    ),
  ];
  const [books, matching] = await Promise.all([
    ids.length
      ? db.query.works.findMany({
          where: and(eq(works.kind, "book"), inArray(works.id, ids)),
          extras: workCardExtras,
          with: workCardWith,
        })
      : Promise.resolve([]),
    selected.length
      ? db.query.editions.findMany({
          where: inArray(editions.id, selected),
          columns: {
            id: true,
            workId: true,
            title: true,
            coverS3Key: true,
            thumbnailS3Key: true,
            publicationYear: true,
            language: true,
          },
          with: { instances: { columns: { id: true } } },
        })
      : Promise.resolve([]),
  ]);
  return {
    books: new Map(books.map((book) => [book.id, book])),
    editions: new Map(matching.map((edition) => [edition.id, edition])),
  };
}

export type RelatedBook =
  Awaited<ReturnType<typeof loadRelatedBooks>>["books"] extends Map<
    string,
    infer Book
  >
    ? Book & { editionNote?: string }
    : never;
