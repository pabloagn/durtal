import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

/** A pg_dump custom-format file (it starts with PGDMP) written in the last hour: what --apply asks for (R9) */
export function recentBackup(file: string | undefined): boolean {
  if (!file || !existsSync(file)) return false;
  const head = Buffer.alloc(5);
  const fd = openSync(file, "r");
  try {
    readSync(fd, head, 0, 5, 0);
  } finally {
    closeSync(fd);
  }
  return head.toString("latin1") === "PGDMP" && Date.now() - statSync(file).mtimeMs < 60 * 60_000;
}
