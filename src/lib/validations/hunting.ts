import { z } from "zod";
import { HUNT_DIFFICULTIES } from "@/lib/constants/hunting";

export const huntAssessmentSchema = z.discriminatedUnion("huntDifficulty", [
  z
    .object({
      huntDifficulty: z.enum(HUNT_DIFFICULTIES),
      huntAssessedOn: z.iso.date("Choose a valid assessment date"),
    })
    .strict(),
  z.object({ huntDifficulty: z.null(), huntAssessedOn: z.null() }).strict(),
]);
export type HuntAssessmentInput = z.infer<typeof huntAssessmentSchema>;
