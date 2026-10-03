"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { editions } from "@/lib/db/schema";
import {
  fastTrackBookSchema,
  type FastTrackBookInput,
} from "@/lib/validations/fast-track";
import {
  bookAuthorFor,
  newAuthorQueries,
  planBookEdition,
  planBookWork,
} from "@/lib/catalogue/book-store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { autoResolveEditions } from "@/lib/publishers/resolution";

type Result =
  | {
      ok: true;
      slug: string;
      workId: string;
      editionId: string;
      coverUnavailable: boolean;
    }
  | { ok: false; error: string };

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
  let plan: Awaited<ReturnType<typeof planBookEdition>> | null = null;
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

    const author = await bookAuthorFor(authorName);
    const book = await planBookWork(
      { ...work, authorIds: [{ authorId: author.id, role: "author" }] },
      author.name,
    );
    plan = await planBookEdition({
      ...edition,
      workId: book.id,
      title: work.title,
    });
    const editionId = plan.id;

    // The ISBN and slug unique constraints also protect racing submissions.
    // Any failure rolls back the author, work and all relation rows together.
    await atomic((d) => [
      ...newAuthorQueries(d, author),
      ...book.queries(d),
      ...plan!.queries(d),
    ]);
    // A publisher name no house knows yet is decided when it is safe
    await autoResolveEditions([editionId]);
    invalidate(
      CACHE_TAGS.series,
      CACHE_TAGS.works,
      CACHE_TAGS.editions,
      CACHE_TAGS.authors,
    );
    return {
      ok: true,
      slug: book.slug,
      workId: book.id,
      editionId,
      coverUnavailable: plan.coverUnavailable,
    };
  } catch (err) {
    await plan?.discardCover();
    console.error("Fast Track failed", err);
    return { ok: false, error: "Could not add the book. Please try again." };
  }
}
