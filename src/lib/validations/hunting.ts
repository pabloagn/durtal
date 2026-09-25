import { z } from "zod";

export const huntAssessmentSchema = z.discriminatedUnion("isRare", [
  z
    .object({
      isRare: z.literal(true),
      huntAssessedOn: z.iso.date("Choose a valid date"),
    })
    .strict(),
  z.object({ isRare: z.literal(false), huntAssessedOn: z.null() }).strict(),
]);
export type HuntAssessmentInput = z.infer<typeof huntAssessmentSchema>;
