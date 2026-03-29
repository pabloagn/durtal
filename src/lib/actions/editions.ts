"use server";

import { db } from "@/lib/db";
import {
  editions,
  editionContributors,
  editionGenres,
  editionTags,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  createEditionSchema,
  type CreateEditionInput,
} from "@/lib/validations";
import { processAndUploadCover } from "@/lib/s3/covers";

export async function getEdition(id: string) {
  return db.query.editions.findFirst({
    where: eq(editions.id, id),
    with: {
      work: true,
      instances: {
        with: {
          location: true,
          subLocation: true,
        },
      },
      contributors: {
        with: { author: true },
        orderBy: asc(editionContributors.sortOrder),
      },
      editionGenres: {
        with: { genre: true },
      },
      editionTags: {
        with: { tag: true },
      },
    },
  });
}

export async function createEdition(input: CreateEditionInput) {
  const parsed = createEditionSchema.parse(input);
  const { contributorIds, genreIds, tagIds, coverSourceUrl, ...editionData } =
    parsed;

  // Process cover if URL provided
  let coverKeys: { coverS3Key?: string; thumbnailS3Key?: string } = {};

  const [edition] = await db
    .insert(editions)
    .values(editionData)
    .returning();

  if (coverSourceUrl) {
    const result = await processAndUploadCover(edition.id, coverSourceUrl);
    if (result) {
      coverKeys = {
        coverS3Key: result.coverKey,
        thumbnailS3Key: result.thumbnailKey,
      };
      await db
        .update(editions)
        .set({
          coverS3Key: result.coverKey,
          thumbnailS3Key: result.thumbnailKey,
          coverSourceUrl,
        })
        .where(eq(editions.id, edition.id));
    }
  }

  // Link contributors
  if (contributorIds && contributorIds.length > 0) {
    await db.insert(editionContributors).values(
      contributorIds.map((c, i) => ({
        editionId: edition.id,
        authorId: c.authorId,
        role: c.role,
        sortOrder: i,
      })),
    );
  }

  // Link genres
  if (genreIds && genreIds.length > 0) {
    await db.insert(editionGenres).values(
      genreIds.map((genreId) => ({
        editionId: edition.id,
        genreId,
      })),
    );
  }

  // Link tags
  if (tagIds && tagIds.length > 0) {
    await db.insert(editionTags).values(
      tagIds.map((tagId) => ({
        editionId: edition.id,
        tagId,
      })),
    );
  }

  return { ...edition, ...coverKeys };
}

export async function updateEdition(
  id: string,
  input: Partial<CreateEditionInput>,
) {
  const { contributorIds, genreIds, tagIds, coverSourceUrl, ...editionData } =
    input;

  const updates: Record<string, unknown> = {
    ...editionData,
    updatedAt: new Date(),
  };

  // Re-process cover if new URL
  if (coverSourceUrl) {
    const result = await processAndUploadCover(id, coverSourceUrl);
    if (result) {
      updates.coverS3Key = result.coverKey;
      updates.thumbnailS3Key = result.thumbnailKey;
      updates.coverSourceUrl = coverSourceUrl;
    }
  }

  await db.update(editions).set(updates).where(eq(editions.id, id));

  if (contributorIds) {
    await db
      .delete(editionContributors)
      .where(eq(editionContributors.editionId, id));
    if (contributorIds.length > 0) {
      await db.insert(editionContributors).values(
        contributorIds.map((c, i) => ({
          editionId: id,
          authorId: c.authorId,
          role: c.role,
          sortOrder: i,
        })),
      );
    }
  }

  if (genreIds) {
    await db.delete(editionGenres).where(eq(editionGenres.editionId, id));
    if (genreIds.length > 0) {
      await db.insert(editionGenres).values(
        genreIds.map((genreId) => ({
          editionId: id,
          genreId,
        })),
      );
    }
  }

  if (tagIds) {
    await db.delete(editionTags).where(eq(editionTags.editionId, id));
    if (tagIds.length > 0) {
      await db.insert(editionTags).values(
        tagIds.map((tagId) => ({
          editionId: id,
          tagId,
        })),
      );
    }
  }

  return { id };
}

export async function deleteEdition(id: string) {
  await db.delete(editions).where(eq(editions.id, id));
  return { id };
}

/**
 * Get the primary (first) edition for a work.
 * Used by the match-again dialog to know which edition to rematch.
 */
export async function getPrimaryEdition(workId: string) {
  const edition = await db.query.editions.findFirst({
    where: eq(editions.workId, workId),
    columns: {
      id: true,
      title: true,
      metadataSource: true,
      metadataLastFetched: true,
      isbn13: true,
      isbn10: true,
      googleBooksId: true,
      openLibraryKey: true,
    },
  });
  return edition ?? null;
}

/**
 * Re-match an edition against an external API source.
 * Fetches fresh metadata from Google Books or Open Library and updates the edition.
 * Does NOT modify the parent work's title, authors, rating, or catalogue status.
 */
export async function rematchEdition(
  editionId: string,
  source: string,
  sourceId: string,
) {
  // Fetch full metadata from the source API
  let coverUrl: string | undefined;
  const updates: Record<string, unknown> = {
    metadataSource: source,
    metadataLastFetched: new Date(),
    updatedAt: new Date(),
  };

  if (source === "google_books") {
    const { searchGoogleBooks } = await import("@/lib/api/google-books");
    // Fetch the specific volume by ID via the Google Books API
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const params = apiKey ? `?key=${apiKey}` : "";
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes/${sourceId}${params}`,
    );
    if (!res.ok) {
      // Fallback: search by sourceId
      const results = await searchGoogleBooks(sourceId, 1);
      if (results.length === 0) throw new Error("Could not fetch from Google Books");
      const r = results[0];
      updates.title = r.title;
      updates.subtitle = r.subtitle ?? null;
      updates.publisher = r.publisher ?? null;
      updates.publicationYear = r.publicationYear ?? null;
      updates.pageCount = r.pageCount ?? null;
      updates.language = r.language ?? "en";
      updates.isbn13 = r.isbn13 ?? null;
      updates.isbn10 = r.isbn10 ?? null;
      updates.description = r.description ?? null;
      updates.googleBooksId = r.sourceId;
      coverUrl = r.coverUrl;
    } else {
      const volume = await res.json();
      const info = volume.volumeInfo ?? {};
      updates.title = info.title ?? "Untitled";
      updates.subtitle = info.subtitle ?? null;
      updates.publisher = info.publisher ?? null;
      updates.publicationYear = info.publishedDate
        ? parseInt(info.publishedDate.match(/^(\d{4})/)?.[1] ?? "0", 10) || null
        : null;
      updates.pageCount = info.pageCount ?? null;
      updates.language = info.language ?? "en";
      const identifiers: { type: string; identifier: string }[] =
        info.industryIdentifiers ?? [];
      updates.isbn13 =
        identifiers.find((i: { type: string }) => i.type === "ISBN_13")?.identifier ?? null;
      updates.isbn10 =
        identifiers.find((i: { type: string }) => i.type === "ISBN_10")?.identifier ?? null;
      updates.description = info.description ?? null;
      updates.googleBooksId = sourceId;
      // Best cover
      const imageLinks = info.imageLinks;
      if (imageLinks) {
        coverUrl = (
          imageLinks.large ??
          imageLinks.medium ??
          imageLinks.small ??
          imageLinks.thumbnail ??
          imageLinks.smallThumbnail
        )?.replace("http://", "https://");
      }
    }
  } else if (source === "open_library") {
    // Open Library: sourceId is like "/works/OL123W"
    // Fetch the work or edition data
    const olKey = sourceId.startsWith("/") ? sourceId : `/${sourceId}`;
    const res = await fetch(`https://openlibrary.org${olKey}.json`);
    if (!res.ok) throw new Error("Could not fetch from Open Library");
    const data = await res.json();

    updates.title = data.title ?? "Untitled";
    updates.subtitle = data.subtitle ?? null;
    updates.openLibraryKey = sourceId;

    // Try to get edition-level details
    if (data.publishers) updates.publisher = data.publishers[0] ?? null;
    if (data.publish_date) {
      const yearMatch = String(data.publish_date).match(/(\d{4})/);
      updates.publicationYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
    }
    if (data.number_of_pages) updates.pageCount = data.number_of_pages;
    if (data.languages?.[0]?.key) {
      const langKey = data.languages[0].key;
      // "/languages/eng" -> "en"
      const langMap: Record<string, string> = { eng: "en", fra: "fr", deu: "de", spa: "es", ita: "it" };
      const code = langKey.split("/").pop() ?? "";
      updates.language = langMap[code] ?? code;
    }
    if (data.isbn_13) updates.isbn13 = data.isbn_13[0] ?? null;
    if (data.isbn_10) updates.isbn10 = data.isbn_10[0] ?? null;

    // Description
    if (typeof data.description === "string") {
      updates.description = data.description;
    } else if (data.description?.value) {
      updates.description = data.description.value;
    }

    // Cover
    if (data.covers?.[0]) {
      coverUrl = `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`;
    } else if (data.cover_i) {
      coverUrl = `https://covers.openlibrary.org/b/id/${data.cover_i}-L.jpg`;
    }
  } else {
    throw new Error(`Unsupported source: ${source}`);
  }

  // Process cover if a new URL was found
  if (coverUrl) {
    const result = await processAndUploadCover(editionId, coverUrl);
    if (result) {
      updates.coverS3Key = result.coverKey;
      updates.thumbnailS3Key = result.thumbnailKey;
      updates.coverSourceUrl = coverUrl;
    }
  }

  // Apply the update
  await db.update(editions).set(updates).where(eq(editions.id, editionId));

  // Return the updated edition
  return db.query.editions.findFirst({
    where: eq(editions.id, editionId),
  });
}
