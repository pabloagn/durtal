import { z } from "zod";

/**
 * A create under the id its dialog made when it opened (SLN-1276). A row the
 * id already saved comes back instead of a second one, also when a resend
 * races the first and loses on the primary key. `created` says whether this
 * call wrote it, so a repeat records no second activity.
 */
export async function createOnce<T>(
  id: string | undefined,
  stored: (id: string) => Promise<T | null | undefined>,
  create: (id: string | undefined) => Promise<T>,
): Promise<{ row: T; created: boolean }> {
  const key = id === undefined ? undefined : z.uuid().parse(id);
  const saved = key ? await stored(key) : null;
  if (saved) return { row: saved, created: false };
  try {
    return { row: await create(key), created: true };
  } catch (error) {
    const raced = key ? await stored(key) : null;
    if (raced) return { row: raced, created: false };
    throw error;
  }
}
