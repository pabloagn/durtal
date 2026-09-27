import { z } from "zod/v4";

export const seriesInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(300, "Title is too long"),
  originalTitle: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .transform((v) => v || null),
  description: z
    .string()
    .trim()
    .max(5000)
    .nullable()
    .optional()
    .transform((v) => v || null),
  totalVolumes: z.number().int().min(1).max(999).nullable().optional(),
  isComplete: z.boolean().optional(),
});
export type SeriesInput = z.input<typeof seriesInputSchema>;

/** A place in a series: "1", "2", "2.5" (a novella between two volumes). Empty clears it. */
export const seriesPositionSchema = z
  .string()
  .trim()
  .max(20)
  .nullable()
  .transform((v) => v || null)
  .refine((v) => v === null || /^\d{1,4}(\.\d{1,3})?$/.test(v), {
    message: "Use a number such as 1, 2 or 2.5",
  });

/** Numeric sort key for a position; unknown positions sort last. */
export function positionValue(position: string | null | undefined): number {
  if (!position) return Number.POSITIVE_INFINITY;
  const n = Number(position);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}
