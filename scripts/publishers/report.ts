/** Read-only preflight. No INSERT/UPDATE/DELETE, no migrations. */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
const { values } = parseArgs({
  options: {
    "env-dir": { type: "string", default: process.cwd() },
    output: { type: "string" },
  },
});
dotenv.config({
  path: [
    resolve(values["env-dir"]!, ".env.local"),
    resolve(values["env-dir"]!, ".env"),
  ],
  quiet: true,
});
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
const [capabilities] =
  await sql`select to_regclass('public.publisher_aliases') is not null as has_aliases`;
// This uses exactly the same SQL whitespace/case normalisation as migration 0025.
const houses =
  await sql`select id,name,country,lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) as key from publishing_houses order by name,id`;
const editions =
  await sql`select id,work_id,publisher,imprint,lower(regexp_replace(trim(publisher), '\\s+', ' ', 'g')) as publisher_key,lower(regexp_replace(trim(imprint), '\\s+', ' ', 'g')) as imprint_key from editions order by id`;
const aliases = capabilities.has_aliases
  ? await sql`select publisher_id,lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) as key from publisher_aliases`
  : [];
const index = new Map<string, Set<string>>();
for (const h of houses) {
  const ids = index.get(h.key) ?? new Set();
  ids.add(h.id);
  index.set(h.key, ids);
}
for (const a of aliases) {
  const ids = index.get(a.key) ?? new Set();
  ids.add(a.publisher_id);
  index.set(a.key, ids);
}
const rows = editions.map((e) => ({
  editionId: e.id,
  workId: e.work_id,
  fields: [
    { field: "publisher", value: e.publisher, key: e.publisher_key },
    { field: "imprint", value: e.imprint, key: e.imprint_key },
  ]
    .filter((f) => f.key)
    .map((f) => {
      const candidates = [...(index.get(f.key) ?? [])];
      return {
        field: f.field,
        value: f.value,
        status:
          candidates.length === 1
            ? "exact"
            : candidates.length === 0
              ? "unmatched"
              : "ambiguous",
        candidates,
      };
    }),
}));
const report = {
  readOnly: true,
  publishers: houses.length,
  editions: editions.length,
  fullyMatched: rows.filter(
    (r) => r.fields.length && r.fields.every((f) => f.status === "exact"),
  ).length,
  needsReview: rows.filter((r) => r.fields.some((f) => f.status !== "exact"))
    .length,
  noPublisherText: rows.filter((r) => !r.fields.length).length,
  rows,
};
if (values.output)
  await writeFile(
    resolve(values.output),
    JSON.stringify(report, null, 2) + "\n",
  );
const { rows: _, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
