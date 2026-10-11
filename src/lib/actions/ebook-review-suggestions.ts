"use server";

import { z } from "zod/v4";
import { suggestForNewWork } from "@/lib/ebooks/match/suggest";

const inputSchema = z.strictObject({ workId: z.uuid().transform((value) => value.toLowerCase()) });
const outcomeSchema = z.strictObject({ workId: z.uuid(), suggestionCount: z.number().int().nonnegative(),
  status: z.enum(["ready", "unavailable"]) });
/** Consumers call this with the actual saved ID after book creation commits.
 * Candidate availability never changes the already successful create outcome. */
export async function refreshSuggestionsForCreatedBook(raw: unknown) {
  const { workId } = inputSchema.parse(raw);
  try {
    const outcome = outcomeSchema.parse(await suggestForNewWork(workId));
    if (outcome.workId !== workId || (outcome.status === "unavailable" && outcome.suggestionCount !== 0))
      throw new Error("Suggestions belong to another saved book");
    return outcome;
  } catch {
    return { workId, suggestionCount: 0, status: "unavailable" as const };
  }
}
