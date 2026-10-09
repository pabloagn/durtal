import type { DurtalLocator } from "./engine";
import type { JumpSource } from "./navigation";

export interface HistoryEntry {
  locator: DurtalLocator;
  source: JumpSource;
  originMark?: string;
}

/** One open file, in memory. Only painted navigation commits change the cursor. */
export class ReaderHistory {
  #entries: HistoryEntry[] = [];
  #cursor = -1;
  #searchChain = false;
  get entries(): readonly HistoryEntry[] {
    return this.#entries;
  }
  get cursor() {
    return this.#cursor;
  }
  get current() {
    return this.#entries[this.#cursor] ?? null;
  }
  get back() {
    return this.#entries[this.#cursor - 1] ?? null;
  }
  get forward() {
    return this.#entries[this.#cursor + 1] ?? null;
  }
  start(locator: DurtalLocator) {
    this.#entries = [{ locator, source: "resume" }];
    this.#cursor = 0;
    this.#searchChain = false;
  }
  turn(locator: DurtalLocator) {
    if (!this.current) this.start(locator);
    else this.#entries[this.#cursor] = { ...this.current, locator };
    this.#searchChain = false;
  }
  /** Reflow updates the anchor without creating or interrupting a reading-history step. */
  reanchor(locator: DurtalLocator) {
    if (this.current)
      this.#entries[this.#cursor] = { ...this.current, locator };
  }
  push(
    origin: DurtalLocator,
    destination: DurtalLocator,
    source: JumpSource,
    originMark?: string,
  ) {
    if (!this.current) this.start(origin);
    if (source === "history") return;
    const replace = source === "search" && this.#searchChain;
    if (!replace)
      this.#entries[this.#cursor] = {
        ...this.current!,
        locator: origin,
        originMark,
      };
    this.#entries.splice(this.#cursor + 1);
    const entry = { locator: destination, source };
    if (replace) this.#entries[this.#cursor] = entry;
    else {
      this.#entries.push(entry);
      this.#cursor++;
    }
    if (this.#entries.length > 100) {
      this.#entries.shift();
      this.#cursor--;
    }
    this.#searchChain = source === "search";
  }
  commit(direction: -1 | 1, locator: DurtalLocator) {
    const next = this.#cursor + direction;
    if (!this.#entries[next]) return false;
    this.#cursor = next;
    this.#entries[next] = { ...this.#entries[next], locator };
    this.#searchChain = false;
    return true;
  }
}
