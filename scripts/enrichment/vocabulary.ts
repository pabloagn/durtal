/**
 * The book enrichment vocabulary loader (SLN-462). Loads one approved version
 * from its seed file; the only way terms are created (R4).
 *
 * Modes:
 * - default (plan): on a read-only session, prints what the version adds,
 *   redefines, retires and keeps, the items it creates or reuses, and every
 *   enabled rule it turns off. Writes nothing.
 * - `--apply --backup FILE --approval URL`: writes the version in one
 *   transaction. Refuses without a pg_dump custom-format backup (it starts
 *   with PGDMP) written in the last hour, and without the link to Pablo's
 *   approval comment. Enabled rules of the dimensions it changes are turned
 *   off (R8: their precision was measured on the old terms).
 * - `--undo VERSION`: removes an unused version completely.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/enrichment/vocabulary.ts \
 *     [--seed FILE] [--apply --backup FILE --approval URL] [--undo VERSION] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";
import { applyVocabulary, planVocabulary, undoVocabulary, type VocabularyPlan } from "@/lib/enrichment/loader";
import { recentBackup } from "@/lib/enrichment/backup";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "src/lib/enrichment/vocabulary/v1.json" },
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    approval: { type: "string" },
    undo: { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const writes = values.apply || !!values.undo;
// Outside --apply and --undo, the session itself refuses writes
const client = postgres(url, { max: 1, onnotice: () => {}, connection: writes ? {} : { default_transaction_read_only: true } });


function report(plan: VocabularyPlan) {
  const list = (label: string, items: string[]) => console.log(`${label} (${items.length})${items.length ? `: ${items.join(", ")}` : ""}`);
  console.log(`Vocabulary version ${plan.version}`);
  list("Dimensions to add", plan.dimensions.add);
  list("Dimensions to retire", plan.dimensions.retire);
  list("Dimensions to keep", plan.dimensions.keep);
  list("Terms to add", plan.terms.add);
  list("Terms to redefine", plan.terms.redefine);
  list("Terms to retire", plan.terms.retire);
  list("Terms to keep", plan.terms.keep);
  list("Families to create", plan.families.create);
  list("Items to create", plan.items.create);
  list("Items to reuse", plan.items.reuse);
  list("Rules to add, off", plan.rules.add);
  list("Enabled rules it turns off", plan.rules.turnOff);
  if (plan.problems.length) {
    console.log(`\nProblems (${plan.problems.length}); nothing can be loaded:`);
    for (const p of plan.problems) console.log(`- ${p}`);
  }
}

try {
  if (values.undo) {
    const version = Number(values.undo);
    if (!Number.isInteger(version) || version < 1) throw new Error("--undo takes a version number");
    const result = await client.begin((tx) => undoVocabulary(drizzle(tx as unknown as postgres.Sql, { schema }) as unknown as Db, version));
    console.log(`Undid vocabulary version ${result.version} and the ${result.items} items it created`);
  } else {
    const text = readFileSync(values.seed!, "utf8");
    const seed = vocabularySeedSchema.parse(JSON.parse(text));
    if (!values.apply) {
      report(await client.begin("read only", (tx) => planVocabulary(drizzle(tx as unknown as postgres.Sql, { schema }) as unknown as Db, seed)));
    } else {
      if (!recentBackup(values.backup)) throw new Error("--apply needs --backup: a pg_dump custom-format file written in the last hour");
      if (!values.approval || !/^https:\/\/\S+$/.test(values.approval)) throw new Error("--apply needs --approval: the link to Pablo's approval comment");
      const plan = await client.begin((tx) =>
        applyVocabulary(drizzle(tx as unknown as postgres.Sql, { schema }) as unknown as Db, seed, {
          approvalUrl: values.approval!,
          seedSha256: createHash("sha256").update(text, "utf8").digest("hex"),
        }),
      );
      report(plan);
      console.log(`\nLoaded vocabulary version ${plan.version}.${plan.rules.turnOff.length ? ` Turned off ${plan.rules.turnOff.length} rules.` : ""}`);
    }
  }
} finally {
  await client.end();
}

