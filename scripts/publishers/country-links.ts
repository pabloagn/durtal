/**
 * Publisher country links (SLN-330). The old import matched country text
 * with "contains", so "United States" linked to "United States Minor
 * Outlying Islands" and "India" to "British Indian Ocean Territory". This
 * re-links every publishing house from its country text with the exact
 * match the app now uses (src/lib/utils/countries.ts); with several
 * countries, the first is the primary one. Organizations without a
 * publisher kind are left alone.
 *
 * Dry run by default: prints the plan and writes it to --report. `--apply`
 * saves it in one transaction and writes the old links to --undo-file;
 * `--undo FILE` puts them back.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/publishers/country-links.ts \
 *     [--apply] [--undo FILE] [--report FILE] [--undo-file FILE] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import { countryLookup, resolveCountry } from "@/lib/utils/countries";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    undo: { type: "string" },
    report: { type: "string", default: "country-links-report.md" },
    "undo-file": { type: "string", default: "country-links-undo.json" },
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
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1, onnotice: () => {} });

type Saved = { id: string; countryId: string | null };

if (values.undo) {
  const saved: Saved[] = JSON.parse(readFileSync(values.undo, "utf8"));
  await sql.begin(async (tx) => {
    for (const s of saved)
      await tx`update publishing_houses set country_id = ${s.countryId} where id = ${s.id}`;
  });
  console.log(`Restored ${saved.length} country links from ${values.undo}`);
  await sql.end();
  process.exit(0);
}

const countries = await sql<{ id: string; name: string; alpha2: string }[]>`
  select id, name, alpha_2 as "alpha2" from countries`;
const names = new Map(countries.map((c) => [c.id, c.name]));
const lookup = countryLookup(countries);
const houses = await sql<
  { id: string; name: string; country: string | null; countryId: string | null }[]
>`select id, name, country, country_id as "countryId" from publishing_houses
  where kind is not null order by name, id`;

type Change = {
  id: string;
  name: string;
  country: string | null;
  from: string | null;
  to: string | null;
  why: string;
};
const changes: Change[] = [];
const kept: { country: string | null; link: string | null }[] = [];
for (const h of houses) {
  const target = resolveCountry(h.country, lookup);
  if (target === h.countryId) {
    kept.push({ country: h.country, link: h.countryId });
    continue;
  }
  if (target)
    changes.push({ ...h, from: h.countryId, to: target, why: h.countryId ? "wrong country" : "no link" });
  else if (h.country && h.countryId)
    // The text names no country exactly: the old link came from a guess
    changes.push({ ...h, from: h.countryId, to: null, why: "text names no country" });
  else kept.push({ country: h.country, link: h.countryId });
}

const label = (id: string | null) => (id ? (names.get(id) ?? id) : "none");
const groups = new Map<string, { change: Change; count: number }>();
for (const c of changes) {
  const k = `${c.country}|${c.from}|${c.to}`;
  const g = groups.get(k);
  if (g) g.count++;
  else groups.set(k, { change: c, count: 1 });
}

const out: string[] = [
  `# Publisher country links: ${values.apply ? "applied" : "dry run"}`,
  "",
  `${houses.length} publishing houses. ${changes.length} links change; ${kept.length} stay.`,
  "",
  "| Country text | Linked now | Links to | Why | Houses |",
  "|---|---|---|---|---|",
  ...[...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map(
      ({ change: c, count }) =>
        `| ${c.country} | ${label(c.from)} | ${label(c.to)} | ${c.why} | ${count} |`,
    ),
  "",
  "## Every change",
  "",
  ...changes.map((c) => `- ${c.name} (“${c.country}”): ${label(c.from)} → ${label(c.to)}`),
  "",
];
writeFileSync(values.report!, out.join("\n"));
console.log(out.slice(0, out.indexOf("## Every change")).join("\n"));

if (values.apply && changes.length) {
  const saved: Saved[] = changes.map((c) => ({ id: c.id, countryId: c.from }));
  writeFileSync(values["undo-file"]!, JSON.stringify(saved, null, 2));
  await sql.begin(async (tx) => {
    for (const c of changes)
      await tx`update publishing_houses set country_id = ${c.to}
        where id = ${c.id} and country_id is not distinct from ${c.from}`;
  });
  console.log(`Applied. The old links are in ${values["undo-file"]}`);
}
console.log(`Report: ${values.report}`);
await sql.end();
process.exit(0);
