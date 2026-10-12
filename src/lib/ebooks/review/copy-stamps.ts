import "server-only";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { existingCopyStampForRow } from "../match/existing-copy";
import { immutableMatchingWriterInput } from "../match/link";
import type { ExistingCopyStamp } from "../match/manual-intents";
import type { StoredRow } from "../match/load";
import { reviewTimestampSql } from "./store-sql";

interface CopyOption { id: string }
interface EditionOption { id: string; copies: readonly CopyOption[] }
type StampedWorkOptions<T extends { editions: readonly EditionOption[] }> = Omit<T, "editions"> & {
  editions: (Omit<T["editions"][number], "copies"> & {
    copies: (T["editions"][number]["copies"][number] & { stamp: ExistingCopyStamp | null })[];
  })[];
};
/** The chooser bounds 200 editions and 50 copies each. One scoped read on
 * its same repeatable-read connection supplies complete native metadata guards. */
export async function attachReviewCopyStampsOn<T extends { workId: string; editions: readonly EditionOption[] }>(conn: Db, work: T): Promise<StampedWorkOptions<T>> {
  work = immutableMatchingWriterInput(work);
  const workId = z.uuid().parse(work.workId);
  if (work.editions.length > 200 || work.editions.some((edition) => edition.copies.length > 50))
    throw new Error("Review copy options exceed their displayed bounds");
  const ids = work.editions.flatMap((edition) => edition.copies.map((copy) => z.uuid().parse(copy.id)));
  if (new Set(ids).size !== ids.length) throw new Error("Review copy options contain duplicate copies");
  const rows = ids.length ? resultRows<{ row: StoredRow }>(await conn.execute(sql`
    select to_jsonb(i) || jsonb_build_object('updated_at', ${reviewTimestampSql(sql`i.updated_at`)}) as row
    from instances i join editions ed on ed.id=i.edition_id
    where ed.work_id=${workId}::uuid and i.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`,`)})
    order by i.id limit 10000`)) : [];
  const stamps = new Map<string, { editionId: string; stamp: ExistingCopyStamp | null }>();
  for (const { row } of rows) {
    if (typeof row.id !== "string" || typeof row.edition_id !== "string" || stamps.has(row.id))
      throw new Error("Review copy guard rows are inconsistent");
    // Unsupported timestamps cannot supply a usable concurrency stamp.
    const stamp = row.updated_at === null ? null : existingCopyStampForRow(row);
    stamps.set(row.id, { editionId: row.edition_id, stamp });
  }
  return { ...work, editions: work.editions.map((edition) => ({ ...edition,
    copies: edition.copies.map((copy) => ({ ...copy,
      stamp: stamps.get(copy.id)?.editionId === edition.id ? stamps.get(copy.id)!.stamp : null,
    })),
  })) } as StampedWorkOptions<T>;
}
