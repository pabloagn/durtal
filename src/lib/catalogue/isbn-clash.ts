import { and, eq, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions, works } from "@/lib/db/schema";
import { uniqueConstraint } from "@/lib/db/errors";
import { workHref } from "@/lib/catalogue/work-href";

/**
 * One ISBN belongs to one edition: `editions_isbn_13_unique` and
 * `editions_isbn_10_unique`. A create or an edit checks first, so the reader
 * sees which book holds the number; a write that loses a race to another one
 * gets the same message from the constraint.
 */
function message(isbn: string, title?: string | null) {
  return `An edition with ISBN ${isbn} already exists${title ? ` ("${title}")` : ""}`;
}

/** An ISBN clash or null. Planners must pass their verified connection. */
export async function isbnClash(
  { isbn13, isbn10 }: { isbn13?: string | null; isbn10?: string | null },
  exceptId?: string,
  conn: Pick<typeof db, "select"> = db,
): Promise<string | null> {
  const numbers = [
    isbn13 ? eq(editions.isbn13, isbn13) : undefined,
    isbn10 ? eq(editions.isbn10, isbn10) : undefined,
  ].filter(Boolean);
  if (!numbers.length) return null;
  const [clash] = await conn
    .select({ title: editions.title, isbn13: editions.isbn13, isbn10: editions.isbn10 })
    .from(editions)
    .where(and(or(...numbers), exceptId ? ne(editions.id, exceptId) : undefined))
    .limit(1);
  if (!clash) return null;
  return message(isbn13 && clash.isbn13 === isbn13 ? isbn13 : isbn10!, clash.title);
}

/**
 * An ISBN clash with the page of the book that holds the number, or null, so
 * an edition form can link it as the add wizard does (SLN-1033)
 */
export async function isbnHolder(
  { isbn13, isbn10 }: { isbn13?: string | null; isbn10?: string | null },
  exceptId?: string,
): Promise<{ message: string; href: string } | null> {
  const numbers = [
    isbn13 ? eq(editions.isbn13, isbn13) : undefined,
    isbn10 ? eq(editions.isbn10, isbn10) : undefined,
  ].filter(Boolean);
  if (!numbers.length) return null;
  const [clash] = await db
    .select({
      title: editions.title,
      isbn13: editions.isbn13,
      isbn10: editions.isbn10,
      work: { id: works.id, slug: works.slug, kind: works.kind },
    })
    .from(editions)
    .innerJoin(works, eq(works.id, editions.workId))
    .where(and(or(...numbers), exceptId ? ne(editions.id, exceptId) : undefined))
    .limit(1);
  if (!clash) return null;
  return {
    message: message(isbn13 && clash.isbn13 === isbn13 ? isbn13 : isbn10!, clash.title),
    href: workHref(clash.work),
  };
}
/** The message for a write an ISBN constraint refused, or null. */
export function isbnTaken(
  error: unknown,
  { isbn13, isbn10 }: { isbn13?: string | null; isbn10?: string | null },
): string | null {
  const constraint = uniqueConstraint(error);
  if (constraint === "editions_isbn_13_unique" && isbn13) return message(isbn13);
  if (constraint === "editions_isbn_10_unique" && isbn10) return message(isbn10);
  return null;
}
