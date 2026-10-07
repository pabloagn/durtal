/**
 * Writes the e-book test corpus (SLN-494) into a new or empty folder: one
 * file of every format and case the ingestion handles, then generated EPUBs.
 * Everything is built in code; nothing is downloaded.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/qa/make-ebook-corpus.ts <folder> [--count 200]
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeEbookCorpus } from "../../src/__tests__/fixtures/ebook-corpus";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { count: { type: "string", default: "200" } } });
if (positionals.length !== 1) throw new Error("Usage: make-ebook-corpus.ts <folder> [--count N]");
const dir = resolve(positionals[0]);
if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty: name a new or empty folder`);
const count = Number(values.count);
if (!Number.isInteger(count) || count < 0) throw new Error("--count takes a whole number");

const written = await writeEbookCorpus(dir, { count });
console.log(`Wrote ${written.length} files to ${dir}.`);
