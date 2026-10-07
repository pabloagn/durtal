import { existsSync, readFileSync, writeFileSync } from "node:fs";

/*
 * Source answers by lookup (an ISBN, an Open Library key, a QID), so a plan
 * and the apply after it read the same answers (SLN-464). The file is
 * rewritten after each answer. A missing record is kept as "none"; a refusal
 * is never kept, so the next run asks again. Delete the file for fresh answers.
 */

export interface CachedAnswer {
  /** When the answer was fetched: the source record's retrieval time */
  retrievedAt: string;
  /** Null: the source has no record (a 404 or an empty answer) */
  answer: unknown;
}

export class SourceCache {
  private constructor(
    private readonly file: string | null,
    private readonly answers: Record<string, CachedAnswer>,
  ) {}

  /** The cache in a file, empty when the file does not exist */
  static load(file: string) {
    return new SourceCache(file, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
  }

  /** A cache kept in memory only, for tests */
  static memory(answers: Record<string, CachedAnswer> = {}) {
    return new SourceCache(null, { ...answers });
  }

  get(key: string): CachedAnswer | undefined {
    return this.answers[key];
  }

  set(key: string, answer: unknown, retrievedAt = new Date()) {
    this.answers[key] = { retrievedAt: retrievedAt.toISOString(), answer: answer ?? null };
    if (this.file) writeFileSync(this.file, JSON.stringify(this.answers, null, 2));
  }
}

/** A source refused a call (a quota or a rate limit): the fetch stops, and nothing is cached */
export class QuotaStop extends Error {}
