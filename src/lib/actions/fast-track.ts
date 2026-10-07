"use server";

import { isbnClash, isbnTaken } from "@/lib/catalogue/isbn-clash";
import { atomic } from "@/lib/db/atomic";
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
import { queueNewBookEnrichment } from "@/lib/enrichment/queue";

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
    const clash = await isbnClash(edition);
    if (clash)
      return { ok: false, error: `${clash}. Open that book to add a copy.` };

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
    await queueNewBookEnrichment(book.id);
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
    // Another save took this ISBN after the check
    const taken = isbnTaken(err, edition);
    if (taken)
      return { ok: false, error: `${taken}. Open that book to add a copy.` };
    console.error("Fast Track failed", err);
    return { ok: false, error: "Could not add the book. Please try again." };
  }
}
