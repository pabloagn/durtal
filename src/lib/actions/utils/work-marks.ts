import { eq, or, type SQL } from "drizzle-orm";
import { works } from "@/lib/db/schema";
import type { WorkMarkKey } from "@/lib/constants/marks";

const MARK_COLUMNS = {
  rare: works.isRare,
  poison: works.isPoison,
} satisfies Record<WorkMarkKey, unknown>;

/** Works with any of the marks, like other filter groups; none: no condition. */
export function marksCondition(marks: WorkMarkKey[]): SQL | undefined {
  if (!marks.length) return undefined;
  return or(...marks.map((mark) => eq(MARK_COLUMNS[mark], true)));
}
