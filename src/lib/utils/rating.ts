/*
 * A work's rating as text (SLN-446): 0.5 to 5 in half steps, written "4" or
 * "4.5", never "4.0". Pure, so server code and activity sentences use it too.
 */

/** "4" for 4, "4.5" for 4.5, "" for no rating */
export function formatRating(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 2) / 2);
}

/** The half steps from 0.5 to 5, highest first */
export const HALF_STEPS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5] as const;

/** A rating parameter from a URL as a half step from 0.5 to 5, else undefined */
export function parseRatingParam(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return (HALF_STEPS as readonly number[]).includes(n) ? n : undefined;
}
