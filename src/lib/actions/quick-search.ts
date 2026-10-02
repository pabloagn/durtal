"use server";

import { and, asc, desc, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authors, works } from "@/lib/db/schema";
import {
  authorSearchCondition,
  authorSearchRank,
} from "@/lib/actions/utils/author-search";
import {
  textSearchCondition,
  textSearchRank,
} from "@/lib/actions/utils/text-search";

export interface QuickSearchResult {
  works: {
    id: string;
    slug: string;
    title: string;
    year: number | null;
    authors: string[];
  }[];
  authors: { id: string; slug: string; name: string }[];
}

/** Title, series and author names of a work, as one search text */
const workHaystack = sql`search_normalize(${works.title} || ' ' || coalesce(${works.seriesName}, '') || ' ' || coalesce((select string_agg(a.name, ' ') from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${works.id}), '') || ' ' || coalesce((select s.title from series s where s.id = ${works.seriesId}), ''))`;

/**
 * Search for the command palette: books by title, series, author or ISBN
 * ("brothers dostoevsky", "9780099518471"), and authors by any name form.
 * Accent-insensitive and typo-tolerant, best matches first.
 */
export async function quickSearch(query: string): Promise<QuickSearchResult> {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return { works: [], authors: [] };

  const isbn = q.replace(/[-\s]/g, "");
  const isbnMatch = /^\d{9}[\dX]$|^\d{13}$/i.test(isbn)
    ? sql`exists (select 1 from editions e where e.work_id = ${works.id} and (e.isbn_13 = ${isbn} or e.isbn_10 = ${isbn}))`
    : undefined;
  const textMatch = textSearchCondition(workHaystack, q);
  const where = isbnMatch && textMatch ? or(isbnMatch, textMatch) : (isbnMatch ?? textMatch);
  const authorWhere = authorSearchCondition(q);

  const [workRows, authorRows] = await Promise.all([
    where
      ? db.query.works.findMany({
          where: and(where, sql`${works.slug} is not null`),
          columns: { id: true, slug: true, title: true, originalYear: true },
          orderBy: [desc(textSearchRank(workHaystack, sql`${works.title}`, q)), asc(works.title)],
          limit: 8,
          with: {
            workAuthors: {
              columns: {},
              orderBy: (wa) => asc(wa.sortOrder),
              with: { author: { columns: { name: true } } },
            },
          },
        })
      : [],
    authorWhere
      ? db.query.authors.findMany({
          where: and(authorWhere, sql`${authors.slug} is not null`),
          columns: { id: true, slug: true, name: true },
          orderBy: [desc(authorSearchRank(q)), asc(authors.name)],
          limit: 5,
        })
      : [],
  ]);

  return {
    works: workRows.map((w) => ({
      id: w.id,
      slug: w.slug!,
      title: w.title,
      year: w.originalYear,
      authors: w.workAuthors.map((wa) => wa.author.name),
    })),
    authors: authorRows.map((a) => ({ id: a.id, slug: a.slug!, name: a.name })),
  };
}
