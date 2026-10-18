import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAppendOnlyJournal, readPinnedReaderChain, type Journal } from "../helpers/reader-migration-chain";

const fixtureRoot = new URL("../integration/fixtures/reader-full-chain/", import.meta.url);
const historical = JSON.parse(await readFile(new URL("0088-journal.json", fixtureRoot), "utf8")) as Journal;
const appended = (): Journal => ({ ...structuredClone(historical), entries: [...structuredClone(historical.entries), { idx: 89, tag: "0089_new_feature", when: historical.entries.at(-1)!.when + 1, breakpoints: true }] });

describe("historical reader migration boundary", () => {
  it("accepts the current append-only journal while retaining every original file pin", async () => {
    const chain = await readPinnedReaderChain(resolve("src/lib/db/migrations"), fixtureRoot);
    expect(chain.files).toHaveLength(179);
    expect(chain.journal.entries).toHaveLength(89);
    expect(chain.currentJournal.entries.length).toBeGreaterThanOrEqual(89);
    expect(chain.currentJournal.entries.slice(0, 89)).toEqual(chain.journal.entries);
    expect(chain.files.find((file) => file.path === "meta/_journal.json")!.bytes)
      .toEqual(await readFile(new URL("0088-journal.json", fixtureRoot)));
  });

  it("accepts later migrations without repinning the reader journal", () => {
    expect(() => assertAppendOnlyJournal(appended(), historical)).not.toThrow();
  });

  it("refuses a historical entry rewrite even with a valid later append", () => {
    const changed = appended();
    changed.entries[82].when++;
    expect(() => assertAppendOnlyJournal(changed, historical)).toThrow("Historical reader migration journal changed");
  });

  it("refuses removed history and changed journal metadata", () => {
    const removed = structuredClone(historical); removed.entries.pop();
    expect(() => assertAppendOnlyJournal(removed, historical)).toThrow("Historical reader migration journal changed");
    expect(() => assertAppendOnlyJournal({ ...appended(), dialect: "different" }, historical))
      .toThrow("Historical reader migration journal changed");
  });

  it("refuses noncontiguous indexes, duplicate tags and backdated appended entries", () => {
    const index = appended(); index.entries[89].idx = 90;
    expect(() => assertAppendOnlyJournal(index, historical)).toThrow("Migration indexes must be contiguous");
    const tag = appended(); tag.entries[89].tag = tag.entries[88].tag;
    expect(() => assertAppendOnlyJournal(tag, historical)).toThrow("Migration tags must be unique");
    const timestamp = appended(); timestamp.entries[89].when = timestamp.entries[88].when;
    expect(() => assertAppendOnlyJournal(timestamp, historical)).toThrow("Appended migration timestamp must advance");
  });
});
