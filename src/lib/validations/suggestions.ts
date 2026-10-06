import { z } from "zod/v4";
import { FEEDBACK_NOTE_MAX, FEEDBACK_REASONS, FEEDBACK_SOURCES, FEEDBACK_VERDICTS } from "@/lib/reading/constants";

/** Suggestion feedback (SLN-457): the reasons' schema is built from FEEDBACK_REASONS, the one list */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD");

export const setSuggestionFeedbackSchema = z
  .object({
    workId: z.uuid(),
    verdict: z.enum(FEEDBACK_VERDICTS),
    reasons: z
      .array(z.enum(FEEDBACK_REASONS))
      .max(FEEDBACK_REASONS.length)
      .default([])
      .transform((r) => [...new Set(r)]),
    note: z
      .string()
      .trim()
      .max(FEEDBACK_NOTE_MAX, `At most ${FEEDBACK_NOTE_MAX} characters`)
      .nullish()
      .transform((v) => v || null),
    /** For not_now: hidden until this day; 30 days from today by default */
    until: day.nullish(),
  })
  .refine((v) => v.verdict !== "rejected" || v.reasons.length > 0, { message: "Pick a reason", path: ["reasons"] });

export const suggestionWorkSchema = z.object({ workId: z.uuid() });

/** A row as removal or a replacing verdict returned it, for Undo */
export const suggestionFeedbackSnapshotSchema = z.object({
  id: z.uuid(),
  workId: z.uuid(),
  verdict: z.enum(FEEDBACK_VERDICTS),
  reasons: z.array(z.enum(FEEDBACK_REASONS)),
  note: z.string().max(FEEDBACK_NOTE_MAX).nullable(),
  until: day.nullable(),
  source: z.enum(FEEDBACK_SOURCES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SuggestionFeedbackSnapshot = z.infer<typeof suggestionFeedbackSnapshotSchema>;
