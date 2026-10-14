import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { uploadTableSnapshotSql } from "./atomic-snapshots";
import { uploadTargetRowsFingerprint } from "../ingest/upload-atomic";

export interface UploadTargetSummary {
  /** What the server checks the eBook against before it adds or replaces a file */
  fingerprint: string;
  title: string;
  /** The file a replacement takes the place of */
  file: { format: string; sizeBytes: number } | null;
}

/** The fingerprint covers only the ebooks and ebook_files rows, which the run in the scope never filters. */
const NO_RUN = "00000000-0000-4000-8000-000000000000";

/**
 * The eBook an add-format or replace upload changes, read when the upload
 * page opens (SLN-672): its fingerprint is the one the server compares at
 * preview, so links into the page need only the eBook and the file. Null when
 * the eBook, or the file to replace, is not there.
 */
export async function readUploadTargetSummary(
  ebookId: string,
  fileId: string | null,
  conn: Db = db,
): Promise<UploadTargetSummary | null> {
  const scope = { ebookIds: [ebookId], runId: NO_RUN };
  const [row] = resultRows<{
    ebooks: Record<string, unknown>[];
    ebook_files: Record<string, unknown>[];
  }>(
    await conn.execute(sql`select ${uploadTableSnapshotSql("ebooks", scope)} as ebooks,
      ${uploadTableSnapshotSql("ebook_files", scope)} as ebook_files`),
  );
  const ebook = row?.ebooks[0];
  if (!ebook) return null;
  const file = fileId ? row.ebook_files.find((candidate) => candidate.id === fileId) : null;
  if (fileId && !file) return null;
  return {
    fingerprint: uploadTargetRowsFingerprint(row),
    title: String(ebook.title),
    file: file ? { format: String(file.format), sizeBytes: Number(file.size_bytes) } : null,
  };
}
