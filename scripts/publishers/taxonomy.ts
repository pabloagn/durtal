/**
 * Publishing house taxonomy (task 0176): group → publisher → imprint.
 * Dry run by default: everything runs inside one transaction, the report is
 * written, then the transaction is rolled back. `--apply` commits.
 * `--undo RUN_ID` restores the edition imprints and countries one run set.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/publishers/taxonomy.ts \
 *     [--apply] [--undo RUN_ID] [--report FILE] [--cache FILE] [--env-dir DIR]
 *
 * Open Library answers are cached in --cache, so a dry run and the apply that
 * follows read the same evidence. Needs migration 0036.
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import {
  NOT_PUBLISHERS,
  flattenTaxonomy,
  prefixDigits,
} from "@/lib/publishers/taxonomy";
import {
  applyTaxonomy,
  isbnDigits,
  undoTaxonomyRun,
  type SourceRecord,
  type TaxonomyEdition,
  type TaxonomyReport,
} from "@/lib/publishers/taxonomy-apply";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    undo: { type: "string" },
    report: { type: "string", default: "taxonomy-report.md" },
    cache: { type: "string", default: "taxonomy-open-library.json" },
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
const where = process.env.PREVIEW_DATABASE_URL ? "local copy" : "live database";

if (values.undo) {
  const n = await sql.begin((tx) => undoTaxonomyRun(tx, values.undo!));
  console.log(`Restored ${n} edition fields of run ${values.undo}`);
  await sql.end();
  process.exit(0);
}

// Editions in the taxonomy's families: a spelling it knows, a prefix it
// holds, or a link to one of its houses
const flat = flattenTaxonomy();
const key = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
const names = new Set([
  ...flat.flatMap((h) =>
    [h.spec.name, ...(h.spec.existing ?? []), ...(h.spec.aliases ?? [])].map(
      key,
    ),
  ),
  ...NOT_PUBLISHERS.map((n) => key(n.name)),
]);
const prefixes = flat.flatMap((h) => (h.spec.prefixes ?? []).map(prefixDigits));
const rows = await sql<
  (TaxonomyEdition & { links: string[] | null })[]
>`select e.id, w.title, e.publisher, e.imprint, e.isbn_13 as "isbn13", e.isbn_10 as "isbn10",
    e.publication_country as country, e.publisher_links_confirmed as confirmed,
    (select array_agg(h.name) from edition_publishers ep join publishing_houses h on h.id = ep.publisher_id
      where ep.edition_id = e.id) as links
  from editions e join works w on w.id = e.work_id`;
const editions: TaxonomyEdition[] = rows.filter((e) => {
  const isbn = isbnDigits(e.isbn13, e.isbn10);
  return (
    [e.publisher, e.imprint].some((n) => n && names.has(key(n))) ||
    (isbn && prefixes.some((p) => isbn.startsWith(p))) ||
    (e.links ?? []).some((n) => names.has(key(n)))
  );
});

// Open Library, cached by ISBN digits; null means "not found"
const cache: Record<string, SourceRecord | null> = existsSync(values.cache!)
  ? JSON.parse(readFileSync(values.cache!, "utf8"))
  : {};
const missing = editions.filter((e) => {
  const k = isbnDigits(e.isbn13, e.isbn10);
  return k && !(k in cache);
});
async function lookUp(e: TaxonomyEdition) {
  const isbn = (e.isbn13 ?? e.isbn10 ?? "").replace(/[^0-9Xx]/g, "");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Durtal personal catalogue (publisher taxonomy)",
        },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as {
        publishers?: string[];
        series?: string[];
        publish_places?: string[];
      };
      return {
        publishers: d.publishers ?? [],
        series: d.series ?? [],
        places: d.publish_places ?? [],
      };
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return undefined; // Unreachable this time: not cached, asked again next run
}
for (let i = 0; i < missing.length; i += 4) {
  const batch = missing.slice(i, i + 4);
  const answers = await Promise.all(batch.map(lookUp));
  batch.forEach((e, j) => {
    if (answers[j] !== undefined)
      cache[isbnDigits(e.isbn13, e.isbn10)!] = answers[j]!;
  });
  if (i % 40 === 0) writeFileSync(values.cache!, JSON.stringify(cache));
}
writeFileSync(values.cache!, JSON.stringify(cache));
const sources = new Map(
  Object.entries(cache).filter((e): e is [string, SourceRecord] => !!e[1]),
);

class Rollback extends Error {}
let report: TaxonomyReport | null = null;
try {
  await sql.begin(async (tx) => {
    report = await applyTaxonomy(tx, { editions, sources });
    if (!values.apply) throw new Rollback();
  });
} catch (err) {
  if (!(err instanceof Rollback)) throw err;
}
await sql.end();
const r = report!;

// The report
const out: string[] = [];
const mode = values.apply ? "applied" : "dry run (rolled back)";
out.push(`# Publishing house taxonomy: ${mode}`, "");
out.push(
  `Run \`${r.runId}\` on the ${where}, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`,
  "",
);
const count = (a: string) => r.houses.filter((h) => h.action === a).length;
const kinds = r.totals.byKindAfter;
const imprints = r.enrichments.filter((x) => x.field === "imprint").length;
const countries = r.enrichments.filter(
  (x) => x.field === "publication_country",
).length;
out.push("## Summary", "");
out.push(
  `- Houses: ${count("create")} new, ${count("update")} changed, ${count("keep")} unchanged.`,
  `- Editions in these families: ${r.totals.editions}. With a house: ${r.totals.linkedBefore} before, ${r.totals.linkedAfter} after.`,
  `- Their links after: ${kinds.imprint ?? 0} to an imprint, ${kinds.publisher ?? 0} to a publisher, ${kinds.group ?? 0} to a group.`,
  `- From Open Library: ${imprints} imprints set. From the place or ISBN: ${countries} countries set. Refused by the ISBN check: ${r.refused.length}. Sources disagree: ${r.disagreements.length}.`,
  `- Books whose links change: ${r.links.length}.`,
  `- Open Library answers: ${sources.size} of ${editions.filter((e) => isbnDigits(e.isbn13, e.isbn10)).length} ISBNs.`,
  "",
);
if (r.warnings.length)
  out.push(
    "## Warnings",
    "",
    ...[...new Set(r.warnings)].map((w) => `- ${w}`),
    "",
  );
out.push("## Structure", "");
for (const h of r.houses) {
  const what =
    h.action === "create"
      ? "new"
      : h.action === "update"
        ? h.changes.join("; ")
        : h.action === "keep"
          ? "unchanged"
          : h.changes.join("; ");
  out.push(
    `${"  ".repeat(h.path.length - 1)}- **${h.path.at(-1)}** (${h.kind}): ${what}${h.note ? `. _${h.note}_` : ""}`,
  );
}
out.push("", "## Names that now point to a house", "");
for (const a of r.aliases)
  out.push(
    `- “${a.name}” → ${a.house}${a.movedFrom.length ? ` (moved from ${a.movedFrom.join(", ")})` : ""}`,
  );
out.push("", "## ISBN prefixes", "");
for (const p of r.rules)
  out.push(
    `- ${p.prefix} → ${p.house}${p.replaced ? ` (was ${p.replaced})` : ""}`,
  );
out.push(
  "",
  "## Not publishers",
  "",
  ...r.notPublishers.map((n) => `- ${n}`),
  "",
);
const why = new Map<string, string[]>();
for (const x of r.enrichments)
  why.set(x.editionId, [
    ...(why.get(x.editionId) ?? []),
    `${x.field === "imprint" ? "imprint" : "country"} ${x.newValue} (${x.evidence})`,
  ]);
out.push(
  `## Book links that change (${r.links.length})`,
  "",
  "| Book | Before | After | Evidence |",
  "|---|---|---|---|",
);
for (const l of r.links)
  out.push(
    `| ${l.title} | ${l.before.join(", ") || "none"} | ${l.after.join(", ") || "none"} | ${(why.get(l.editionId) ?? []).join("; ")} |`,
  );
out.push("", `## Countries set (${countries})`, "");
for (const x of r.enrichments.filter((x) => x.field === "publication_country"))
  out.push(`- ${x.title}: ${x.newValue} (${x.evidence})`);
out.push(
  "",
  `## Sources disagree on the imprint (${r.disagreements.length})`,
  "",
);
out.push(
  "The book's data names one imprint and Open Library another. Nothing changes; fix the imprint by hand if needed.",
  "",
);
for (const x of r.disagreements)
  out.push(
    `- ${x.title}: the book says “${x.printed}”, Open Library says “${x.source}”`,
  );
out.push(
  "",
  `## Open Library refused by the ISBN check (${r.refused.length})`,
  "",
);
for (const x of r.refused) out.push(`- ${x.title}: ${x.reason}`);
writeFileSync(values.report!, out.join("\n") + "\n");

console.log(out.slice(0, out.indexOf("## Structure")).join("\n"));
console.log(`Full report: ${values.report}`);
process.exit(0);
