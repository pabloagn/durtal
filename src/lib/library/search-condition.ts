import { eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  authors,
  editionPublishers,
  editions,
  publishingHouses,
  workAuthors,
  works,
} from "@/lib/db/schema";
import { authorSearchCondition } from "@/lib/actions/utils/author-search";
import { textContains } from "@/lib/actions/utils/text-search";
import { containsPattern } from "@/lib/utils/like";

/**
 * Build a search condition that matches works by title, author, ISBN,
 * publisher, or series name. Detects ISBN-shaped queries and prioritises
 * edition-level ISBN lookup. Each related-table match is a subquery of the
 * list's own where clause, so a search adds no round trip before the list
 * and its count (SLN-750). The library's lists and its timeline search the
 * same way (SLN-881).
 */
export function workSearchCondition(search: string): SQL {
  const stripped = search.replace(/[-\s]/g, "");
  const isIsbn = /^\d{10,13}$/.test(stripped);

  // Works that match through related tables
  const related: SQL[] = [];

  // 1. ISBN lookup (always, not just when the query "looks like" an ISBN —
  //    this lets partial-ISBN or hyphenated-ISBN queries still match)
  if (isIsbn || /\d{4,}/.test(stripped)) {
    const target = isIsbn ? stripped : search.trim();
    const isbnWorks = inArray(
      works.id,
      db
        .select({ workId: editions.workId })
        .from(editions)
        .where(
          or(
            eq(editions.isbn13, target),
            eq(editions.isbn10, target),
            ilike(editions.isbn13, containsPattern(target)),
            ilike(editions.isbn10, containsPattern(target)),
          ),
        ),
    );
    // Pure ISBN query — don't bother with title/author text matching
    if (isIsbn) return isbnWorks;
    related.push(isbnWorks);
  }

  // 2. Author name match (accent/case-insensitive, any word order; no typo
  //    matching here, so book results stay precise)
  const authorCondition = authorSearchCondition(search, { fuzzy: false });
  if (authorCondition) {
    related.push(
      inArray(
        works.id,
        db
          .select({ workId: workAuthors.workId })
          .from(workAuthors)
          .innerJoin(authors, eq(workAuthors.authorId, authors.id))
          .where(authorCondition),
      ),
    );
  }

  // 3. Publisher match (via editions): the edition's publisher text, and the
  //    publisher record it links to or one of that record's aliases
  related.push(
    inArray(
      works.id,
      db
        .select({ workId: editions.workId })
        .from(editions)
        .where(textContains(editions.publisher, search)),
    ),
    inArray(
      works.id,
      db
        .select({ workId: editions.workId })
        .from(editions)
        .innerJoin(editionPublishers, eq(editionPublishers.editionId, editions.id))
        .innerJoin(
          publishingHouses,
          eq(publishingHouses.id, editionPublishers.publisherId),
        )
        .where(
          sql`${textContains(publishingHouses.name, search)} or exists (select 1 from publisher_aliases a where a.publisher_id = ${publishingHouses.id} and ${textContains(sql`a.name`, search)})`,
        ),
    ),
  );

  // Title match OR series name match OR related-table matches
  return or(
    textContains(works.title, search),
    textContains(works.seriesName, search),
    sql`exists (select 1 from series where series.id = ${works.seriesId} and ${textContains(sql`series.title`, search)})`,
    ...related,
  )!;
}
