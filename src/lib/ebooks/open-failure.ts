import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";

/*
 * A file the reader could not open (SLN-685). The reader records why under
 * `ebook_files.metadata.openFailure` and clears it when the file opens. The
 * status is left as it is, so Retry and downloads keep working.
 */

/** Why the reader last failed to open a file, and when */
export interface OpenFailure {
  reason: string;
  at: string;
}

/** The longest reason kept: an engine's message, never a stack */
export const OPEN_FAILURE_REASON_MAX = 300;

/** The failure a file's metadata records, or null */
export function openFailureOf(metadata: unknown): OpenFailure | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const failure = (metadata as Record<string, unknown>).openFailure;
  if (!failure || typeof failure !== "object" || Array.isArray(failure)) return null;
  const { reason, at } = failure as Record<string, unknown>;
  return typeof reason === "string" && typeof at === "string" ? { reason, at } : null;
}

/**
 * Records why a file did not open. Only a file the reader could have been
 * given: stored or verified, with no DRM. False when there is none.
 */
export async function recordOpenFailure(fileId: string, reason: string, at = new Date()): Promise<boolean> {
  const kept = reason.trim().slice(0, OPEN_FAILURE_REASON_MAX) || "The file could not be opened.";
  const rows = resultRows<{ id: string }>(
    await db.execute(sql`update ebook_files
      set metadata = metadata || jsonb_build_object('openFailure',
        jsonb_build_object('reason', ${kept}::text, 'at', ${at.toISOString()}::text))
      where id = ${fileId}::uuid and status in ('stored', 'verified') and drm is null
      returning id`),
  );
  return rows.length > 0;
}

/** Clears a recorded failure once the file opens. False when there was none. */
export async function clearOpenFailure(fileId: string): Promise<boolean> {
  const rows = resultRows<{ id: string }>(
    await db.execute(sql`update ebook_files set metadata = metadata - 'openFailure'
      where id = ${fileId}::uuid and metadata -> 'openFailure' is not null
      returning id`),
  );
  return rows.length > 0;
}
