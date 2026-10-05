import { getPaceContext } from "@/lib/actions/reading";
import { readingEstimate, type ReadingEstimate } from "./pace";

/*
 * The estimates of a page's open readings (SLN-451), from one getPaceContext
 * query for all of them. Computed per request, never cached.
 */
export async function readingEstimates(readingIds: string[], today: string): Promise<Record<string, ReadingEstimate>> {
  if (!readingIds.length) return {};
  const { readings, priors } = await getPaceContext(readingIds);
  return Object.fromEntries(Object.entries(readings).map(([id, r]) => [id, readingEstimate(r, priors, today)]));
}
