import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import { taxonomyStorage } from "@/lib/catalogue/taxonomy-storage";
import type { Db } from "@/lib/catalogue/work-store";
import type { DimensionSeed, VocabularySeed } from "@/lib/validations/enrichment";

/*
 * The vocabulary loader (SLN-462, section 6): plans, loads and undoes one
 * approved version from its seed file. The only code path that creates terms
 * (R4). It creates a missing taxonomy item in its family, reuses an existing
 * one by slug, and never renames, re-parents or deletes an item with links.
 * Items, rules and families a version creates carry its load time as their
 * creation time (one transaction), which is how its undo finds them.
 */

type Row = Record<string, unknown>;
const uuid = (id: string) => sql`${id}::uuid`;
async function rows<T = Row>(conn: Db, query: SQL) {
  return resultRows<T>(await conn.execute(query));
}

interface FamilyRow {
  id: string;
  slug: string;
  isSystem: boolean;
  systemTable: string | null;
  hierarchical: boolean;
}
interface CurrentTerm {
  id: string;
  key: string;
  label: string;
  definition: string;
  appliesWhen: string;
  doesNotApplyWhen: string;
  examples: unknown[];
  scaleValue: number | null;
  parentKey: string | null;
  itemId: string | null;
  workTypeId: string | null;
}
interface CurrentDimension {
  id: string;
  key: string;
  label: string;
  definition: string;
  layer: string;
  valueKind: string;
  entityLevel: string;
  provider: string | null;
  applyTarget: string;
  familyId: string | null;
  attributeCategory: string | null;
  requiresIndependentSources: boolean;
  autoAcceptEligible: boolean;
  unknownHandling: string;
  parameters: Record<string, unknown>;
  terms: CurrentTerm[];
  rule: { id: string; enabled: boolean } | null;
}

/** A term the version adds, with the item it governs */
interface TermPlan {
  dimension: string;
  key: string;
  seed: DimensionSeed["terms"][number];
  /** The current term it replaces, when it redefines one */
  replaces: string | null;
  item: { id: string; create: boolean; name: string; slug: string } | null;
  workTypeId: string | null;
}

export interface VocabularyPlan {
  version: number;
  /** Problems stop the load; none is written */
  problems: string[];
  dimensions: { add: string[]; retire: string[]; keep: string[] };
  terms: { add: string[]; redefine: string[]; retire: string[]; keep: string[] };
  items: { create: string[]; reuse: string[] };
  families: { create: string[] };
  rules: { add: string[]; turnOff: string[] };
  /** Internal: what the load writes */
  writes: {
    newFamilies: { id: string; slug: string; name: string; hierarchical: boolean }[];
    dimensions: { id: string; seed: DimensionSeed; familyId: string | null }[];
    retireDimensions: string[];
    terms: TermPlan[];
    retireTerms: string[];
    rules: { dimensionId: string; seed: NonNullable<DimensionSeed["rule"]> }[];
    turnOff: string[];
    dimensionIds: Record<string, string>;
  };
}

const sameJson = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);

async function currentState(conn: Db) {
  const dimensions = await rows<CurrentDimension>(
    conn,
    sql`select d.id, d.key, d.label, d.definition, d.layer, d.value_kind as "valueKind", d.entity_level as "entityLevel", d.provider,
        d.apply_target as "applyTarget", d.taxonomy_family_id as "familyId", d.attribute_category as "attributeCategory",
        d.requires_independent_sources as "requiresIndependentSources", d.auto_accept_eligible as "autoAcceptEligible",
        d.unknown_handling as "unknownHandling", d.parameters,
        coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'key', t.key, 'label', t.label, 'definition', t.definition,
            'appliesWhen', t.applies_when, 'doesNotApplyWhen', t.does_not_apply_when, 'examples', t.examples,
            'scaleValue', t.scale_value::float8, 'parentKey', p.key, 'itemId', coalesce(t.system_item_id, t.custom_item_id), 'workTypeId', t.work_type_id) order by t.key)
          from enrichment_terms t left join enrichment_terms p on p.id = t.parent_term_id
          where t.dimension_id = d.id and t.retired_in is null), '[]'::jsonb) as terms,
        (select jsonb_build_object('id', r.id, 'enabled', r.enabled) from enrichment_auto_accept_rules r where r.dimension_id = d.id) as rule
      from enrichment_dimensions d where d.retired_in is null order by d.key`,
  );
  const families = await rows<FamilyRow>(
    conn,
    sql`select id, slug, is_system as "isSystem", system_table as "systemTable", hierarchical from taxonomy_families`,
  );
  const [{ version }] = await rows<{ version: number | null }>(conn, sql`select max(version) as version from enrichment_vocabulary_versions`);
  return { dimensions, families, version: version ?? 0 };
}

/** The examples of a term, with merged work ids followed to their kept work */
async function resolveExamples(conn: Db, examples: DimensionSeed["terms"][number]["examples"], problems: string[], at: string) {
  const out: unknown[] = [];
  for (const e of examples) {
    if (!("workId" in e)) {
      out.push({ title: e.title, author: e.author });
      continue;
    }
    const [kept] = await rows<{ id: string; kind: string }>(
      conn,
      sql`with recursive chain(id, depth) as (
          select ${uuid(e.workId)}, 0
          union all select r.target_id, c.depth + 1 from harmonization_redirects r join chain c on r.source_id = c.id and r.entity = 'works' where c.depth < 10)
        select w.id, w.kind from chain c join works w on w.id = c.id order by c.depth desc limit 1`,
    );
    if (!kept || kept.kind !== "book") problems.push(`${at}: the example ${e.workId} is not a book in the catalogue`);
    else out.push({ workId: kept.id });
  }
  return out;
}

/** Plans one version: what it adds, redefines, retires and keeps. Writes nothing. */
export async function planVocabulary(conn: Db, seed: VocabularySeed): Promise<VocabularyPlan> {
  const state = await currentState(conn);
  const problems: string[] = [];
  const plan: VocabularyPlan = {
    version: seed.version,
    problems,
    dimensions: { add: [], retire: [], keep: [] },
    terms: { add: [], redefine: [], retire: [], keep: [] },
    items: { create: [], reuse: [] },
    families: { create: [] },
    rules: { add: [], turnOff: [] },
    writes: { newFamilies: [], dimensions: [], retireDimensions: [], terms: [], retireTerms: [], rules: [], turnOff: [], dimensionIds: {} },
  };
  if (seed.version !== state.version + 1)
    problems.push(`The next version is ${state.version + 1}; the seed is version ${seed.version}`);
  const byKey = new Map(state.dimensions.map((d) => [d.key, d]));
  const families = new Map(state.families.map((f) => [f.slug, f]));
  const changed = new Set<string>();

  for (const d of seed.dimensions) {
    const at = `dimensions.${d.key}`;
    let family: FamilyRow | null = null;
    if (d.family) {
      family = families.get(d.family) ?? null;
      if (!family && d.newFamily) {
        family = { id: randomUUID(), slug: d.family, isSystem: false, systemTable: null, hierarchical: d.newFamily.hierarchical };
        families.set(d.family, family);
        plan.writes.newFamilies.push({ id: family.id, slug: d.family, name: d.newFamily.name, hierarchical: d.newFamily.hierarchical });
        plan.families.create.push(d.family);
      }
      if (!family) {
        problems.push(`${at}: the family ${d.family} does not exist`);
        continue;
      }
    }
    const existing = byKey.get(d.key);
    if (existing) {
      const identity = (x: { layer: string; valueKind: string; entityLevel: string; provider: string | null; applyTarget: string; familyId: string | null; attributeCategory: string | null }) =>
        [x.layer, x.valueKind, x.entityLevel, x.provider ?? null, x.applyTarget, x.familyId ?? null, x.attributeCategory ?? null];
      const seeded = { ...d, provider: d.provider ?? null, familyId: family?.id ?? null, attributeCategory: d.attributeCategory ?? null };
      if (!sameJson(identity(existing), identity(seeded)))
        problems.push(`${at}: a dimension's kind, level, provider, target and family never change; add it under a new key`);
      const settings = (x: { label: string; definition: string; requiresIndependentSources: boolean; autoAcceptEligible: boolean; unknownHandling: string; parameters: unknown }) =>
        [x.label, x.definition, x.requiresIndependentSources, x.autoAcceptEligible, x.unknownHandling, x.parameters];
      if (!sameJson(settings(existing), settings(d)))
        problems.push(`${at}: a kept dimension keeps its label, definition and settings; add it under a new key`);
      plan.dimensions.keep.push(d.key);
      plan.writes.dimensionIds[d.key] = existing.id;
    } else {
      const id = randomUUID();
      plan.dimensions.add.push(d.key);
      plan.writes.dimensions.push({ id, seed: d, familyId: family?.id ?? null });
      plan.writes.dimensionIds[d.key] = id;
      changed.add(d.key);
    }
    if (d.rule && !existing?.rule) {
      plan.rules.add.push(d.key);
      plan.writes.rules.push({ dimensionId: plan.writes.dimensionIds[d.key], seed: d.rule });
    }

    // Terms: kept as they are, redefined (a new term for the same item), added or retired
    const current = new Map((existing?.terms ?? []).map((t) => [t.key, t]));
    for (const t of d.terms) {
      const tat = `${at}.terms.${t.key}`;
      const examples = await resolveExamples(conn, t.examples, problems, tat);
      const now = current.get(t.key);
      const content = { label: t.label, definition: t.definition, appliesWhen: t.appliesWhen, doesNotApplyWhen: t.doesNotApplyWhen, examples, scaleValue: t.scaleValue ?? null, parentKey: t.parent ?? null };
      if (now && sameJson({ ...content }, { label: now.label, definition: now.definition, appliesWhen: now.appliesWhen, doesNotApplyWhen: now.doesNotApplyWhen, examples: now.examples, scaleValue: now.scaleValue, parentKey: now.parentKey })) {
        plan.terms.keep.push(`${d.key}.${t.key}`);
        continue;
      }
      changed.add(d.key);
      const term: TermPlan = { dimension: d.key, key: t.key, seed: { ...t, examples: examples as never }, replaces: now?.id ?? null, item: null, workTypeId: null };
      if (now) {
        plan.terms.redefine.push(`${d.key}.${t.key}`);
        term.item = now.itemId ? { id: now.itemId, create: false, name: t.label, slug: t.item?.slug ?? t.key } : null;
        term.workTypeId = now.workTypeId;
      } else {
        plan.terms.add.push(`${d.key}.${t.key}`);
        if (d.applyTarget === "work.work_type_id") {
          const [wt] = await rows<{ id: string }>(conn, sql`select id from work_types where name = ${t.workType!}`);
          if (!wt) problems.push(`${tat}: no work type is named ${t.workType}`);
          else term.workTypeId = wt.id;
        } else if (family) {
          const storage = taxonomyStorage(family);
          const slug = t.item?.slug ?? t.key;
          const name = t.item?.name ?? t.label;
          const familyFilter = storage.custom ? sql`and family_id = ${uuid(family.id)}` : sql``;
          const [found] = family.id && plan.writes.newFamilies.some((f) => f.id === family!.id)
            ? []
            : await rows<{ id: string }>(conn, sql`select id from ${sql.identifier(storage.table)} where slug = ${slug} ${familyFilter}`);
          if (found) {
            term.item = { id: found.id, create: false, name, slug };
            plan.items.reuse.push(`${d.family}/${slug}`);
          } else {
            const [named] = storage.custom
              ? []
              : await rows<{ slug: string }>(conn, sql`select slug from ${sql.identifier(storage.table)} where lower(name) = lower(${name})`);
            if (named) problems.push(`${tat}: an item named ${name} exists with the slug ${named.slug}; name that slug in the seed`);
            term.item = { id: randomUUID(), create: true, name, slug };
            plan.items.create.push(`${d.family}/${slug}`);
          }
        }
      }
      plan.writes.terms.push(term);
    }
    for (const now of existing?.terms ?? [])
      if (!d.terms.some((t) => t.key === now.key)) {
        plan.terms.retire.push(`${d.key}.${now.key}`);
        plan.writes.retireTerms.push(now.id);
        changed.add(d.key);
      }
  }
  for (const d of state.dimensions)
    if (!seed.dimensions.some((s) => s.key === d.key)) {
      plan.dimensions.retire.push(d.key);
      plan.writes.retireDimensions.push(d.id);
      plan.writes.retireTerms.push(...d.terms.map((t) => t.id));
      changed.add(d.key);
    }
  // R8: a rule's precision was measured on the old terms
  for (const d of state.dimensions)
    if (d.rule?.enabled && changed.has(d.key)) {
      plan.rules.turnOff.push(d.key);
      plan.writes.turnOff.push(d.rule.id);
    }
  return plan;
}

/** The insert of a new taxonomy item, as the taxonomy actions write one */
function itemInsert(d: Db, family: FamilyRow, item: { id: string; name: string; slug: string }, extra: { description: string; category: string | null; parentId: string | null }) {
  const storage = taxonomyStorage(family);
  const values: Record<string, SQL> = { id: uuid(item.id), name: sql`${item.name}`, slug: sql`${item.slug}` };
  if (storage.custom) values.family_id = uuid(family.id);
  if (storage.columns.has("parent_id")) values.parent_id = sql`${extra.parentId}::uuid`;
  if (storage.columns.has("level")) values.level = sql`1`;
  if (storage.columns.has("description")) values.description = sql`${extra.description}`;
  else if (storage.columns.has("scope_notes")) values.scope_notes = sql`${extra.description}`;
  if (storage.columns.has("category")) values.category = sql`${extra.category}`;
  // The version's load time: its undo finds the items it created by it
  if (storage.columns.has("created_at")) values.created_at = sql`now()`;
  const fields = Object.entries(values);
  return d.execute(
    sql`insert into ${sql.identifier(storage.table)} (${sql.join(fields.map(([k]) => sql.identifier(k)), sql`, `)})
      values (${sql.join(fields.map(([, v]) => v), sql`, `)})`,
  );
}

/**
 * Loads one version in the caller's transaction: the version row, families,
 * dimensions, items, terms, disabled rules, retirements, and the enabled
 * rules it turns off. Refuses a plan with problems.
 */
export async function applyVocabulary(tx: Db, seed: VocabularySeed, approval: { approvalUrl: string; seedSha256: string }) {
  const plan = await planVocabulary(tx, seed);
  if (plan.problems.length) throw new Error(`The seed has problems:\n${plan.problems.join("\n")}`);
  const w = plan.writes;
  const run = (query: SQL) => tx.execute(query);
  await run(sql`insert into enrichment_vocabulary_versions (version, approved_at, approval_url, document_url, seed_sha256, loaded_at, notes)
    values (${seed.version}, now(), ${approval.approvalUrl}, ${seed.documentUrl}, ${approval.seedSha256}, now(), ${seed.notes ?? null})`);
  for (const f of w.newFamilies)
    await run(sql`insert into taxonomy_families (id, name, slug, is_system, entity_level, hierarchical, created_at)
      values (${uuid(f.id)}, ${f.name}, ${f.slug}, false, 'work', ${f.hierarchical}, now())`);
  for (const d of w.dimensions)
    await run(sql`insert into enrichment_dimensions (id, key, label, definition, layer, value_kind, entity_level, provider, apply_target,
        taxonomy_family_id, attribute_category, requires_independent_sources, auto_accept_eligible, unknown_handling, parameters, introduced_in)
      values (${uuid(d.id)}, ${d.seed.key}, ${d.seed.label}, ${d.seed.definition}, ${d.seed.layer}, ${d.seed.valueKind}, ${d.seed.entityLevel},
        ${d.seed.provider ?? null}, ${d.seed.applyTarget}, ${d.familyId}::uuid, ${d.seed.attributeCategory ?? null},
        ${d.seed.requiresIndependentSources}, ${d.seed.autoAcceptEligible}, ${d.seed.unknownHandling}, ${JSON.stringify(d.seed.parameters)}::jsonb, ${seed.version})`);
  // Retire first: a redefined term's item is then free for its new term
  if (w.retireTerms.length)
    await run(sql`update enrichment_terms set retired_in = ${seed.version} where id in (${sql.join(w.retireTerms.map(uuid), sql`, `)})`);
  const redefined = w.terms.filter((t) => t.replaces).map((t) => t.replaces!);
  if (redefined.length)
    await run(sql`update enrichment_terms set retired_in = ${seed.version} where id in (${sql.join(redefined.map(uuid), sql`, `)})`);
  if (w.retireDimensions.length)
    await run(sql`update enrichment_dimensions set retired_in = ${seed.version} where id in (${sql.join(w.retireDimensions.map(uuid), sql`, `)})`);

  // Parents before children, so a term's item can take its parent's item as parent
  const families = new Map((await rows<FamilyRow>(tx, sql`select id, slug, is_system as "isSystem", system_table as "systemTable", hierarchical from taxonomy_families`)).map((f) => [f.slug, f]));
  const termIds = new Map<string, string>();
  const itemIds = new Map<string, string | null>();
  const current = await rows<{ dimension: string; key: string; id: string; itemId: string | null }>(
    tx,
    sql`select d.key as dimension, t.key, t.id, coalesce(t.system_item_id, t.custom_item_id) as "itemId" from enrichment_terms t
      join enrichment_dimensions d on d.id = t.dimension_id where t.retired_in is null`,
  );
  for (const t of current) {
    termIds.set(`${t.dimension}.${t.key}`, t.id);
    itemIds.set(`${t.dimension}.${t.key}`, t.itemId);
  }
  const pending = [...w.terms];
  while (pending.length) {
    const index = pending.findIndex((t) => !t.seed.parent || termIds.has(`${t.dimension}.${t.seed.parent}`));
    if (index < 0) throw new Error("A term's parent is not loaded");
    const [t] = pending.splice(index, 1);
    const dimension = seed.dimensions.find((d) => d.key === t.dimension)!;
    const family = dimension.family ? families.get(dimension.family)! : null;
    const parentId = t.seed.parent ? termIds.get(`${t.dimension}.${t.seed.parent}`)! : null;
    if (t.item?.create && family)
      await itemInsert(tx, family, t.item, {
        description: t.seed.definition,
        category: dimension.attributeCategory ?? null,
        parentId: t.seed.parent ? (itemIds.get(`${t.dimension}.${t.seed.parent}`) ?? null) : null,
      });
    const id = randomUUID();
    const custom = family && taxonomyStorage(family).custom;
    await run(sql`insert into enrichment_terms (id, dimension_id, key, label, definition, applies_when, does_not_apply_when, examples, scale_value,
        introduced_in, custom_item_id, system_item_id, work_type_id, parent_term_id)
      values (${uuid(id)}, ${uuid(w.dimensionIds[t.dimension])}, ${t.key}, ${t.seed.label}, ${t.seed.definition}, ${t.seed.appliesWhen},
        ${t.seed.doesNotApplyWhen}, ${JSON.stringify(t.seed.examples)}::jsonb, ${t.seed.scaleValue ?? null}::numeric, ${seed.version},
        ${custom ? t.item!.id : null}::uuid, ${!custom && t.item ? t.item.id : null}::uuid, ${t.workTypeId}::uuid, ${parentId}::uuid)`);
    if (t.replaces) await run(sql`update enrichment_terms set replaced_by_term_id = ${uuid(id)} where id = ${uuid(t.replaces)}`);
    termIds.set(`${t.dimension}.${t.key}`, id);
    itemIds.set(`${t.dimension}.${t.key}`, t.item?.id ?? null);
  }
  for (const r of w.rules)
    await run(sql`insert into enrichment_auto_accept_rules (dimension_id, basis, minimum_confidence, minimum_sample, created_at)
      values (${uuid(r.dimensionId)}, ${r.seed.basis}, ${r.seed.minimumConfidence}, ${r.seed.minimumSample ?? null}, now())`);
  if (w.turnOff.length)
    await run(sql`update enrichment_auto_accept_rules set enabled = false where id in (${sql.join(w.turnOff.map(uuid), sql`, `)})`);
  return plan;
}

/**
 * Undoes an unused version in the caller's transaction. Refused while a claim
 * uses it or its terms, an item it created has links, a rule of its
 * dimensions is on, or a later version exists.
 */
export async function undoVocabulary(tx: Db, version: number) {
  const [v] = await rows<{ loadedAt: string; later: boolean }>(
    tx,
    sql`select loaded_at::text as "loadedAt", exists (select 1 from enrichment_vocabulary_versions where version > ${version}) as later
      from enrichment_vocabulary_versions where version = ${version}`,
  );
  if (!v) throw new Error(`Version ${version} is not loaded`);
  if (v.later) throw new Error(`Version ${version} has a later version; undo that one first`);
  const terms = sql`select id from enrichment_terms where introduced_in = ${version}`;
  const dimensions = sql`select id from enrichment_dimensions where introduced_in = ${version}`;
  const [use] = await rows<{ claims: number; rules: number }>(
    tx,
    sql`select (select count(*)::int from enrichment_claims where vocabulary_version = ${version} or term_id in (${terms})) as claims,
      (select count(*)::int from enrichment_auto_accept_rules r where r.enabled and (r.dimension_id in (${dimensions}) or r.created_at = ${v.loadedAt}::timestamptz)) as rules`,
  );
  if (use.claims) throw new Error(`Version ${version} is used by ${use.claims} claims`);
  if (use.rules) throw new Error(`A rule of version ${version} is on; turn it off first`);
  // The items it created: governed by its terms, created at its load
  const created = await rows<{ id: string; family: FamilyRow }>(
    tx,
    sql`select coalesce(t.system_item_id, t.custom_item_id) as id,
        jsonb_build_object('id', f.id, 'slug', f.slug, 'isSystem', f.is_system, 'systemTable', f.system_table, 'hierarchical', f.hierarchical) as family
      from enrichment_terms t join enrichment_dimensions d on d.id = t.dimension_id join taxonomy_families f on f.id = d.taxonomy_family_id
      where t.introduced_in = ${version} and coalesce(t.system_item_id, t.custom_item_id) is not null`,
  );
  const mine: { id: string; table: string; parentId: string | null }[] = [];
  for (const c of created) {
    const storage = taxonomyStorage(c.family);
    const link = storage.links.find((l) => l.level === "work")!;
    const parent = storage.columns.has("parent_id") ? sql`parent_id` : sql`null::uuid`;
    const [r] = await rows<{ created: boolean; linked: boolean; parentId: string | null }>(
      tx,
      sql`select created_at = ${v.loadedAt}::timestamptz as created, ${parent} as "parentId",
          exists (select 1 from ${sql.identifier(link.table)} where ${sql.identifier(link.item)} = ${uuid(c.id)}) as linked
        from ${sql.identifier(storage.table)} where id = ${uuid(c.id)}`,
    );
    if (!r?.created) continue;
    if (r.linked) throw new Error(`An item version ${version} created has links; remove them first`);
    mine.push({ id: c.id, table: storage.table, parentId: r.parentId });
  }
  // Children before their parents: a family refuses deleting an item with children
  const ordered: typeof mine = [];
  const left = [...mine];
  while (left.length) {
    const leaf = left.findIndex((m) => !left.some((o) => o.parentId === m.id));
    ordered.push(...left.splice(leaf < 0 ? 0 : leaf, 1));
  }
  const run = (query: SQL) => tx.execute(query);
  await run(sql`delete from enrichment_auto_accept_rules where dimension_id in (${dimensions}) or created_at = ${v.loadedAt}::timestamptz`);
  // Its terms go before the terms they replaced are current again: one current term per item
  await run(sql`update enrichment_terms set replaced_by_term_id = null where retired_in = ${version}`);
  await run(sql`delete from enrichment_terms where introduced_in = ${version}`);
  await run(sql`update enrichment_terms set retired_in = null where retired_in = ${version}`);
  await run(sql`delete from enrichment_dimensions where introduced_in = ${version}`);
  await run(sql`update enrichment_dimensions set retired_in = null where retired_in = ${version}`);
  for (const m of ordered) await run(sql`delete from ${sql.identifier(m.table)} where id = ${uuid(m.id)}`);
  await run(sql`delete from taxonomy_families f where f.created_at = ${v.loadedAt}::timestamptz and not f.is_system
    and not exists (select 1 from custom_taxonomy_items i where i.family_id = f.id)
    and not exists (select 1 from enrichment_dimensions d where d.taxonomy_family_id = f.id)`);
  await run(sql`delete from enrichment_vocabulary_versions where version = ${version}`);
  return { version, items: mine.length };
}
