import { ZodError } from "zod";
import { readableDatabaseError } from "@/lib/db/errors";
import { ExpectedActionError } from "./expected-error";

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Expected catalogue refusals cross a server action as data. Unknown failures
 * still throw, so Next protects their details and records its error digest. */
export async function actionResult<T>(
  run: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const readable = readableDatabaseError(error);
    if (readable instanceof ExpectedActionError)
      return { ok: false, error: readable.message };
    if (error instanceof ZodError)
      return {
        ok: false,
        error: error.issues[0]?.message ?? "Check the form and try again.",
      };
    throw error;
  }
}
