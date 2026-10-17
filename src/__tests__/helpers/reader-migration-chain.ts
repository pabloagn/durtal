import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Journal = {
  entries: { idx: number; tag: string; when: number; breakpoints: boolean }[];
  [key: string]: unknown;
};
type FilePin = { path: string; sha256: string; bytes: number };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Later migrations may append, never rewrite the genuine reader history. */
export function assertAppendOnlyJournal(current: Journal, historical: Journal) {
  assert.deepEqual(
    { ...current, entries: current.entries.slice(0, historical.entries.length) },
    historical,
    "Historical reader migration journal changed",
  );
  assert.deepEqual(current.entries.map((entry) => entry.idx), current.entries.map((_, index) => index), "Migration indexes must be contiguous");
  assert.equal(new Set(current.entries.map((entry) => entry.tag)).size, current.entries.length, "Migration tags must be unique");
  for (let index = historical.entries.length; index < current.entries.length; index++) {
    const entry = current.entries[index];
    assert.ok(Number.isSafeInteger(entry.when) && entry.when > current.entries[index - 1].when, "Appended migration timestamp must advance");
  }
}

/** Keep all 179 original pins, including the byte-exact historical journal. */
export async function readPinnedReaderChain(sourceFolder: string, fixtureRoot: URL) {
  const pins = JSON.parse(await readFile(new URL("chain-pins.json", fixtureRoot), "utf8")) as { files: FilePin[] };
  assert.equal(pins.files.length, 179);
  const historicalBytes = await readFile(new URL("0088-journal.json", fixtureRoot));
  const journal = JSON.parse(historicalBytes.toString()) as Journal;
  assert.equal(journal.entries.length, 89);
  const currentJournal = JSON.parse(await readFile(join(sourceFolder, "meta/_journal.json"), "utf8")) as Journal;
  assertAppendOnlyJournal(currentJournal, journal);
  const files = [];
  for (const pin of pins.files) {
    const bytes = pin.path === "meta/_journal.json" ? historicalBytes : await readFile(join(sourceFolder, pin.path));
    assert.deepEqual({ sha256: hash(bytes), bytes: bytes.length }, { sha256: pin.sha256, bytes: pin.bytes }, pin.path);
    files.push({ path: pin.path, bytes });
  }
  return { journal, currentJournal, files };
}
