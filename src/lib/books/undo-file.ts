import { rmSync, writeFileSync } from "node:fs";
import type { EnrichmentUndo } from "./enrichment-store";

/**
 * The undo file of an --apply run. It is created before the write
 * transaction, never over an existing file: a missing folder or another
 * run's file stops the run before anything is written. After the commit it
 * receives the values the run wrote.
 */
export function reserveUndoFile(path: string, runId: string) {
  try {
    const empty: EnrichmentUndo = { runId, written: [] };
    writeFileSync(path, JSON.stringify(empty, null, 2), { flag: "wx" });
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
