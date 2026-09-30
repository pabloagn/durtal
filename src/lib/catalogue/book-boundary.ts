import { and, eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { kindsWithCapability } from "./domains";
import type { WorkKind } from "./kinds";

/** Narrow the schema's shared nullable language at the existing book API boundary. */
export function bookResult<
  T extends { kind: WorkKind; originalLanguage: string | null },
>(row: T | undefined) {
  if (!row) return null;
  if (row.kind !== "book" || row.originalLanguage === null)
    throw new Error(
      "Invalid book language or domain at the catalogue boundary",
    );
  return {
    ...row,
    kind: "book" as const,
    originalLanguage: row.originalLanguage,
  };
}

/** The legacy library is a book adapter; domain-neutral code must not use this. */
export const bookCondition = eq(works.kind, "book");

/** Filter a junction without dropping zero-count parent rows in a LEFT JOIN. */
export function bookReferenceCondition(workId: SQLWrapper): SQL {
  return sql`exists (select 1 from works book_scope where book_scope.id = ${workId} and book_scope.kind = 'book')`;
}

/** Reject an entire selection before any mutation, including related records. */
export async function requireBookWorks(workIds: string[]): Promise<void> {
  const ids = [...new Set(z.array(z.uuid()).parse(workIds))];
  if (!ids.length) return;
  const found = await db
    .select({ id: works.id })
    .from(works)
    .where(
      and(
        inArray(works.kind, kindsWithCapability("bookLifecycle")),
        inArray(works.id, ids),
      ),
    );
  if (found.length !== ids.length)
    throw new Error("Book not found: this action only accepts existing books");
}

export async function requireBookWork(workId: string): Promise<void> {
  await requireBookWorks([workId]);
}
