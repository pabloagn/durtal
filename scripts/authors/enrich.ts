/**
 * Author enrichment. Researches authors on Wikidata, checks each person
 * against what the catalogue knows (the author's books, dates, gender and
 * nationality), and fills only what is empty: dates, birth and death places,
 * gender, nationality, birth name, website, Open Library and Goodreads ids,
 * and an About text built from Wikidata facts. A year before Christ stored
 * without its minus sign is put right. Other values that disagree with
 * Wikidata are reported, never changed. The Wikidata id and the facts used
 * are kept as provenance (catalogue_identifiers, source_records).
 *
 * Photos, posters, backgrounds and every other image are never read or
 * written: the run writes only AUTHOR_FILL_COLUMNS, new places and provenance.
 *
 * Dry run by default: the whole run happens in one transaction that is rolled
 * back, and the plan is written to --report. `--apply` commits and writes the
 * old values, and the identifiers and places it created, to --undo-file;
 * `--undo FILE` puts them back.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/authors/enrich.ts \
 *     [--apply] [--undo FILE] [--scope books|canon|all] [--report FILE] [--cache FILE]
 *     [--undo-file FILE] [--env-dir DIR] [--pace MS] [--only SLUG,SLUG]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import postgres from "postgres";
import { setWikidataPace } from "@/lib/wikidata/api";
import { fetchWithTimeout } from "@/lib/api/external-fetch";
import {
  emptyAuthorCache,
  getLabels,
  getPeople,
  getPlaces,
  reconcileHumans,
  worksByMany,
  type AuthorWikidataCache,
} from "@/lib/authors/wikidata";
import {
  AUTHOR_FILL_COLUMNS,
  AUTHOR_NAME_COLUMNS,
  isWriter,
  matchedWorks,
  nameForms,
  nameRank,
  nextAuthorRow,
  placeChain,
  planAuthor,
  type AuthorEvidence,
  type AuthorNameColumn,
  type AuthorPlan,
  type AuthorRow,
  type PlanContext,
} from "@/lib/authors/enrichment";
import { AUTHOR_REVIEW } from "@/lib/authors/enrichment-review";
import { sourcePayloadHash } from "@/lib/publishers/enrichment";
import { sanitizeDescriptionHtml } from "@/lib/utils/sanitize";
import { normalizeSearchText } from "@/lib/utils/search-text";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    undo: { type: "string" },
    scope: { type: "string", default: "books" },
    report: { type: "string", default: "author-enrichment.md" },
    cache: { type: "string", default: "author-wikidata.json" },
    "undo-file": { type: "string", default: "author-enrichment-undo.json" },
    "env-dir": { type: "string", default: process.cwd() },
    pace: { type: "string", default: "2500" },
    /** Comma-separated author slugs, to try the rules on a few */
    only: { type: "string" },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1, onnotice: () => {} });

type Saved = AuthorRow & { id: string } & Partial<Record<AuthorNameColumn, string | null>>;
type UndoFile = {
  runId: string;
  authors: Saved[];
  /** Identifiers and places this run created; undo removes these and no others */
  identifiers: string[];
  places: string[];
};

const COLUMNS = [...AUTHOR_FILL_COLUMNS];

if (values.undo) {
  const saved: UndoFile = JSON.parse(readFileSync(values.undo, "utf8"));
  await sql.begin(async (t) => {
    const tx = t as unknown as postgres.Sql;
    for (const { id, ...row } of saved.authors)
      await tx`update authors set ${tx(row as AuthorRow, Object.keys(row) as (keyof AuthorRow)[])} where id = ${id}`;
    await tx`delete from source_records where provider = 'wikidata' and entity_kind = 'person'
      and payload->>'runId' = ${saved.runId}`;
    if (saved.identifiers.length)
      await tx`delete from catalogue_identifiers c where c.id in ${tx(saved.identifiers)}
        and not exists (select 1 from source_records s where s.identifier_id = c.id)`;
    // Places the run created, the most specific first, while nothing else uses them
    for (const id of [...saved.places].reverse())
      await tx`delete from places p where p.id = ${id}
        and not exists (select 1 from authors a where a.birth_place_id = p.id or a.death_place_id = p.id)
        and not exists (select 1 from places c where c.parent_id = p.id)
        and not exists (select 1 from venues v where v.place_id = p.id)
        and not exists (select 1 from orders o where o.origin_place_id = p.id)`;
  });
  console.log(`Restored ${saved.authors.length} authors of run ${saved.runId}`);
  await sql.end();
  process.exit(0);
}

// ── Evidence from the catalogue ─────────────────────────────────────────────
type Loaded = AuthorRow & {
  id: string;
  slug: string | null;
  name: string;
  sortName: string | null;
  firstName: string | null;
  lastName: string | null;
  /** As text, to the microsecond: the lock against edits made during the run */
  updatedAt: string;
  nationality: string | null;
  aliases: string[];
  works: { title: string; year: number | null }[];
  roles: string[];
};
const only = values.only ? values.only.split(",").map((s) => s.trim()) : null;
const authors = await sql<Loaded[]>`
  select a.id, a.slug, a.name, a.sort_name as "sortName", a.first_name as "firstName",
    a.last_name as "lastName", a.updated_at::text as "updatedAt", upper(c.alpha_2) as nationality,
    a.birth_year, a.birth_month, a.birth_day, a.birth_year_is_approximate, a.birth_year_gregorian,
    a.death_year, a.death_month, a.death_day, a.death_year_is_approximate, a.death_year_gregorian,
    a.zodiac_sign, a.gender::text as gender, a.nationality_id, a.birth_place_id, a.death_place_id,
    a.real_name, a.website, a.open_library_key, a.goodreads_id, a.bio,
    (select coalesce(json_agg(pa.name order by pa.name), '[]') from person_aliases pa
      where pa.person_id = a.id) as aliases,
    (select coalesce(json_agg(json_build_object('title', w.title, 'year', w.original_year)
        order by w.title), '[]')
      from work_authors wa join works w on w.id = wa.work_id where wa.author_id = a.id) as works,
    (select coalesce(json_agg(ct.name order by ct.name), '[]') from author_contribution_types act
      join contribution_types ct on ct.id = act.contribution_type_id where act.author_id = a.id) as roles
  from authors a left join countries c on c.id = a.nationality_id
  where ${
    values.scope === "all"
      ? sql`true`
      : values.scope === "canon"
        ? sql`not exists (select 1 from work_authors wa where wa.author_id = a.id)`
        : sql`exists (select 1 from work_authors wa where wa.author_id = a.id)`
  }
    and ${only ? sql`a.slug in ${sql(only)}` : sql`true`}
  order by a.name, a.id`;
const countries = await sql<{ id: string; alpha2: string; name: string }[]>`
  select id, upper(alpha_2) as alpha2, name from countries where alpha_2 is not null`;
const countryByAlpha2 = new Map(countries.map((c) => [c.alpha2, c]));

const evidence = (r: Loaded): AuthorEvidence => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  sortName: r.sortName,
  firstName: r.firstName,
  lastName: r.lastName,
  realName: r.real_name as string | null,
  aliases: r.aliases,
  gender: (r.gender as "male" | "female" | null) ?? null,
  nationality: r.nationality,
  birth: {
    year: r.birth_year as number | null,
    month: r.birth_month as number | null,
    day: r.birth_day as number | null,
    approximate: !!r.birth_year_is_approximate,
    gregorian: r.birth_year_gregorian as number | null,
  },
  death: {
    year: r.death_year as number | null,
    month: r.death_month as number | null,
    day: r.death_day as number | null,
    approximate: !!r.death_year_is_approximate,
    gregorian: r.death_year_gregorian as number | null,
  },
  birthPlaceId: r.birth_place_id as string | null,
  deathPlaceId: r.death_place_id as string | null,
  bio: r.bio as string | null,
  website: r.website as string | null,
  openLibraryKey: r.open_library_key as string | null,
  goodreadsId: r.goodreads_id as string | null,
  zodiacSign: r.zodiac_sign as string | null,
  works: r.works,
  roles: r.roles,
});
const people = authors.map(evidence);

// ── Research on Wikidata, cached ────────────────────────────────────────────
setWikidataPace(Number(values.pace));
const saved: Partial<AuthorWikidataCache> = existsSync(values.cache!)
  ? JSON.parse(readFileSync(values.cache!, "utf8"))
  : { version: 2 };
const cache: AuthorWikidataCache = { ...emptyAuthorCache(), ...saved, version: saved.version ?? 1 };
const save = () => writeFileSync(values.cache!, JSON.stringify(cache));
// Items read before names in "mul" were read lost those names: read them again
if ((cache.version ?? 1) < 2) {
  for (const store of [cache.people, cache.places, cache.labels] as Record<string, { label: string | null } | null>[])
    for (const [id, item] of Object.entries(store)) if (!item?.label) delete store[id];
  cache.version = 2;
}

// 1. Search: every form of every name, 20 names per call to the
// reconciliation service; answers an earlier run kept are used too
const formsOf = new Map(people.map((a) => [a.id, nameForms(a).slice(0, 3)]));
await reconcileHumans([...new Set([...formsOf.values()].flat())], cache);
save();
const found = new Map<string, Set<string>>();
for (const a of people) {
  const forms = formsOf.get(a.id)!;
  const hits = new Map<string, number>();
  for (const form of forms) {
    for (const h of cache.reconcile[form] ?? [])
      if (h.score >= 80 || (h.score >= 50 && nameRank(forms, h.name, []) >= 1))
        hits.set(h.id, Math.max(hits.get(h.id) ?? 0, h.score));
    for (const h of cache.search[form.trim().toLowerCase()] ?? [])
      if (nameRank(forms, h.label, h.matched ? [h.matched] : []) >= 1) hits.set(h.id, hits.get(h.id) ?? 50);
    for (const h of cache.humans[`${form} haswbstatement:P31=Q5`] ?? [])
      if (nameRank(forms, h.label, h.aliases) >= 1) hits.set(h.id, hits.get(h.id) ?? 50);
  }
  const ids = new Set(
    [...hits].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([id]) => id),
  );
  const reviewed = a.slug ? AUTHOR_REVIEW[a.slug] : undefined;
  if (reviewed?.accept) ids.add(reviewed.accept);
  found.set(a.id, ids);
}

// 2. The people found, their countries and places, and their notable works
const allFound = [...new Set([...found.values()].flatMap((s) => [...s]))];
await getPeople(allFound, cache);
save();
const humans = allFound.filter((id) => cache.people[id]?.classes.includes("Q5"));
const person = (id: string) => cache.people[id]!;
await getPlaces(
  humans.flatMap((id) => [...person(id).citizenships, ...person(id).birthPlaces, ...person(id).deathPlaces]),
  cache,
);
await getPlaces(
  humans.flatMap((id) => [...person(id).birthPlaces, ...person(id).deathPlaces])
    .flatMap((p) => cache.places[p]?.countries ?? []),
  cache,
);
// Notable works (evidence and About texts) and occupations (roles)
await getLabels(humans.flatMap((id) => [...person(id).notableWorks, ...person(id).occupations]), cache);
save();

// 3. Their works, 80 people per query, unless a notable work already names
// one of the author's books
const needWorks: string[] = [];
for (const a of people) {
  // An author without books gains nothing from a works list
  if (!a.works.length) continue;
  const forms = formsOf.get(a.id)!;
  // The best names first; among equal names, writers first
  const ranked = [...(found.get(a.id) ?? [])]
    .filter((id) => cache.people[id]?.classes.includes("Q5"))
    .map((id) => ({
      id,
      rank: nameRank(forms, person(id).label, person(id).aliases),
      writer: isWriter(person(id)) ? 1 : 0,
    }))
    .filter((c) => c.rank >= 1)
    .sort((x, y) => y.rank - x.rank || y.writer - x.writer)
    .filter((c, i, all) => i < 5 && c.rank >= Math.min(2, all[0].rank));
  for (const { id } of ranked) {
    const notable = person(id).notableWorks.map((w) => cache.labels[w] ?? null);
    if (!matchedWorks(a.works, [], notable).length) needWorks.push(id);
  }
}
console.error(`[research] works of ${new Set(needWorks).size} people`);
await worksByMany(needWorks, cache);
save();

// ── The plan ────────────────────────────────────────────────────────────────
const context = (a: AuthorEvidence): PlanContext => ({
  people: cache.people,
  places: cache.places,
  labels: cache.labels,
  works: cache.works,
  candidates: [...(found.get(a.id) ?? [])],
  review: a.slug ? AUTHOR_REVIEW[a.slug] : undefined,
});
let plans: AuthorPlan[] = people.map((a) => planAuthor(a, context(a)));

// 4. For the matches: movements, notable works, and the places' paths to their countries
const matched = plans.flatMap((p) => (p.match ? [person(p.match.id)] : []));
await getLabels(matched.flatMap((p) => [...p.notableWorks, ...p.movements]), cache);
let frontier = matched.flatMap((p) => [...p.birthPlaces, ...p.deathPlaces]);
const visited = new Set<string>();
for (let step = 0; step < 8 && frontier.length; step++) {
  frontier.forEach((id) => visited.add(id));
  await getPlaces(frontier, cache);
  frontier = [
    ...new Set(
      frontier.flatMap((id) => [
        ...(cache.places[id]?.within.slice(0, 1) ?? []),
        ...(cache.places[id]?.countries ?? []),
      ]),
    ),
  ].filter((id) => !visited.has(id));
}
save();
plans = people.map((a) => planAuthor(a, context(a)));

// 5. Official websites: one that no longer answers is not filled. A site
// that refuses robots (401, 403, 405, 429) still exists
cache.sites ??= {};
const sites = cache.sites;
const toCheck = [
  ...new Set(plans.flatMap((p) => (p.fill.website ? [p.fill.website] : []))),
].filter((u) => !(u in sites));
const checkSite = async (site: string) => {
  try {
    const res = await fetchWithTimeout(site, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (Durtal link check)" } }, 10000);
    sites[site] = res.status;
    await res.body?.cancel();
  } catch {
    sites[site] = 0;
  }
};
for (let i = 0; i < toCheck.length; i += 8) await Promise.all(toCheck.slice(i, i + 8).map(checkSite));
save();
const live = (status: number) => (status > 0 && status < 400) || [401, 403, 405, 429].includes(status);
for (const p of plans)
  if (p.fill.website && !live(sites[p.fill.website] ?? 0)) {
    p.notes.push(`website ${p.fill.website} did not answer (${sites[p.fill.website] || "no answer"}); not filled`);
    delete p.fill.website;
  }

// One Wikidata person belongs to one author: two authors that took the same
// person may be one author twice; both are held for a merge by hand
const byPerson = new Map<string, number[]>();
plans.forEach((p, i) => {
  if (p.match) byPerson.set(p.match.id, [...(byPerson.get(p.match.id) ?? []), i]);
});
for (const [qid, idx] of byPerson) {
  if (idx.length < 2) continue;
  for (const i of idx)
    plans[i] = {
      ...plans[i],
      match: null,
      fill: {},
      correct: {},
      corrections: [],
      held: [`${qid} fits ${idx.map((j) => `“${people[j].name}”`).join(" and ")}: possibly one author twice; merge them by hand`],
    };
}
// A person another author already holds stays with that author
const planned = plans.flatMap((p) => (p.match ? [p.match.id] : []));
const owned = planned.length
  ? await sql<{ qid: string; personId: string; name: string }[]>`
      select c.external_id as qid, c.person_id as "personId", a.name
      from catalogue_identifiers c join authors a on a.id = c.person_id
      where c.provider = 'wikidata' and c.entity_kind = 'person' and c.external_id in ${sql(planned)}`
  : [];
for (const [i, p] of plans.entries()) {
  const owner = owned.find((o) => o.qid === p.match?.id && o.personId !== people[i].id);
  if (owner)
    plans[i] = {
      ...p,
      match: null,
      fill: {},
      correct: {},
      corrections: [],
      held: [`${p.match!.id} already belongs to ${owner.name}: possibly one author twice`],
    };
}

// Other records that may be the same person: an author whose name is the
// person's Wikidata name. They are merged by hand, in the app
const twins = new Map<number, { name: string; slug: string | null; books: number }[]>();
{
  const matches = plans.flatMap((p, i) => (p.match?.label ? [{ i, label: p.match.label }] : []));
  const found = matches.length
    ? await sql<{ id: string; name: string; slug: string | null; books: number; key: string }[]>`
        select a.id, a.name, a.slug, search_normalize(a.name) as key,
          (select count(*)::int from work_authors wa where wa.author_id = a.id) as books
        from authors a
        where search_normalize(a.name) in ${sql([...new Set(matches.map((m) => normalizeSearchText(m.label)))])}`
    : [];
  for (const { i, label } of matches) {
    const same = found.filter((f) => f.key === normalizeSearchText(label) && f.id !== people[i].id);
    if (same.length) twins.set(i, same);
  }
}

// ── Writes, in one transaction ──────────────────────────────────────────────
const runId = randomUUID();
const retrievedAt = new Date();
type Write = { a: AuthorEvidence; loaded: Loaded; plan: AuthorPlan; before: Saved; next: Saved };
const writes: Write[] = [];
const skipped: string[] = [];
const createdIdentifiers: string[] = [];
const createdPlaces: string[] = [];
const newPlaces: string[] = [];

/** The row for a place, found by its Wikidata id, then by name, type and parent, or made */
async function placeRow(tx: postgres.Sql, qid: string): Promise<string | null> {
  const chain = placeChain(qid, cache.places);
  if (!chain) return null;
  let parentId: string | null = null;
  const names: string[] = [];
  for (const level of chain.levels) {
    names.unshift(level.name);
    const p = cache.places[level.qid]!;
    const [byId] = await tx<{ id: string }[]>`select id from places where wikidata_id = ${level.qid} limit 1`;
    const [byName]: { id: string }[] = byId
      ? [byId]
      : await tx<{ id: string }[]>`select id from places where lower(name) = lower(${level.name})
          and type = ${level.type} and parent_id is not distinct from ${parentId} limit 1`;
    if (byName) {
      parentId = byName.id;
      continue;
    }
    const countryId = chain.alpha2 ? (countryByAlpha2.get(chain.alpha2)?.id ?? null) : null;
    const [made]: { id: string }[] = await tx<{ id: string }[]>`
      insert into places (name, full_name, type, parent_id, country_id, latitude, longitude, wikidata_id)
      values (${level.name}, ${names.join(", ")}, ${level.type}, ${parentId}, ${countryId},
        ${p.coordinates?.latitude ?? null}, ${p.coordinates?.longitude ?? null}, ${level.qid})
      returning id`;
    createdPlaces.push(made.id);
    newPlaces.push(names.join(", "));
    parentId = made.id;
  }
  return parentId;
}

class Rollback extends Error {}
try {
  await sql.begin(async (t) => {
    const tx = t as unknown as postgres.Sql;
    for (const [i, a] of people.entries()) {
      const plan = plans[i];
      const renamed = a.slug ? AUTHOR_REVIEW[a.slug]?.rename : undefined;
      if (!plan.match && !renamed) continue;
      const loaded = authors[i];
      const before = Object.fromEntries([
        ["id", a.id],
        ...COLUMNS.map((col) => [col, loaded[col] ?? null]),
      ]) as Saved;
      const nationalityId = plan.fill.nationality
        ? (countryByAlpha2.get(plan.fill.nationality)?.id ?? null)
        : null;
      const birthPlaceId = plan.fill.birthPlace ? await placeRow(tx, plan.fill.birthPlace) : null;
      const deathPlaceId = plan.fill.deathPlace ? await placeRow(tx, plan.fill.deathPlace) : null;
      const bio = plan.fill.bio ? sanitizeDescriptionHtml(plan.fill.bio) : null;
      const correctNationality = plan.correct.nationality
        ? countryByAlpha2.get(plan.correct.nationality)?.id
        : undefined;
      if (plan.correct.nationality && !correctNationality)
        throw new Error(`${a.name}: no country ${plan.correct.nationality}`);
      const next = {
        id: a.id,
        ...nextAuthorRow(
          before,
          plan.fill,
          { nationalityId, birthPlaceId, deathPlaceId, bio },
          { birth: plan.correct.birth, death: plan.correct.death, nationalityId: correctNationality },
        ),
      } as Saved;
      // A reviewed rename: the name columns it names, kept for undo
      const rename = renamed;
      const current: Record<AuthorNameColumn, string | null> = {
        sort_name: loaded.sortName,
        first_name: loaded.firstName,
        last_name: loaded.lastName,
      };
      for (const col of AUTHOR_NAME_COLUMNS)
        if (rename?.[col] !== undefined && rename[col] !== current[col]) {
          before[col] = current[col];
          next[col] = rename[col];
        }
      const changed = ([...COLUMNS, ...AUTHOR_NAME_COLUMNS] as (keyof Saved)[]).filter(
        (col) => col in next && next[col] !== before[col],
      );
      if (changed.length) {
        // Nothing is written over an edit made since the run read the author
        const done = await tx`update authors set ${tx(next as AuthorRow, changed as (keyof AuthorRow)[])}
          where id = ${a.id} and updated_at::text = ${loaded.updatedAt}`;
        if (!done.count) {
          skipped.push(`${a.name}: edited during the run; nothing written`);
          continue;
        }
      }
      writes.push({ a, loaded, plan, before, next });
      if (!plan.match) continue;

      const qid = plan.match.id;
      const [created] = await tx<{ id: string }[]>`
        insert into catalogue_identifiers (entity_kind, person_id, provider, external_id)
        values ('person', ${a.id}, 'wikidata', ${qid})
        on conflict (provider, entity_kind, external_id) do nothing
        returning id`;
      if (created) createdIdentifiers.push(created.id);
      const [identifier] = created
        ? [{ ...created, person_id: a.id }]
        : await tx<{ id: string; person_id: string }[]>`
            select id, person_id from catalogue_identifiers
            where provider = 'wikidata' and entity_kind = 'person' and external_id = ${qid}`;
      if (identifier.person_id !== a.id) throw new Error(`${qid} belongs to another author, not ${a.name}`);
      const chosen = plan.candidates.find((c) => c.id === qid);
      const payload = {
        runId,
        qid,
        label: plan.match.label,
        description: cache.people[qid]?.description ?? null,
        confidence: plan.match.confidence,
        evidence: chosen?.evidence ?? [],
        filled: Object.fromEntries(changed.map((col) => [col, next[col]])),
        corrections: plan.corrections,
      };
      await tx`insert into source_records (entity_kind, person_id, identifier_id, provider, url,
          attribution, retrieved_at, verified_at, payload, payload_hash, review_status)
        values ('person', ${a.id}, ${identifier.id}, 'wikidata', ${`https://www.wikidata.org/wiki/${qid}`},
          'Wikidata (CC0)', ${retrievedAt}, ${retrievedAt}, ${sql.json(payload)},
          ${sourcePayloadHash(payload)}, 'accepted')`;
    }
    if (!values.apply) throw new Rollback();
  });
} catch (err) {
  if (!(err instanceof Rollback)) throw err;
}

// ── Report ──────────────────────────────────────────────────────────────────
const LABEL: Record<string, string> = {
  birth_year: "born", birth_month: "birth month", birth_day: "birth day",
  birth_year_is_approximate: "born circa", birth_year_gregorian: "birth year (Gregorian)",
  death_year: "died", death_month: "death month", death_day: "death day",
  death_year_is_approximate: "died circa", death_year_gregorian: "death year (Gregorian)",
  zodiac_sign: "zodiac", gender: "gender", nationality_id: "nationality",
  birth_place_id: "birthplace", death_place_id: "place of death", real_name: "birth name",
  website: "website", open_library_key: "Open Library", goodreads_id: "Goodreads", bio: "About",
};
const show = (w: Write, col: string) => {
  const v = w.next[col as keyof Saved];
  if (col === "nationality_id") return `nationality ${w.plan.fill.nationality}`;
  if (col === "birth_place_id" || col === "death_place_id")
    return `${LABEL[col]} ${cache.places[col === "birth_place_id" ? w.plan.fill.birthPlace! : w.plan.fill.deathPlace!]?.label}`;
  if (col === "bio") return "About";
  return `${LABEL[col]} ${v}`;
};
const count = (f: (p: AuthorPlan) => boolean) => plans.filter(f).length;
const filled = (col: string) => writes.filter((w) => w.next[col as keyof Saved] !== w.before[col as keyof Saved]).length;
const link = (id: string, label: string | null) => `[${label ?? id}](https://www.wikidata.org/wiki/${id})`;
const out: string[] = [
  `# Author enrichment: ${values.apply ? "applied" : "dry run (rolled back)"}`,
  "",
  `Run \`${runId}\`, ${retrievedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. ${people.length} authors (${values.scope === "all" ? "all" : values.scope === "canon" ? "without books" : "with books"}).`,
  "",
  "## Summary",
  "",
  `- Wikidata match: ${count((p) => p.match?.confidence === "high")} high, ${count((p) => p.match?.confidence === "medium")} medium, ${count((p) => p.match?.confidence === "reviewed")} reviewed; held for a person: ${count((p) => !p.match && p.held.length > 0)}; not found: ${count((p) => !p.match && p.held.length === 0)}.`,
  `- Filled: ${COLUMNS.map((c) => `${LABEL[c]} ${filled(c)}`).join(", ")}.`,
  `- New places: ${newPlaces.length}. Corrections: ${writes.reduce((n, w) => n + w.plan.corrections.length, 0)}. Skipped (edited during the run): ${skipped.length}.`,
  "",
  "## Corrections",
  "",
  ...writes.flatMap((w) => w.plan.corrections.map((c) => `- ${w.a.name}: ${c}`)),
  "",
  "## Values that disagree with Wikidata (not changed)",
  "",
  ...writes.flatMap((w) => w.plan.match ? w.plan.disagreements.map((d) => `- ${w.a.name} (${link(w.plan.match!.id, w.plan.match!.label)}): ${d}`) : []),
  "",
  "## Possible duplicates (merge in the app)",
  "",
  ...people.flatMap((a, i) =>
    (twins.get(i) ?? []).map(
      (t) => `- ${a.name} (${a.slug}, ${a.works.length} books) and ${t.name} (${t.slug}, ${t.books} books) are both ${link(plans[i].match!.id, plans[i].match!.label)}`,
    ),
  ),
  ...people.flatMap((a, i) =>
    /^the same person as|already belongs to|possibly one author twice/.test(plans[i].held[0] ?? "")
      ? [`- ${a.name} (${a.slug}): ${plans[i].held[0]}`]
      : [],
  ),
  "",
  "## Names put right (reviewed)",
  "",
  ...writes.flatMap((w) => {
    const cols = AUTHOR_NAME_COLUMNS.filter((c) => c in w.next && w.next[c] !== w.before[c]);
    return cols.length
      ? [`- ${w.a.name}: ${cols.map((c) => `${c} “${w.before[c] ?? ""}” → “${w.next[c]}”`).join("; ")} (${AUTHOR_REVIEW[w.a.slug!]?.note})`]
      : [];
  }),
  "",
  "## Matches",
  "",
  "| Author | Wikidata | Confidence | Evidence | Filled |",
  "|---|---|---|---|---|",
  ...writes.filter((w) => w.plan.match).map((w) => {
    const chosen = w.plan.candidates.find((c) => c.id === w.plan.match!.id);
    const changed = COLUMNS.filter((c) => w.next[c] !== w.before[c]);
    return `| ${w.a.name} | ${link(w.plan.match!.id, w.plan.match!.label)} — ${cache.people[w.plan.match!.id]?.description ?? ""} | ${w.plan.match!.confidence}${chosen ? ` (name ${chosen.rank})` : ""} | ${chosen?.evidence.join("; ") ?? ""} | ${changed.map((c) => show(w, c)).join("; ") || "nothing new"} |`;
  }),
  "",
  "## Held for a person",
  "",
  ...people.flatMap((a, i) =>
    plans[i].match || !plans[i].held.length
      ? []
      : [
          `- **${a.name}** (${a.slug}; ${a.works.length ? a.works.map((w) => w.title).slice(0, 3).join("; ") : `no books; ${a.roles.join(", ") || "no roles"}`}${a.birth.year !== null ? `; born ${a.birth.year}` : ""}${a.nationality ? `; ${a.nationality}` : ""})`,
          ...plans[i].held.slice(0, 6).map((h) => `  - ${h}`),
          ...(plans[i].held.length > 6 ? [`  - and ${plans[i].held.length - 6} more without evidence`] : []),
        ],
  ),
  "",
  "## Not found",
  "",
  ...people.flatMap((a, i) =>
    plans[i].match || plans[i].held.length
      ? []
      : [`- ${a.name} (${a.slug}; ${a.works.length ? a.works.map((w) => w.title).slice(0, 2).join("; ") : a.roles.join(", ") || "no roles"})`],
  ),
  "",
  "## Ruled out",
  "",
  ...people.flatMap((a, i) =>
    plans[i].candidates
      .filter((c) => c.level === "excluded" && c.rank >= 3 && !c.hard.includes("not a person on Wikidata"))
      .map((c) => `- ${a.name}: ${link(c.id, c.label)} (${c.description ?? ""}): ${c.hard.join("; ")}`),
  ),
  "",
  "## Notes",
  "",
  ...writes.flatMap((w) => w.plan.notes.map((n) => `- ${w.a.name}: ${n}`)),
  ...skipped.map((s) => `- ${s}`),
  "",
  "## New places",
  "",
  ...newPlaces.map((p) => `- ${p}`),
  "",
  "## About texts",
  "",
  ...writes.flatMap((w) => (w.next.bio !== w.before.bio ? [`- **${w.a.name}**: ${w.next.bio}`] : [])),
  "",
];
writeFileSync(values.report!, out.join("\n"));
if (values.apply) {
  writeFileSync(
    values["undo-file"]!,
    JSON.stringify(
      {
        runId,
        authors: writes.map((w) => w.before),
        identifiers: createdIdentifiers,
        places: createdPlaces,
      } satisfies UndoFile,
      null,
      2,
    ),
  );
  console.log(`Applied run ${runId}. Old values: ${values["undo-file"]}`);
} else {
  console.log(`Dry run ${runId} rolled back. Plan: ${values.report}`);
}
await sql.end();
