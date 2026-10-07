/**
 * Length plan (SLN-466). Reads the catalogue in a read-only session, which a
 * probe proves before anything runs, and writes the page report: owned works
 * with and without pages, counts outside the plausible bounds, owned editions
 * whose counts differ, and the replay check. It writes nothing to the
 * database. The e-book metrics, --apply and --undo come with the reader
 * module (PR 2).
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/enrichment/length.ts \
 *     [--report FILE] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { assertReadOnly, readOnlySession } from "@/lib/enrichment/read-only-session";
import { lengthReport } from "@/lib/enrichment/length-report";

const { values } = parseArgs({
  options: {
    report: { type: "string", default: "tmp/length-report.md" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const session = readOnlySession(url);
try {
  await assertReadOnly(session);
  const report = await lengthReport(drizzle(session));
  mkdirSync(dirname(values.report!), { recursive: true });
  writeFileSync(values.report!, report);
  console.log(`Report written to ${values.report}`);
} finally {
  await session.end();
}
