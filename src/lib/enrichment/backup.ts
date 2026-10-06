import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

/**
 * A pg_dump custom-format backup (the file starts with PGDMP) written in the
 * last hour: what every enrichment write needs first (R9), as
 * scripts/books/enrich.ts asks.
 */
export function recentBackup(file: string | undefined, now = Date.now()) {
  if (!file || !existsSync(file)) return false;
  const head = Buffer.alloc(5);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 5, 0);
  } finally {
    closeSync(fd);
  }
  return head.toString("latin1") === "PGDMP" && now - statSync(file).mtimeMs < 3600_000;
}
