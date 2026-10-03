/**
 * Publisher name resolution (tasks 0171, 0172). Server-only module, shared by
 * the server actions and `scripts/publishers/auto-resolve.ts`; it never
 * touches the Next.js cache (callers do).
 *
 * Unconfirmed editions without a house are grouped by the publisher or
 * imprint text they carry. Each name gets suggestions (similar name, ISBN
 * publisher prefix) and an automatic plan:
 * - alias: exactly one house has a similar name, the ISBNs point at no other
 *   house, and the name passes every guardrail;
 * - create: a new publisher, when no house is similar or related, every book
 *   has a valid ISBN that no house uses, the name spans at most two ISBN
 *   publishers, no other unresolved name shares its ISBN, and the name
 *   passes every guardrail;
 * - hold: anything else, with the reason. A person decides.
 * Automatic decisions are logged in `publisher_auto_decisions`, can be undone,
 * and never save ISBN rules. A name with a logged decision is never decided
 * automatically again.
 */
import { randomUUID } from "node:crypto";
import { eq, sql, and, gte, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  publishingHouses,
  publisherAliases,
  publisherIsbnPrefixes,
  ignoredPublisherNames,
  publisherAutoDecisions,
} from "@/lib/db/schema";
import {
  cleanPublisherName,
  isbnPrefix,
  publisherLooseKeys,
  publisherNameProblem,
  publisherSlug,
  relatedPublisherKey,
  relatedPublisherKeys,
  sameBookTitle,
} from "@/lib/publishers/names";
import {
  editionImage,
  type EditionImage,
  type PosterImage,
} from "@/lib/utils/edition-image";
import type { PublisherOption } from "@/components/publishers/publisher-picker";

/** New houses the automatic path may create in 24 hours while books are added */
export const DAILY_AUTOMATIC_HOUSES = 20;

export interface PublisherSuggestion {
  publisher: PublisherOption;
  /** "name": similar name; "isbn": ISBN prefix of the house's books; "both" */
  via: "name" | "isbn" | "both";
  reason: string;
}

export type AutomaticPlan =
  | { action: "alias"; publisher: PublisherOption; reason: string }
  | {
      action: "create";
      name: string;
      reason: string;
      /** Key of the name whose new house this one joins (same publisher) */
      sameAs?: string;
    }
  | { action: "hold"; reason: string };

export interface PublisherNameRow {
  /** publisher_name_key of the name */
  key: string;
  /** The most common spelling */
  name: string;
  /** The name a house created from it gets ("Dedalus" for "Dedalus Limited") */
  cleanName: string;
  /** Houses that match the name exactly: 0, or 2+ (ambiguous) */
  candidates: number;
  editions: {
    id: string;
    title: string;
    workTitle: string;
    workSlug: string | null;
    image: EditionImage | null;
  }[];
  /** ISBN publisher prefixes of these editions; `reach` counts other editions without a house that share it */
  prefixes: { digits: string; label: string; reach: number }[];
  suggestions: PublisherSuggestion[];
  automatic: AutomaticPlan;
}

export function resultRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type NameRecord = {
  id: string;
  title: string;
  isbn_13: string | null;
  isbn_10: string | null;
  cover_s3_key: string | null;
  thumbnail_s3_key: string | null;
  work_slug: string | null;
  work_title: string;
  authors: string | null;
  name: string;
  key: string;
  candidates: number;
  poster: PosterImage | null;
};
type HouseRecord = PublisherOption & { aliases: string[] };

export async function loadNameInbox() {
  const [names, houses, rules, linked, open, ignored, decided] = await Promise.all([
    db.execute(sql`
      select e.id, e.title, e.isbn_13, e.isbn_10, e.cover_s3_key, e.thumbnail_s3_key,
        w.slug as work_slug, w.title as work_title,
        (select string_agg(a.name, '|') from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id) as authors,
        trim(n.name) as name, publisher_name_key(n.name) as key,
        (select count(*)::int from publisher_candidates(n.name)) as candidates,
        (select json_build_object('s3Key', m.s3_key, 'thumbnailS3Key', m.thumbnail_s3_key, 'cropX', m.crop_x, 'cropY', m.crop_y, 'cropZoom', m.crop_zoom, 'brightness', m.brightness, 'contrast', m.contrast)
          from media m where m.work_id = w.id and m.type = 'poster' and m.is_active
          order by m.created_at, m.id limit 1) as poster
      from editions e
      join works w on w.id = e.work_id
      cross join lateral (
        select distinct on (publisher_name_key(v)) v as name
        from (values (e.publisher), (e.imprint)) as x(v)
        where nullif(trim(v), '') is not null
      ) n
      where not e.publisher_links_confirmed
        and not exists (select 1 from edition_publishers ep where ep.edition_id = e.id)
        and not exists (select 1 from ignored_publisher_names i where i.name_key = publisher_name_key(n.name))
      order by lower(w.title), e.id`),
    db.execute(sql`
      select h.id, h.name, h.slug, h.country, h.kind, h.parent_id as "parentId", p.name as "parentName",
        coalesce((select array_agg(a.name) from publisher_aliases a where a.publisher_id = h.id), '{}') as aliases
      from publishing_houses h left join publishing_houses p on p.id = h.parent_id`),
    db.select().from(publisherIsbnPrefixes),
    db.execute(sql`
      select e.isbn_13, e.isbn_10, ep.publisher_id
      from edition_publishers ep join editions e on e.id = ep.edition_id
      where edition_isbn_digits(e.isbn_13, e.isbn_10) is not null`),
    db.execute(sql`
      select e.id, e.isbn_13, e.isbn_10 from editions e
      where not e.publisher_links_confirmed
        and not exists (select 1 from edition_publishers ep where ep.edition_id = e.id)
        and edition_isbn_digits(e.isbn_13, e.isbn_10) is not null`),
    db.select().from(ignoredPublisherNames).orderBy(ignoredPublisherNames.name),
    db.select({ key: publisherAutoDecisions.nameKey }).from(publisherAutoDecisions),
  ]);

  const houseList = resultRows<HouseRecord>(houses);
  const houseById = new Map(houseList.map((h) => [h.id, h]));
  const option = (h: HouseRecord): PublisherOption => ({
    id: h.id,
    name: h.name,
    slug: h.slug,
    country: h.country,
    kind: h.kind,
    parentId: h.parentId,
    parentName: h.parentName,
  });
  const decidedKeys = new Set(decided.map((d) => d.key));

  // Loose name key → houses (names and aliases)
  const looseIndex = new Map<string, Set<string>>();
  for (const h of houseList)
    for (const n of [h.name, ...h.aliases])
      for (const k of publisherLooseKeys(n)) {
        const ids = looseIndex.get(k) ?? new Set<string>();
        ids.add(h.id);
        looseIndex.set(k, ids);
      }
  const houseKeys = [...looseIndex.keys()];
  const houseNameForKey = (k: string) =>
    [...(looseIndex.get(k) ?? [])].map((id) => houseById.get(id)?.name).join(", ");

  // ISBN prefix → houses of linked editions, with counts
  const evidence = new Map<string, Map<string, number>>();
  for (const r of resultRows<{ isbn_13: string | null; isbn_10: string | null; publisher_id: string }>(linked)) {
    const p = isbnPrefix(r.isbn_13 ?? r.isbn_10);
    if (!p) continue;
    const counts = evidence.get(p.digits) ?? new Map<string, number>();
    counts.set(r.publisher_id, (counts.get(r.publisher_id) ?? 0) + 1);
    evidence.set(p.digits, counts);
  }
  const ruleByPrefix = new Map(rules.map((r) => [r.prefix, r.publisherId]));

  // Editions without a house, by ISBN prefix: how far a new rule reaches
  const openByPrefix = new Map<string, Set<string>>();
  for (const r of resultRows<{ id: string; isbn_13: string | null; isbn_10: string | null }>(open)) {
    const p = isbnPrefix(r.isbn_13 ?? r.isbn_10);
    if (!p) continue;
    const ids = openByPrefix.get(p.digits) ?? new Set<string>();
    ids.add(r.id);
    openByPrefix.set(p.digits, ids);
  }

  const groups = new Map<string, NameRecord[]>();
  for (const r of resultRows<NameRecord>(names)) {
    if (r.candidates === 1) continue;
    groups.set(r.key, [...(groups.get(r.key) ?? []), r]);
  }

  // ISBN prefix → unresolved names that carry it
  const namesByPrefix = new Map<string, Set<string>>();
  for (const [key, records] of groups)
    for (const r of records) {
      const p = isbnPrefix(r.isbn_13 ?? r.isbn_10);
      if (!p) continue;
      namesByPrefix.set(p.digits, (namesByPrefix.get(p.digits) ?? new Set()).add(key));
    }

  const rows: PublisherNameRow[] = [...groups.entries()].map(([key, records]) => {
    const spellings = new Map<string, number>();
    for (const r of records) spellings.set(r.name, (spellings.get(r.name) ?? 0) + 1);
    // Most common spelling; on a tie, mixed case ("New York") before "new york" or "NEW YORK"
    const flatCase = (s: string) => Number(s === s.toLowerCase() || s === s.toUpperCase());
    const name = [...spellings.entries()].sort(
      (a, b) => b[1] - a[1] || flatCase(a[0]) - flatCase(b[0]) || a[0].localeCompare(b[0]),
    )[0][0];
    const editionIds = new Set(records.map((r) => r.id));
    const authors = [
      ...new Set(records.flatMap((r) => (r.authors ? r.authors.split("|") : []))),
    ];

    // Similar name: exactly one house shares a loose key
    const nameKeys = publisherLooseKeys(name);
    const nameHouses = new Set<string>();
    for (const k of nameKeys) for (const id of looseIndex.get(k) ?? []) nameHouses.add(id);
    const nameHouse = nameHouses.size === 1 ? [...nameHouses][0] : null;

    // ISBN prefixes: one house among the linked books with these prefixes
    const prefixes = new Map<string, { digits: string; label: string; reach: number }>();
    let missingIsbn = false;
    for (const r of records) {
      const p = isbnPrefix(r.isbn_13 ?? r.isbn_10);
      if (!p) {
        missingIsbn = true;
        continue;
      }
      if (prefixes.has(p.digits)) continue;
      const reach = [...(openByPrefix.get(p.digits) ?? [])].filter((id) => !editionIds.has(id)).length;
      prefixes.set(p.digits, { ...p, reach });
    }
    // Linked books per house, once per prefix
    const isbnHouses = new Map<string, number>();
    let isbnConflict = false;
    for (const digits of prefixes.keys()) {
      const rule = ruleByPrefix.get(digits);
      const counts = rule ? new Map([[rule, 1]]) : evidence.get(digits);
      if (!counts) continue;
      if (counts.size > 1) isbnConflict = true;
      else for (const [id, n] of counts) isbnHouses.set(id, (isbnHouses.get(id) ?? 0) + n);
    }
    if (isbnHouses.size > 1) isbnConflict = true;
    const isbnHouse = !isbnConflict && isbnHouses.size === 1 ? [...isbnHouses.keys()][0] : null;
    const isbnText = (id: string) => {
      const labels = [...prefixes.values()]
        .filter((p) => ruleByPrefix.get(p.digits) === id || evidence.get(p.digits)?.has(id))
        .map((p) => p.label);
      return `the same ISBN prefix (${labels.join(", ")}) as ${plural(isbnHouses.get(id) ?? 0, "book")} of this house`;
    };

    const suggestions: PublisherSuggestion[] = [];
    if (nameHouse && nameHouse === isbnHouse) {
      suggestions.push({
        publisher: option(houseById.get(nameHouse)!),
        via: "both",
        reason: `Similar name, and ${isbnText(nameHouse)}`,
      });
    } else {
      if (nameHouse)
        suggestions.push({
          publisher: option(houseById.get(nameHouse)!),
          via: "name",
          reason: "Similar name",
        });
      if (isbnHouse)
        suggestions.push({
          publisher: option(houseById.get(isbnHouse)!),
          via: "isbn",
          reason: `Different name, but ${isbnText(isbnHouse)}`,
        });
    }

    const candidates = Math.max(...records.map((r) => r.candidates));
    const automatic = ((): AutomaticPlan => {
      const hold = (reason: string): AutomaticPlan => ({ action: "hold", reason });
      if (decidedKeys.has(key)) return hold("Decided automatically before, then undone: left to you");
      if (candidates > 1) return hold(`Matches ${candidates} houses with this name`);
      const problem = publisherNameProblem(name, authors);
      if (problem) return hold(problem);
      const strange = records.find((r) => !sameBookTitle(r.title, r.work_title));
      if (strange)
        return hold(`The book data may describe another book (“${strange.title}”)`);
      if (nameHouse) {
        const house = houseById.get(nameHouse)!;
        if (isbnConflict) return hold(`Similar to ${house.name}, but its ISBNs belong to several houses`);
        if (isbnHouse && isbnHouse !== nameHouse)
          return hold(`Similar to ${house.name}, but its ISBN belongs to ${houseById.get(isbnHouse)!.name}`);
        if (!nameKeys.some((k) => k.replace(/\s/g, "").length >= 4))
          return hold("Name too short to compare safely");
        return {
          action: "alias",
          publisher: option(house),
          reason: isbnHouse ? "Similar name and the same ISBN publisher" : "Similar name",
        };
      }
      if (isbnHouse)
        return hold(`Its ISBN belongs to ${houseById.get(isbnHouse)!.name} under another name`);
      if (isbnConflict) return hold("Its ISBNs belong to several houses: may be a distributor");
      const related = nameKeys.map((k) => relatedPublisherKey(k, houseKeys)).find(Boolean);
      if (related) return hold(`May belong to ${houseNameForKey(related)}`);
      if (missingIsbn || !prefixes.size)
        return hold("A book with this name has no valid ISBN to confirm it");
      if (prefixes.size > 2)
        return hold(`Its books use ${prefixes.size} ISBN publishers: may be a distributor`);
      // Another spelling of the same name joins its house below
      const loose = nameKeys[0];
      for (const p of prefixes.values()) {
        const other = [...(namesByPrefix.get(p.digits) ?? [])].find(
          (k) => k !== key && publisherLooseKeys(groups.get(k)![0].name)[0] !== loose,
        );
        if (other)
          return hold(`Shares ISBN ${p.label} with “${groups.get(other)![0].name}”`);
      }
      return {
        action: "create",
        name: cleanPublisherName(name),
        reason: "New publisher: no similar house, and no house uses its ISBN",
      };
    })();

    return {
      key,
      name,
      cleanName: cleanPublisherName(name),
      candidates,
      editions: records.map((r) => ({
        id: r.id,
        title: r.title,
        workTitle: r.work_title,
        workSlug: r.work_slug,
        image: editionImage(
          { coverS3Key: r.cover_s3_key, thumbnailS3Key: r.thumbnail_s3_key },
          r.poster,
        ),
      })),
      prefixes: [...prefixes.values()],
      suggestions,
      automatic,
    };
  });
  rows.sort((a, b) => b.editions.length - a.editions.length || a.name.localeCompare(b.name));

  // New names of one publisher ("Maclehose", "MacLehose Press") make one
  // house; the most common spelling leads. Close new names ("Seix Barral",
  // "Seix Barral - Argentina") wait for a person.
  const creates = rows.filter((r) => r.automatic.action === "create");
  const leaders = new Map<string, PublisherNameRow>();
  for (const r of creates) {
    const loose = publisherLooseKeys(r.name)[0] ?? r.key;
    const leader = leaders.get(loose);
    if (!leader) leaders.set(loose, r);
    else
      r.automatic = {
        action: "create",
        name: (leader.automatic as { name: string }).name,
        reason: `Same publisher as “${leader.name}”`,
        sameAs: leader.key,
      };
  }
  for (const [loose, r] of leaders) {
    const close = [...leaders].find(([other]) => relatedPublisherKeys(loose, other));
    if (close)
      r.automatic = {
        action: "hold",
        reason: `Close to another new name “${close[1].name}”: may be one publisher`,
      };
  }
  for (const r of creates)
    if (r.automatic.action === "create" && r.automatic.sameAs) {
      const leader = rows.find((x) => x.key === (r.automatic as { sameAs: string }).sameAs)!;
      if (leader.automatic.action === "hold")
        r.automatic = { action: "hold", reason: `Same publisher as “${leader.name}”, which needs you` };
    }

  return { rows, evidence, ruleByPrefix, ignored };
}

/** A new house, as picker choice, created inside `atomic` */
function newHouse(name: string) {
  const id = randomUUID();
  return { id, name, slug: publisherSlug(name, id), kind: "publisher" as const };
}

export interface AutomaticResult {
  aliases: { name: string; publisher: string }[];
  created: { name: string; from: string }[];
  held: number;
  /** Editions of the decided names that now have a house */
  linked: number;
}

/**
 * Apply the automatic plan of every name (or of `keys`). `dryRun` only
 * reports. `brake` limits new houses to DAILY_AUTOMATIC_HOUSES per 24 hours
 * (the add-a-book path); `maxCreates` caps one run.
 */
export async function applyAutomaticDecisions(
  options: { keys?: string[]; dryRun?: boolean; brake?: boolean; maxCreates?: number } = {},
): Promise<AutomaticResult> {
  const { rows } = await loadNameInbox();
  const sameAs = (r: PublisherNameRow) =>
    r.automatic.action === "create" ? r.automatic.sameAs : undefined;
  // A name that joins a new house brings its leader, and the other way round
  let keys = options.keys ? new Set(options.keys) : null;
  if (keys) {
    const linked = new Set(keys);
    for (const r of rows)
      if (keys.has(r.key) && sameAs(r)) linked.add(sameAs(r)!);
    for (const r of rows) if (sameAs(r) && linked.has(sameAs(r)!)) linked.add(r.key);
    keys = linked;
  }
  const scope = keys ? rows.filter((r) => keys!.has(r.key)) : rows;
  let leaders = scope.filter((r) => r.automatic.action === "create" && !sameAs(r));
  const aliases = scope.filter((r) => r.automatic.action === "alias");
  let allowed = options.maxCreates ?? Infinity;
  if (options.brake) {
    const [{ recent }] = await db
      .select({ recent: count() })
      .from(publisherAutoDecisions)
      .where(
        and(
          eq(publisherAutoDecisions.action, "create"),
          gte(publisherAutoDecisions.createdAt, sql`now() - interval '24 hours'`),
        ),
      );
    allowed = Math.min(allowed, Math.max(0, DAILY_AUTOMATIC_HOUSES - recent));
  }
  leaders = leaders.slice(0, allowed);
  const houses = leaders.map((r) => ({
    row: r,
    house: newHouse((r.automatic as { name: string }).name),
  }));
  const houseFor = new Map(houses.map((h) => [h.row.key, h.house]));
  const joined = scope.filter((r) => sameAs(r) && houseFor.has(sameAs(r)!));
  const held = scope.length - aliases.length - houses.length - joined.length;
  const result: AutomaticResult = {
    aliases: [
      ...aliases.map((r) => ({
        name: r.name,
        publisher: (r.automatic as { publisher: PublisherOption }).publisher.name,
      })),
      ...joined.map((r) => ({ name: r.name, publisher: houseFor.get(sameAs(r)!)!.name })),
    ],
    created: houses.map((h) => ({ name: h.house.name, from: h.row.name })),
    held,
    linked: 0,
  };
  if (options.dryRun || (!houses.length && !aliases.length)) return result;

  const aliasRows = [
    ...aliases.map((r) => ({
      publisherId: (r.automatic as { publisher: PublisherOption }).publisher.id,
      name: r.name,
    })),
    // The source spelling stays a name of the house created from it
    ...houses
      .filter((h) => h.house.name !== h.row.name.trim())
      .map((h) => ({ publisherId: h.house.id, name: h.row.name })),
    ...joined.map((r) => ({ publisherId: houseFor.get(sameAs(r)!)!.id, name: r.name })),
  ];
  const decisions = [
    ...aliases.map((r) => ({
      nameKey: r.key,
      name: r.name,
      action: "alias",
      publisherId: (r.automatic as { publisher: PublisherOption }).publisher.id,
      reason: r.automatic.reason,
      editionCount: r.editions.length,
    })),
    ...houses.map((h) => ({
      nameKey: h.row.key,
      name: h.row.name,
      action: "create",
      publisherId: h.house.id,
      reason: h.row.automatic.reason,
      editionCount: h.row.editions.length,
    })),
    ...joined.map((r) => ({
      nameKey: r.key,
      name: r.name,
      action: "alias",
      publisherId: houseFor.get(sameAs(r)!)!.id,
      reason: r.automatic.reason,
      editionCount: r.editions.length,
    })),
  ];
  await atomic((d) => [
    ...(houses.length ? [d.insert(publishingHouses).values(houses.map((h) => h.house))] : []),
    ...(aliasRows.length ? [d.insert(publisherAliases).values(aliasRows).onConflictDoNothing()] : []),
    d.insert(publisherAutoDecisions).values(decisions),
  ]);

  const touched = [...aliases, ...leaders, ...joined].flatMap((r) => r.editions.map((e) => e.id));
  result.linked = touched.length
    ? resultRows<{ n: number }>(
        await db.execute(sql`select count(distinct edition_id)::int as n from edition_publishers
          where edition_id in (${sql.join(touched.map((id) => sql`${id}::uuid`), sql`, `)})`),
      )[0].n
    : 0;
  return result;
}

/**
 * The automatic path for editions just added or changed: decide their names
 * when it is safe, with the daily brake. Never throws: a failure leaves the
 * name for the inbox.
 */
export async function autoResolveEditions(editionIds: string[]) {
  try {
    if (!editionIds.length) return null;
    const keys = resultRows<{ key: string }>(
      await db.execute(sql`
        select distinct publisher_name_key(v) as key
        from editions e cross join lateral (values (e.publisher), (e.imprint)) as x(v)
        where e.id in (${sql.join(editionIds.map((id) => sql`${id}::uuid`), sql`, `)})
          and not e.publisher_links_confirmed
          and nullif(trim(v), '') is not null`),
    ).map((r) => r.key);
    if (!keys.length) return null;
    return await applyAutomaticDecisions({ keys, brake: true });
  } catch (err) {
    console.error("Automatic publisher decision failed", err);
    return null;
  }
}

/** Recent automatic decisions, newest first, with their house */
export async function listAutomaticDecisions(limit = 50) {
  return db
    .select({
      decision: publisherAutoDecisions,
      house: { name: publishingHouses.name, slug: publishingHouses.slug },
    })
    .from(publisherAutoDecisions)
    .leftJoin(publishingHouses, eq(publishingHouses.id, publisherAutoDecisions.publisherId))
    .orderBy(sql`${publisherAutoDecisions.createdAt} desc`, publisherAutoDecisions.name)
    .limit(limit);
}

/**
 * Undo an automatic decision. An alias is removed. A created house is deleted
 * with its automatic links, but only while nothing else depends on it: no
 * confirmed links, wanted editions, imprints, ISBN rules, favourite mark or
 * details you added, and it is still the house created then (not a merge
 * survivor). The name returns to the inbox and is never decided
 * automatically again.
 */
export async function undoAutomaticDecision(decisionId: string) {
  const [d] = await db
    .select()
    .from(publisherAutoDecisions)
    .where(eq(publisherAutoDecisions.id, decisionId));
  if (!d) throw new Error("Decision not found");
  if (d.undoneAt) throw new Error("This decision is already undone");
  if (!d.publisherId) {
    await db
      .update(publisherAutoDecisions)
      .set({ undoneAt: new Date() })
      .where(eq(publisherAutoDecisions.id, d.id));
    return;
  }
  if (d.action === "alias") {
    await atomic((tx) => [
      tx
        .delete(publisherAliases)
        .where(and(eq(publisherAliases.publisherId, d.publisherId!), eq(publisherAliases.name, d.name))),
      tx
        .update(publisherAutoDecisions)
        .set({ undoneAt: new Date() })
        .where(eq(publisherAutoDecisions.id, d.id)),
    ]);
    return;
  }
  const [blocker] = resultRows<{ reason: string | null }>(
    await db.execute(sql`
      select case
        when h.id is null then 'The house no longer exists'
        when abs(extract(epoch from h.created_at - d.created_at)) > 60 then 'Another house took its place (a merge): edit it instead'
        when exists (select 1 from edition_publishers ep join editions e on e.id = ep.edition_id where ep.publisher_id = h.id and e.publisher_links_confirmed) then 'Some books were linked to it by hand'
        when exists (select 1 from acquisition_targets t where t.publisher_id = h.id) then 'A wanted edition names it'
        when exists (select 1 from publishing_houses c where c.parent_id = h.id) then 'It has imprints'
        when exists (select 1 from publisher_isbn_prefixes p where p.publisher_id = h.id) then 'It has ISBN rules'
        when exists (select 1 from publishing_house_specialties s where s.publishing_house_id = h.id) then 'It has specialties'
        when h.is_favourite or h.country is not null or h.website is not null or h.description is not null or h.notes is not null then 'You added details to it'
        else null end as reason
      from publisher_auto_decisions d left join publishing_houses h on h.id = d.publisher_id
      where d.id = ${d.id}::uuid`),
  );
  if (blocker?.reason) throw new Error(`Cannot undo: ${blocker.reason.toLowerCase()}`);
  await atomic((tx) => [
    tx.execute(sql`delete from edition_publishers where publisher_id = ${d.publisherId}::uuid`),
    tx.delete(publishingHouses).where(eq(publishingHouses.id, d.publisherId!)),
    tx
      .update(publisherAutoDecisions)
      .set({ undoneAt: new Date() })
      .where(eq(publisherAutoDecisions.id, d.id)),
  ]);
}

