import { ZodError } from "zod/v4";

/**
 * What the reader is told when a highlight, note or bookmark is not saved
 * (SLN-1494): the controller's own sentence ("This mark cannot be edited"),
 * the length limit when that is what refused it, else one plain sentence.
 * Never the validator's issue list, which is JSON.
 */
export function markFailureMessage(error: unknown, fallback = "This mark couldn't be saved."): string {
  if (error instanceof ZodError)
    return error.issues.find((issue) => issue.code === "custom" && issue.message.startsWith("Select at most"))?.message ?? fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}
