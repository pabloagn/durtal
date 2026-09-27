import { eq, or, type SQL } from "drizzle-orm";
import { works } from "@/lib/db/schema";
import { MARKS, type WorkMarkKey } from "@/lib/constants/marks";

/** The column behind a mark */
export function markColumn(mark: WorkMarkKey) {
  return works[MARKS[mark].field];
}

/** Works with any of the marks, like other filter groups; none: no condition. */
export function marksCondition(marks: WorkMarkKey[]): SQL | undefined {
  if (!marks.length) return undefined;
  return or(...marks.map((mark) => eq(markColumn(mark), true)));
}
