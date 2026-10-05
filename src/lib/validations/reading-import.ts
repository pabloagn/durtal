import { z } from "zod/v4";
import { IMPORT_DECISIONS } from "@/lib/reading/import/match-rules";

/*
 * The reading import's input rules (SLN-450). `imports.source` and
 * `imports.status` have no CHECK in the table; these lists are the rule.
 */

export const IMPORT_SOURCES = ["goodreads", "storygraph", "durtal"] as const;
export const IMPORT_STATUSES = ["pending", "completed", "undone"] as const;

/** One CSV of at most 10 MB */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const importId = z.uuid();
const rowNo = z.number().int().min(1).max(1_000_000);

export const decideImportRowSchema = z
  .object({
    importId,
    rowNo,
    decision: z.enum(IMPORT_DECISIONS).optional(),
    workId: z.uuid().optional(),
    useFileRating: z.boolean().optional(),
  })
  .refine((v) => v.decision !== undefined || v.workId !== undefined || v.useFileRating !== undefined, "Nothing to change");
export type DecideImportRowInput = z.input<typeof decideImportRowSchema>;

export const decideImportSectionSchema = z.object({
  importId,
  section: z.enum(["likely", "none"]),
  decision: z.enum(IMPORT_DECISIONS),
});

export const importIdSchema = z.object({ importId });
