import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { EnrichmentUndo } from "./enrichment-store";

/**
 * The undo file of an --apply run. It is created before the write
 * transaction, never over an existing file: a missing folder or another
 * run's file stops the run before anything is written. After the commit it
 * receives the values the run wrote.
 */
export function reserveUndoFile(path: string, runId: string) {
  const empty: EnrichmentUndo = { runId, written: [] };
  reserve(path, JSON.stringify(empty, null, 2));
}

function reserve(path: string, content: string) {
  try {
    writeFileSync(path, content, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new Error(`${path} exists: it may be another run's undo file. Nothing written.`);
    if (code === "ENOENT") throw new Error(`The folder of ${path} does not exist. Nothing written.`);
    throw error;
  }
}

/** The values the committed run wrote */
export function completeUndoFile(path: string, undo: EnrichmentUndo) {
  writeFileSync(path, JSON.stringify(undo, null, 2));
}

/** The write failed and rolled back: its empty undo file goes too */
export function releaseUndoFile(path: string) {
  rmSync(path, { force: true });
}

/**
 * The undo log of a long run (SLN-494): JSON lines, its header first. It is
 * reserved like an undo file, and each unit of work appends its line before
 * its write, so a crash between the two leaves a line whose rows never
 * existed, which the undo skips.
 */
export function reserveUndoLog(path: string, header: Record<string, unknown>) {
  reserve(path, JSON.stringify(header) + "\n");
}

export function appendUndoLog(path: string, entry: unknown) {
  appendFileSync(path, JSON.stringify(entry) + "\n");
}

/** The header and the entries of an undo log */
export function readUndoLog<H, E>(path: string): { header: H; entries: E[] } {
  const [first, ...rest] = readFileSync(path, "utf8").split("\n").filter((line) => line.trim());
  if (!first) throw new Error(`${path} is empty: it is not an undo log`);
  return { header: JSON.parse(first) as H, entries: rest.map((line) => JSON.parse(line) as E) };
}
