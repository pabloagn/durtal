/**
 * Safe automatic publisher decisions for the whole catalogue (task 0172).
 * Dry run by default: prints every planned link, new house and held name.
 * `--apply` writes them; every decision is logged and can be undone in
 * Publishers → Publisher names. Needs migrations 0034 and 0035.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/publishers/auto-resolve.ts [--apply] [--max-creates N] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import dotenv from "dotenv";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    "max-creates": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [
    resolve(values["env-dir"]!, ".env.local"),
    resolve(values["env-dir"]!, ".env"),
  ],
  quiet: true,
});
if (!process.env.DATABASE_URL && !process.env.PREVIEW_DATABASE_URL)
  throw new Error("DATABASE_URL is required");

const { applyAutomaticDecisions, loadNameInbox } = await import(
  "@/lib/publishers/resolution"
);

const { rows } = await loadNameInbox();
const editions = (list: typeof rows) => list.reduce((n, r) => n + r.editions.length, 0);
const aliases = rows.filter((r) => r.automatic.action === "alias");
const creates = rows.filter((r) => r.automatic.action === "create");
const holds = rows.filter((r) => r.automatic.action === "hold");

console.log(`${rows.length} names on ${editions(rows)} editions without a house\n`);
console.log(`LINK TO A SIMILAR HOUSE: ${aliases.length} names, ${editions(aliases)} editions`);
for (const r of aliases)
  if (r.automatic.action === "alias")
    console.log(`  ${r.name} (${r.editions.length}) → ${r.automatic.publisher.name} · ${r.automatic.reason}`);
console.log(`\nNEW HOUSE: ${creates.length} names, ${editions(creates)} editions`);
for (const r of creates)
  if (r.automatic.action === "create")
    console.log(`  ${r.name} (${r.editions.length}) → “${r.automatic.name}”`);
console.log(`\nLEFT FOR A PERSON: ${holds.length} names, ${editions(holds)} editions`);
const reasons = new Map<string, string[]>();
for (const r of holds)
  if (r.automatic.action === "hold") {
    const reason = r.automatic.reason.replace(/“.*”|\(.*\)|978[-0-9]+/g, "…");
    reasons.set(reason, [...(reasons.get(reason) ?? []), `${r.name} (${r.editions.length})`]);
  }
for (const [reason, names] of [...reasons].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${reason}: ${names.join("; ")}`);

if (values.apply) {
  const max = values["max-creates"] ? Number(values["max-creates"]) : undefined;
  const result = await applyAutomaticDecisions({ maxCreates: max });
  console.log(
    `\nAPPLIED: ${result.aliases.length} links, ${result.created.length} new houses, ${result.linked} editions now have a house, ${result.held} names left`,
  );
} else {
  console.log("\nDry run: nothing was written. Add --apply to write.");
}
// The database client keeps the process alive
process.exit(0);
