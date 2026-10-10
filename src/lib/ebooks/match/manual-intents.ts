import { z } from "zod/v4";
import { createInstanceSchema } from "@/lib/validations/instances";
import { normalizeLanguage } from "@/lib/utils/language";
import { validIsbn } from "@/lib/harmonization/normalize";
import { identifierKeys } from "./keys";
import type { NewEditionEffect } from "./types";

/** Copy metadata only. Identity, destination and digital fields belong to the planner. */
export const newCopyDraftSchema = createInstanceSchema.omit({
  editionId: true,
  locationId: true,
  format: true,
  fileSizeBytes: true,
  status: true,
}).strict();
export type NewCopyDraftInput = z.input<typeof newCopyDraftSchema>;
export type NewCopyDraft = z.output<typeof newCopyDraftSchema>;

export type NewEditionIntent = Partial<Pick<NewEditionEffect, "language" | "isbn13">>;
export const newEditionIntentSchema = z.strictObject({
  language: z.string().min(1).max(100).transform((value, context) => {
    const normalized = normalizeLanguage(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Choose a known language" });
      return z.NEVER;
    }
    return normalized;
  }).optional(),
  isbn13: z.string().regex(/^97[89]\d{10}$/).refine(
    (value) => validIsbn(value, 13) && identifierKeys([value], {}).isbns[0] === value,
    "Choose a valid canonical ISBN-13",
  ).nullable().optional(),
});
export const parseNewCopyDraft = (input: unknown): NewCopyDraft =>
  newCopyDraftSchema.parse(input);
export const parseNewEditionIntent = (input: unknown): NewEditionIntent =>
  newEditionIntentSchema.parse(input);
