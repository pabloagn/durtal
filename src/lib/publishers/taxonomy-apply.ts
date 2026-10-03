/**
 * Apply the publishing house taxonomy (task 0179) inside one transaction:
 * houses, types and parents, aliases, ISBN rules, names that are not
 * publishers, and the imprint and country of each edition from a second
 * source. Links are recomputed once at the end. The caller commits, or rolls
 * back for a dry run; the returned report is the same either way.
 *
 * Server-only. Uses a postgres.js transaction (scripts and tests), not the
 * app's HTTP driver.
 */
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  isbnPrefix,
  publisherLooseKeys,
  publisherSlug,
} from "@/lib/publishers/names";
import {
  NOT_PUBLISHERS,
  TAXONOMY,
  flattenTaxonomy,
  planEdition,
  prefixDigits,
  type EvidencePlan,
  type FlatHouse,
  type HouseSpec,
} from "@/lib/publishers/taxonomy";

// postgres.js types a transaction handle without its call signature
type Tx = postgres.Sql;
type AnyTx = postgres.Sql | postgres.TransactionSql;

export interface TaxonomyEdition {
  id: string;
  title: string;
  publisher: string | null;
  imprint: string | null;
  isbn13: string | null;
  isbn10: string | null;
  country: string | null;
  confirmed: boolean;
}

/** What Open Library says about one ISBN */
export interface SourceRecord {
  publishers: string[];
  series: string[];
  places: string[];
}

export interface HouseChange {
  path: string[];
  kind: string;
  action: "create" | "update" | "keep" | "skip";
  changes: string[];
  note?: string;
}

export interface TaxonomyReport {
  runId: string;
  houses: HouseChange[];
  aliases: { name: string; house: string; movedFrom: string[] }[];
  rules: { prefix: string; house: string; replaced: string | null }[];
  notPublishers: string[];
  enrichments: {
    editionId: string;
    title: string;
    field: "imprint" | "publication_country";
    oldValue: string | null;
    newValue: string;
    evidence: string;
  }[];
  refused: { title: string; reason: string }[];
  /** The book names one imprint, Open Library another: left for a person */
  disagreements: { title: string; printed: string; source: string }[];
  links: {
    editionId: string;
    title: string;
    before: string[];
    after: string[];
  }[];
  totals: {
    editions: number;
    linkedBefore: number;
    linkedAfter: number;
    byKindAfter: Record<string, number>;
  };
  warnings: string[];
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** 13 ISBN digits, or 978 + an ISBN-10's first nine; the key of source records */
export function isbnDigits(isbn13: string | null, isbn10: string | null) {
  const a = isbn13?.replace(/[^0-9]/g, "");
  if (a && /^97[89]\d{10}$/.test(a)) return a;
  const b = isbn10?.replace(/[^0-9Xx]/g, "");
  if (b && /^\d{9}[\dXx]$/.test(b)) return `978${b.slice(0, 9)}`;
  return null;
}

async function linksByEdition(tx: Tx) {
  const rows = await tx<{ edition_id: string; name: string; kind: string }[]>`
    select ep.edition_id, h.name, h.kind from edition_publishers ep
    join publishing_houses h on h.id = ep.publisher_id order by h.name`;
  const map = new Map<string, { name: string; kind: string }[]>();
  for (const r of rows)
    map.set(r.edition_id, [...(map.get(r.edition_id) ?? []), r]);
  return map;
}

export async function applyTaxonomy(
  handle: AnyTx,
  input: {
    editions: TaxonomyEdition[];
    sources: Map<string, SourceRecord>;
    spec?: HouseSpec[];
    runId?: string;
  },
): Promise<TaxonomyReport> {
  const tx = handle as Tx;
  const spec = input.spec ?? TAXONOMY;
  const flat = flattenTaxonomy(spec);
  const runId = input.runId ?? randomUUID();
  const report: TaxonomyReport = {
    runId,
    houses: [],
    aliases: [],
    rules: [],
    notPublishers: [],
    enrichments: [],
    refused: [],
    disagreements: [],
    links: [],
    totals: {
      editions: input.editions.length,
      linkedBefore: 0,
      linkedAfter: 0,
      byKindAfter: {},
    },
    warnings: [],
  };
  // Recompute links once, at the end
  await tx`select set_config('durtal.defer_publisher_refresh', 'on', true)`;
  const before = await linksByEdition(tx);

  // Evidence for each edition with an ISBN and a source record
  const plans = new Map<string, EvidencePlan>();
  for (const e of input.editions) {
    const isbn = isbnDigits(e.isbn13, e.isbn10);
    const source = isbn ? input.sources.get(isbn) : undefined;
    const plan = planEdition(
      {
        isbn,
        prefix: isbnPrefix(e.isbn13 ?? e.isbn10)?.label ?? null,
        publishers: source?.publishers ?? [],
        series: source?.series ?? [],
        places: source?.places ?? [],
      },
      flat,
    );
    plans.set(e.id, plan);
    if (plan.refused && !e.confirmed)
      report.refused.push({ title: e.title, reason: plan.refused });
  }

  // Which spec house each spelling names (two for same-name houses)
  const owners = new Map<string, FlatHouse[]>();
  for (const h of flat)
    for (const n of [h.spec.name, ...(h.spec.aliases ?? [])])
      owners.set(key(n), [...(owners.get(key(n)) ?? []), h]);
  const rawNames = input.editions.flatMap((e) =>
    [e.publisher, e.imprint].filter((n): n is string => !!n?.trim()).map(key),
  );
  const used = new Set<string>([
    ...[...plans.values()].flatMap((p) => (p.house ? [p.house.spec.name] : [])),
    ...rawNames.flatMap((k) => (owners.get(k) ?? []).map((h) => h.spec.name)),
  ]);

  // Houses, parents first
  type HouseRow = {
    id: string;
    name: string;
    kind: string;
    parent_id: string | null;
    country: string | null;
  };
  const houses: HouseRow[] = [
    ...(await tx<
      HouseRow[]
    // Organizations without a book publishing profile (museums, perfume
    // houses) are never matched or turned into publishers by name.
    >`select id, name, kind, parent_id, country from publishing_houses where kind is not null`),
  ];
  const byKey = new Map<string, HouseRow[]>();
  for (const h of houses)
    byKey.set(key(h.name), [...(byKey.get(key(h.name)) ?? []), h]);
  const nameById = new Map(houses.map((h) => [h.id, h.name]));
  const idOf = new Map<string, string>();
  for (const f of flat) {
    const s = f.spec;
    const parentId = f.parent ? (idOf.get(f.parent) ?? null) : null;
    if (f.parent && !parentId) {
      report.houses.push({
        path: f.path,
        kind: s.kind,
        action: "skip",
        changes: ["parent not created"],
      });
      continue;
    }
    let existing: HouseRow | undefined;
    for (const n of [...(s.existing ?? []), s.name]) {
      const found = byKey.get(key(n)) ?? [];
      if (found.length > 1)
        report.warnings.push(
          `${found.length} houses are named “${n}”; the first is used`,
        );
      if (found.length) {
        existing = found[0];
        break;
      }
    }
    if (!existing && s.onlyIfUsed && !used.has(s.name)) continue;
    if (existing) {
      const changes: string[] = [];
      if (existing.name !== s.name)
        changes.push(`renamed from “${existing.name}”`);
      if (existing.kind !== s.kind)
        changes.push(`type ${existing.kind} → ${s.kind}`);
      if (existing.parent_id !== parentId)
        changes.push(
          `parent ${existing.parent_id ? (nameById.get(existing.parent_id) ?? "?") : "none"} → ${f.parent ?? "none"}`,
        );
      const country = s.country ?? existing.country;
      if (country !== existing.country)
        changes.push(`country ${existing.country ?? "none"} → ${country}`);
      if (changes.length)
        await tx`update publishing_houses set name = ${s.name}, kind = ${s.kind},
          parent_id = ${parentId}, country = ${country} where id = ${existing.id}`;
      if (existing.name !== s.name)
        await tx`insert into publisher_aliases (publisher_id, name) values (${existing.id}, ${existing.name})
          on conflict do nothing`;
      idOf.set(s.name, existing.id);
      nameById.set(existing.id, s.name);
      report.houses.push({
        path: f.path,
        kind: s.kind,
        action: changes.length ? "update" : "keep",
        changes,
        note: s.note,
      });
    } else {
      const id = randomUUID();
      await tx`insert into publishing_houses (id, name, slug, kind, parent_id, country)
        values (${id}, ${s.name}, ${publisherSlug(s.name, id)}, ${s.kind}, ${parentId}, ${s.country ?? null})`;
      idOf.set(s.name, id);
      nameById.set(id, s.name);
      report.houses.push({
        path: f.path,
        kind: s.kind,
        action: "create",
        changes: [],
        note: s.note,
      });
    }
  }

  // Aliases: each spelling belongs to its spec houses alone
  for (const [k, hs] of owners) {
    const ids = hs
      .map((h) => idOf.get(h.spec.name))
      .filter((id): id is string => !!id);
    if (!ids.length) continue;
    const moved = await tx<{ publisher_id: string; name: string }[]>`
      delete from publisher_aliases where publisher_name_key(name) = ${k}
        and publisher_id <> all(${ids}::uuid[]) returning publisher_id, name`;
    for (const h of hs) {
      const id = idOf.get(h.spec.name);
      if (!id) continue;
      const spelling = [h.spec.name, ...(h.spec.aliases ?? [])].find(
        (n) => key(n) === k,
      )!;
      if (key(h.spec.name) === k) continue; // its own name
      await tx`insert into publisher_aliases (publisher_id, name) values (${id}, ${spelling}) on conflict do nothing`;
      report.aliases.push({
        name: spelling,
        house: h.spec.name,
        movedFrom: moved.map((m) => nameById.get(m.publisher_id) ?? "?"),
      });
    }
    // A house outside the taxonomy with this exact name makes the spelling ambiguous
    const strangers = (byKey.get(k) ?? []).filter((h) => !ids.includes(h.id));
    for (const s of strangers)
      report.warnings.push(
        `“${s.name}” is also the name of a house outside the taxonomy`,
      );
  }

  // ISBN rules belong to publishers (and groups for shared prefixes)
  for (const f of flat)
    for (const label of f.spec.prefixes ?? []) {
      const id = idOf.get(f.spec.name);
      if (!id) continue;
      const [previous] = await tx<{ publisher_id: string }[]>`
        select publisher_id from publisher_isbn_prefixes where prefix = ${prefixDigits(label)}`;
      await tx`insert into publisher_isbn_prefixes (prefix, publisher_id) values (${prefixDigits(label)}, ${id})
        on conflict (prefix) do update set publisher_id = excluded.publisher_id`;
      report.rules.push({
        prefix: label,
        house: f.spec.name,
        replaced:
          previous && previous.publisher_id !== id
            ? (nameById.get(previous.publisher_id) ?? "?")
            : null,
      });
    }

  for (const n of NOT_PUBLISHERS) {
    await tx`insert into ignored_publisher_names (name_key, name)
      values (publisher_name_key(${n.name}), ${n.name}) on conflict do nothing`;
    report.notPublishers.push(n.name);
  }

  // Imprint and country of each edition, from the second source. The imprint
  // field takes imprints only. When the book already names an imprint, the
  // source may only refine it (“Vintage International” for “Vintage”); a
  // different imprint is a disagreement, left for a person.
  const stem = (name: string) => publisherLooseKeys(name)[0] ?? key(name);
  for (const e of input.editions) {
    if (e.confirmed) continue;
    const plan = plans.get(e.id)!;
    const sets: {
      field: "imprint" | "publication_country";
      value: string;
      evidence: string;
    }[] = [];
    if (plan.house?.spec.kind === "imprint" && !e.imprint?.trim()) {
      const printed = (
        e.publisher ? (owners.get(key(e.publisher)) ?? []) : []
      ).filter((h) => h.spec.kind === "imprint");
      const name = plan.house.spec.name;
      const write = () =>
        sets.push({
          field: "imprint",
          value: name,
          evidence: `Open Library: “${plan.text}”`,
        });
      if (!printed.length) write();
      else if (printed.some((h) => h.spec.name === name)) {
        // Same imprint: nothing to add
      } else if (stem(name).startsWith(`${stem(e.publisher!)} `)) write();
      else
        report.disagreements.push({
          title: e.title,
          printed: e.publisher!,
          source: plan.text!,
        });
    }
    if (plan.market && !e.country?.trim())
      sets.push({
        field: "publication_country",
        value: plan.market,
        evidence: plan.marketFrom!,
      });
    for (const s of sets) {
      if (s.field === "imprint")
        await tx`update editions set imprint = ${s.value} where id = ${e.id}`;
      else
        await tx`update editions set publication_country = ${s.value} where id = ${e.id}`;
      await tx`insert into edition_enrichments (run_id, edition_id, field, old_value, new_value, source, evidence)
        values (${runId}, ${e.id}, ${s.field}, ${s.field === "imprint" ? e.imprint : e.country},
          ${s.value}, ${s.field === "imprint" ? "open_library" : "isbn_or_place"}, ${s.evidence})`;
      report.enrichments.push({
        editionId: e.id,
        title: e.title,
        field: s.field,
        oldValue: s.field === "imprint" ? e.imprint : e.country,
        newValue: s.value,
        evidence: s.evidence,
      });
    }
  }

  await tx`select set_config('durtal.defer_publisher_refresh', 'off', true)`;
  await tx`select refresh_all_publisher_links()`;
  const after = await linksByEdition(tx);
  const names = (l?: { name: string }[]) => (l ?? []).map((x) => x.name);
  for (const e of input.editions) {
    const b = names(before.get(e.id)),
      a = names(after.get(e.id));
    if (b.join("|") !== a.join("|"))
      report.links.push({
        editionId: e.id,
        title: e.title,
        before: b,
        after: a,
      });
    if (b.length) report.totals.linkedBefore++;
    if (a.length) report.totals.linkedAfter++;
    for (const l of after.get(e.id) ?? [])
      report.totals.byKindAfter[l.kind] =
        (report.totals.byKindAfter[l.kind] ?? 0) + 1;
  }
  report.links.sort((x, y) => x.title.localeCompare(y.title));
  return report;
}

/**
 * Undo the edition fields one run set, where they still hold the run's value.
 * Houses, aliases and rules stay; the hierarchy log keeps earlier parents.
 */
export async function undoTaxonomyRun(handle: AnyTx, runId: string) {
  const tx = handle as Tx;
  const rows = await tx<
    {
      id: string;
      edition_id: string;
      field: string;
      old_value: string | null;
      new_value: string;
    }[]
  >`
    select id, edition_id, field, old_value, new_value from edition_enrichments
    where run_id = ${runId} and undone_at is null`;
  for (const r of rows) {
    if (r.field === "imprint")
      await tx`update editions set imprint = ${r.old_value} where id = ${r.edition_id} and imprint = ${r.new_value}`;
    else
      await tx`update editions set publication_country = ${r.old_value} where id = ${r.edition_id} and publication_country = ${r.new_value}`;
    await tx`update edition_enrichments set undone_at = now() where id = ${r.id}`;
  }
  return rows.length;
}
