/**
 * Publisher enrichment (SLN-330). Researches every publishing house on
 * Wikidata, checks each match against the evidence of the house's own books
 * (their ISBN registration groups and publication countries), and fills only
 * what is empty: country, website and an "About" text built from Wikidata
 * facts. The Wikidata id and the facts used are kept as provenance
 * (catalogue_identifiers, source_records). Every country link is then set
 * from the country text with the exact match of src/lib/utils/countries.ts.
 *
 * Dry run by default: the whole run happens in one transaction that is rolled
 * back, and the plan is written to --report. `--apply` commits and writes the
 * old values and the identifiers it created to --undo-file; `--undo FILE`
 * puts them back. `--rehash RUN_ID` (with --apply) replaces a run's source
 * records with identical ones whose payload hash follows the sorted-key rule.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/publishers/enrich.ts \
 *     [--apply] [--undo FILE] [--report FILE] [--cache FILE] [--undo-file FILE] [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import {
  getItems,
  publisherClasses,
  searchItems,
  type WikidataCache,
} from "@/lib/publishers/wikidata";
import {
  PUBLISHER_ROOTS,
  planHouse,
  sourcePayloadHash,
  searchTexts,
  type HouseEvidence,
  type HousePlan,
} from "@/lib/publishers/enrichment";
import { countryLookup, resolveCountry } from "@/lib/utils/countries";
import { ENRICHMENT_REVIEW } from "@/lib/publishers/enrichment-review";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    undo: { type: "string" },
    rehash: { type: "string" },
    report: { type: "string", default: "publisher-enrichment.md" },
    cache: { type: "string", default: "publisher-wikidata.json" },
    "undo-file": { type: "string", default: "publisher-enrichment-undo.json" },
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

type Saved = {
  id: string;
  country: string | null;
  countryId: string | null;
  website: string | null;
  description: string | null;
};

type UndoFile = {
  runId: string;
  houses: Saved[];
  /** Identifiers this run created; undo removes these and no others */
  identifiers?: string[];
};

/** Identifiers the run's own source records point to */
async function runIdentifiers(tx: postgres.Sql, runId: string) {
  return (
    await tx<{ id: string }[]>`select distinct identifier_id as id from source_records
      where provider = 'wikidata' and payload->>'runId' = ${runId} and identifier_id is not null`
  ).map((r) => r.id);
}

if (values.undo) {
  const saved: UndoFile = JSON.parse(readFileSync(values.undo, "utf8"));
  await sql.begin(async (t) => {
    const tx = t as unknown as postgres.Sql;
    for (const s of saved.houses)
      await tx`update publishing_houses set country = ${s.country}, country_id = ${s.countryId},
        website = ${s.website}, description = ${s.description} where id = ${s.id}`;
    // An undo file from before the list was kept: the run created every
    // identifier its records point to (there were none before it)
    const created = saved.identifiers ?? (await runIdentifiers(tx, saved.runId));
    await tx`delete from source_records where provider = 'wikidata'
      and payload->>'runId' = ${saved.runId}`;
    if (created.length)
      await tx`delete from catalogue_identifiers c where c.id in ${tx(created)}
        and not exists (select 1 from source_records s where s.identifier_id = c.id)`;
  });
  console.log(`Restored ${saved.houses.length} houses of run ${saved.runId}`);
  await sql.end();
  process.exit(0);
}

// Replaces a run's source records with identical ones whose payload_hash
// follows the sorted-key rule. Source records cannot be edited, only
// deleted and added; the houses are not touched. Dry run unless --apply.
if (values.rehash) {
  class Rollback extends Error {}
  let replaced = 0;
  let identifiers: string[] = [];
  try {
    await sql.begin(async (t) => {
      const tx = t as unknown as postgres.Sql;
      identifiers = await runIdentifiers(tx, values.rehash!);
      const rows = await tx<Record<string, unknown>[]>`select * from source_records
        where provider = 'wikidata' and payload->>'runId' = ${values.rehash!}
          and supersedes_id is null
          and not exists (select 1 from source_records n where n.supersedes_id = source_records.id)
        for update`;
      for (const r of rows) {
        const payload = r.payload as Record<string, unknown>;
        await tx`delete from source_records where id = ${r.id as string}`;
        await tx`insert into source_records (id, entity_kind, organization_id, identifier_id, provider, url,
            attribution, retrieved_at, verified_at, payload, payload_hash, review_status, locked, created_at)
          values (${r.id as string}, ${r.entity_kind as string}, ${r.organization_id as string},
            ${r.identifier_id as string}, ${r.provider as string}, ${r.url as string}, ${r.attribution as string},
            ${r.retrieved_at as Date}, ${r.verified_at as Date}, ${sql.json(payload as never)},
            ${sourcePayloadHash(payload)}, ${r.review_status as string}, ${r.locked as boolean},
            ${r.created_at as Date})`;
        replaced++;
      }
      // Every hash now matches its stored payload
      const stored = await tx<{ payload: Record<string, unknown>; payload_hash: string }[]>`
        select payload, payload_hash from source_records
        where provider = 'wikidata' and payload->>'runId' = ${values.rehash!}`;
      const wrong = stored.filter((s) => sourcePayloadHash(s.payload) !== s.payload_hash);
      if (wrong.length) throw new Error(`${wrong.length} hashes still do not match their payload`);
      if (!values.apply) throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  console.log(
    `${values.apply ? "Replaced" : "Would replace"} ${replaced} source records of run ${values.rehash}; every hash matches its payload.`,
  );
  // Keep the undo file precise: the identifiers this run created
  if (values.apply && existsSync(values["undo-file"]!)) {
    const saved: UndoFile = JSON.parse(readFileSync(values["undo-file"]!, "utf8"));
    if (saved.runId === values.rehash && !saved.identifiers) {
      writeFileSync(values["undo-file"]!, JSON.stringify({ ...saved, identifiers }, null, 2));
      console.log(`Undo file now lists the ${identifiers.length} identifiers the run created.`);
    }
  }
  await sql.end();
  process.exit(0);
}

// ── Evidence from the catalogue ─────────────────────────────────────────────
const houses = await sql<HouseEvidence[]>`
  select h.id, h.name, h.kind, h.country, h.country_id as "countryId", h.website, h.description,
    p.name as parent, g.name as grandparent,
    (select coalesce(json_agg(a.name order by a.name), '[]') from publisher_aliases a
      where a.publisher_id = h.id) as aliases,
    (select coalesce(json_agg(json_build_object('isbn', coalesce(e.isbn_13, e.isbn_10),
        'country', e.publication_country, 'year', e.publication_year,
        'direct', ep.publisher_id = h.id)), '[]')
      from edition_publishers ep join editions e on e.id = ep.edition_id
      where ep.publisher_id in (select publisher_family(h.id))) as editions
  from publishing_houses h
  left join publishing_houses p on p.id = h.parent_id
  left join publishing_houses g on g.id = p.parent_id
  where h.kind is not null
  order by h.name, h.id`;
const countries = await sql<{ id: string; name: string; alpha2: string }[]>`
  select id, name, alpha_2 as "alpha2" from countries`;
const lookup = countryLookup(countries);
const countryById = new Map(countries.map((c) => [c.id, c]));

// ── Research on Wikidata, cached ────────────────────────────────────────────
const cache: WikidataCache = existsSync(values.cache!)
  ? JSON.parse(readFileSync(values.cache!, "utf8"))
  : { search: {}, items: {} };
const save = () => writeFileSync(values.cache!, JSON.stringify(cache));
const candidates = new Map<string, string[]>();
let searched = 0;
for (const h of houses) {
  const found = new Set<string>();
  for (const text of searchTexts(h)) {
    for (const hit of await searchItems(text, cache)) found.add(hit.id);
    if (++searched % 10 === 0) {
      save();
      console.error(`[research] ${searched} searches`);
    }
  }
  candidates.set(h.id, [...found]);
}
save();
await getItems([...new Set([...candidates.values()].flat())], cache);
const allClasses = [
  ...new Set(
    [...candidates.values()]
      .flat()
      .flatMap((id) => cache.items[id]?.classes ?? []),
  ),
];
const publisherish = await publisherClasses(allClasses, PUBLISHER_ROOTS, cache);
// Labels and codes of the countries, places and parents the matches name
const linked = [...candidates.values()]
  .flat()
  .map((id) => cache.items[id])
  .filter((i) => i && i.classes.some((c) => publisherish.has(c)))
  .flatMap((i) => [...i!.countries, ...i!.headquarters, ...i!.parents]);
await getItems(linked, cache);
save();

// ── The plan ────────────────────────────────────────────────────────────────
// Reviewed items are read too, in case no search found them
await getItems(
  Object.values(ENRICHMENT_REVIEW).flatMap((r) => (r.accept ? [r.accept] : [])),
  cache,
);
const plans: HousePlan[] = houses.map((h) =>
  planHouse(h, {
    review: ENRICHMENT_REVIEW[h.name],
    candidates: [
      ...(candidates.get(h.id) ?? []),
      ...(() => {
        const r = ENRICHMENT_REVIEW[h.name];
        return r?.accept ? [r.accept] : [];
      })(),
    ]
      .map((id) => cache.items[id])
      .filter((i) => !!i),
    items: cache.items,
    publisherClasses: publisherish,
    countryLookup: lookup,
    alpha2Of: (id) => countryById.get(id)?.alpha2 ?? null,
  }),
);

// One Wikidata item belongs to one house: when several houses took the same
// item, the house whose name is the item's label keeps it
const byItem = new Map<string, number[]>();
plans.forEach((p, i) => {
  if (p.match) byItem.set(p.match.id, [...(byItem.get(p.match.id) ?? []), i]);
});
for (const [qid, idx] of byItem) {
  if (idx.length < 2) continue;
  const label = cache.items[qid]?.label ?? "";
  const keep = idx.find((i) => houses[i].name.toLowerCase() === label.toLowerCase());
  for (const i of idx) {
    if (i === keep) continue;
    plans[i] = {
      ...plans[i],
      match: null,
      fill: {},
      held: [`${label} (${qid}) fits ${idx.map((j) => houses[j].name).join(" and ")}; it stays with ${keep !== undefined ? houses[keep].name : "neither"}`],
    };
  }
}

// A Wikidata item another house already holds stays with that house
const planned = plans.flatMap((p) => (p.match ? [p.match.id] : []));
const held = planned.length
  ? await sql<{ qid: string; houseId: string; house: string }[]>`
      select c.external_id as qid, c.organization_id as "houseId", h.name as house
      from catalogue_identifiers c join publishing_houses h on h.id = c.organization_id
      where c.provider = 'wikidata' and c.entity_kind = 'organization'
        and c.external_id in ${sql(planned)}`
  : [];
for (const [i, p] of plans.entries()) {
  const owner = held.find((o) => o.qid === p.match?.id && o.houseId !== houses[i].id);
  if (owner)
    plans[i] = {
      ...p,
      match: null,
      fill: {},
      held: [`${p.match!.id} already belongs to ${owner.house}`],
    };
}

// Every link follows the country text (after any fill)
const runId = randomUUID();
const retrievedAt = new Date();
type Write = Saved & { name: string; plan: HousePlan; next: Saved };
const writes: Write[] = [];
for (const [i, h] of houses.entries()) {
  const plan = plans[i];
  const country = h.country ?? plan.fill.country ?? null;
  const next: Saved = {
    id: h.id,
    country,
    countryId: resolveCountry(country, lookup),
    website: h.website ?? plan.fill.website ?? null,
    description: h.description ?? plan.fill.description ?? null,
  };
  const before: Saved = {
    id: h.id,
    country: h.country,
    countryId: h.countryId,
    website: h.website,
    description: h.description,
  };
  if (JSON.stringify(next) !== JSON.stringify(before) || plan.match)
    writes.push({ ...before, name: h.name, plan, next });
}

class Rollback extends Error {}
const createdIdentifiers: string[] = [];
try {
  await sql.begin(async (t) => {
    const tx = t as unknown as postgres.Sql;
    for (const w of writes) {
      await tx`update publishing_houses set country = ${w.next.country}, country_id = ${w.next.countryId},
        website = ${w.next.website}, description = ${w.next.description}
        where id = ${w.id} and country is not distinct from ${w.country}
          and website is not distinct from ${w.website}
          and description is not distinct from ${w.description}`;
      const m = w.plan.match;
      if (!m) continue;
      const [created] = await tx<{ id: string }[]>`
        insert into catalogue_identifiers (entity_kind, organization_id, provider, external_id)
        values ('organization', ${w.id}, 'wikidata', ${m.id})
        on conflict (provider, entity_kind, external_id) do nothing
        returning id`;
      if (created) createdIdentifiers.push(created.id);
      const [identifier] = created
        ? [created]
        : await tx<{ id: string; organization_id: string }[]>`
            select id, organization_id from catalogue_identifiers
            where provider = 'wikidata' and entity_kind = 'organization' and external_id = ${m.id}`;
      if (!created && (identifier as { organization_id?: string }).organization_id !== w.id)
        throw new Error(`${m.id} belongs to another house, not ${w.name}`);
      const payload = { runId, ...m.facts, evidence: w.plan.evidence, confidence: m.confidence };
      await tx`insert into source_records (entity_kind, organization_id, identifier_id, provider, url,
          attribution, retrieved_at, verified_at, payload, payload_hash, review_status)
        values ('organization', ${w.id}, ${identifier.id}, 'wikidata',
          ${`https://www.wikidata.org/wiki/${m.id}`}, 'Wikidata (CC0)', ${retrievedAt}, ${retrievedAt},
          ${sql.json(payload)}, ${sourcePayloadHash(payload)},
          'accepted')`;
    }
    if (!values.apply) throw new Rollback();
  });
} catch (err) {
  if (!(err instanceof Rollback)) throw err;
}

// ── Report ──────────────────────────────────────────────────────────────────
const label = (id: string | null) =>
  id ? (countryById.get(id)?.name ?? id) : "none";
const count = (f: (p: HousePlan) => boolean) => plans.filter(f).length;
const out: string[] = [
  `# Publisher enrichment: ${values.apply ? "applied" : "dry run (rolled back)"}`,
  "",
  `Run \`${runId}\`, ${retrievedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. ${houses.length} publishing houses.`,
  "",
  "## Summary",
  "",
  `- Wikidata match: ${count((p) => p.match?.confidence === "high")} high, ${count((p) => p.match?.confidence === "medium")} medium; held for a person: ${count((p) => !p.match && p.held.length > 0)}; not found: ${count((p) => !p.match && p.held.length === 0)}.`,
  `- Filled: country ${count((p) => !!p.fill.country)}, website ${count((p) => !!p.fill.website)}, About ${count((p) => !!p.fill.description)}.`,
  `- Country links that change: ${writes.filter((w) => w.next.countryId !== w.countryId).length}.`,
  `- Houses with same-name items elsewhere, ruled out by country: ${count((p) => p.conflicts.length > 0)}.`,
  "",
  "## Matches",
  "",
  "| House | Wikidata | Confidence | Evidence | Filled |",
  "|---|---|---|---|---|",
  ...houses.flatMap((h, i) => {
    const p = plans[i];
    if (!p.match) return [];
    const filled = Object.entries(p.fill)
      .filter(([, v]) => v)
      .map(([k, v]) => (k === "description" ? "About" : `${k}: ${v}`))
      .join("; ");
    return [
      `| ${h.name} | [${p.match.facts.label}](https://www.wikidata.org/wiki/${p.match.id}) | ${p.match.confidence} | ${p.evidence.join("; ")} | ${filled || "nothing new"} |`,
    ];
  }),
  "",
  "## Country links",
  "",
  ...writes
    .filter((w) => w.next.countryId !== w.countryId)
    .map((w) => `- ${w.name} (“${w.next.country}”): ${label(w.countryId)} → ${label(w.next.countryId)}`),
  "",
  "## Same-name items ruled out by country (nothing changed)",
  "",
  ...houses.flatMap((h, i) => plans[i].conflicts.map((c) => `- ${h.name}: ${c}`)),
  "",
  "## Held for a person",
  "",
  ...houses.flatMap((h, i) =>
    plans[i].match ? [] : plans[i].held.map((c) => `- ${h.name}: ${c}`),
  ),
  "",
  "## About texts",
  "",
  ...houses.flatMap((h, i) =>
    plans[i].fill.description ? [`- **${h.name}**: ${plans[i].fill.description}`] : [],
  ),
  "",
];
writeFileSync(values.report!, out.join("\n"));
if (values.apply) {
  writeFileSync(
    values["undo-file"]!,
    JSON.stringify(
      {
        runId,
        houses: writes.map(({ id, country, countryId, website, description }) => ({ id, country, countryId, website, description })),
        identifiers: createdIdentifiers,
      } satisfies UndoFile,
      null,
      2,
    ),
  );
  console.log(`Applied run ${runId}. Old values: ${values["undo-file"]}`);
}
console.log(out.slice(0, out.indexOf("## Matches")).join("\n"));
console.log(`Report: ${values.report}`);
await sql.end();
process.exit(0);
