import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { WORK_MARKS, type WorkMarkKey } from "@/lib/constants/marks";
import { alphabeticalWorkIds } from "@/lib/actions/utils/alphabetical-works";
import { markColumn } from "@/lib/actions/utils/work-marks";
import { workCardExtras, workCardWith } from "@/lib/actions/utils/work-card-query";
import { compareWorks } from "@/lib/utils/title-order";

/**
 * Other works with a mark, alphabetically, for the book page's mark rows, in
 * two steps (SLN-1163): the ids, then their cards. The page reads the ids'
 * e-book marks alongside the cards, not after them.
 */
export async function markedWorkIds(mark: WorkMarkKey, excludeWorkId: string, limit = 12) {
  const key = z.enum(WORK_MARKS.map((m) => m.key)).parse(mark);
  const id = z.uuid().parse(excludeWorkId);
  z.number().int().min(1).max(50).parse(limit);
  return alphabeticalWorkIds(and(eq(markColumn(key), true), ne(works.id, id)), limit);
}

/** The cards of works picked by id, alphabetically */
export async function markedWorkCards(ids: string[]) {
  if (!ids.length) return [];
  const results = await db.query.works.findMany({
    where: inArray(works.id, ids),
    extras: workCardExtras,
    with: workCardWith,
  });
  return results.sort(compareWorks);
}
