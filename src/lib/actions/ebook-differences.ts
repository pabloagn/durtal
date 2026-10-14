"use server";

import { z } from "zod/v4";
import { DIFFERENCE_FIELDS } from "@/lib/ebooks/differences/compare";
import { decideDifferences, undoDifferences } from "@/lib/ebooks/differences/store";

/* The Differences section's choices (SLN-658). A batch is what the page shows: at most 500 rows. */

const item = z.strictObject({
  ebookId: z.uuid(),
  field: z.enum(DIFFERENCE_FIELDS),
  durtal: z.string().max(5000).nullable(),
  file: z.string().max(5000).nullable(),
});
const decideInput = z.strictObject({ choice: z.enum(["keep", "use"]), items: z.array(item).min(1).max(500) });
const undoInput = z.strictObject({ eventIds: z.array(z.uuid()).min(1).max(500) });

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
async function result<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: "These rows could not be read. Reload and try again." };
    console.error("[ebook differences]", error);
    return { ok: false, message: "The outcome could not be confirmed. Reload to see what was saved." };
  }
}

export async function decideEbookDifferences(raw: unknown) {
  return result(async () => {
    const input = decideInput.parse(raw);
    return decideDifferences(input.choice, input.items);
  });
}

export async function undoEbookDifferences(raw: unknown) {
  return result(async () => undoDifferences(undoInput.parse(raw).eventIds));
}
