"use server";

import { z } from "zod";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  countries,
  publishingHouses as identities,
  publisherAliases as aliases,
  organizationRoles,
} from "@/lib/db/schema";
import { countryLookup, resolveCountry } from "@/lib/utils/countries";
import { resultRows, assertSql } from "@/lib/harmonization/store";
import { withReadableErrors } from "@/lib/db/errors";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import {
  COUNT_CAP,
  DIRECTORY_ROLES,
  NON_PUBLISHING_ROLES,
  PUBLISHING_LEVELS,
  type ContributionCounts,
  type DirectoryRole,
} from "@/lib/catalogue/organizations";
import { loadPerfumeCards } from "@/lib/catalogue/perfume-store";
import { loadFilmCards } from "@/lib/catalogue/film-store";
import { loadPaintingCards } from "@/lib/catalogue/painting-store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { textSearchCondition, textSearchRank } from "./utils/text-search";
import { deleteOrganization, saveOrganization } from "./organizations";

/** Works shown per group on an organization's page; each count is complete */
const SHOWN = 24;

function matches(query: string): SQL {
  const name = textSearchCondition(sql`o.search_text`, query);
  const alias = textSearchCondition(sql`a.search_text`, query);
  return name && alias
    ? sql`(${name} or exists (select 1 from publisher_aliases a where a.publisher_id = o.id and ${alias}))`
    : sql`true`;
}

function hasRole(role: DirectoryRole): SQL {
  return (PUBLISHING_LEVELS as readonly string[]).includes(role)
    ? sql`o.kind = ${role}`
    : sql`exists (select 1 from organization_roles r where r.organization_id = o.id and r.role = ${role})`;
}

/** Rows that link to the organization, counted up to just past the cap */
function bounded(rows: SQL) {
  return sql`(select count(*)::int from (${rows} limit ${COUNT_CAP + 1}) b)`;
}

/**
 * How many organizations hold each role, for the directory's role filter,
 * among those the search finds. One grouped query; a publishing group,
 * publisher or imprint profile counts as that role.
 */
export async function getOrganizationRoleCounts(query = "") {
  const q = z.string().trim().max(200).parse(query);
  const rows = resultRows<{ role: DirectoryRole | "all"; count: number }>(
    await db.execute(sql`select role, count(*)::int as count from (
        select o.kind as role from publishing_houses o where o.kind is not null and ${matches(q)}
        union all
        select r.role from publishing_houses o join organization_roles r on r.organization_id = o.id where ${matches(q)}
        union all
        select 'all' from publishing_houses o where ${matches(q)}
      ) roles group by role`),
  );
  const count = (role: string) => rows.find((r) => r.role === role)?.count ?? 0;
  return {
    all: count("all"),
    roles: Object.fromEntries(DIRECTORY_ROLES.map((role) => [role, count(role)])) as Record<
      DirectoryRole,
      number
    >,
  };
}

const directorySchema = z.object({
  query: z.string().trim().max(200).default(""),
  role: z.enum(DIRECTORY_ROLES).optional(),
  limit: z.number().int().min(1).max(200).default(48),
  offset: z.number().int().min(0).max(2_147_483_647).default(0),
});

/**
 * One page of the shared organization directory: every organization of every
 * collection, found by name or other name, optionally of one role, each with
 * its roles and bounded counts of what it takes part in. One query for the
 * rows and their counts, one for the total.
 */
export async function getOrganizationDirectory(input: z.input<typeof directorySchema> = {}) {
  const options = directorySchema.parse(input);
  const where = sql`${matches(options.query)} and ${options.role ? hasRole(options.role) : sql`true`}`;
  const order = options.query
    ? sql`${textSearchRank(sql`o.search_text`, sql`o.name`, options.query)} desc, o.name, o.id`
    : sql`o.name, o.id`;
  const [rows, totals] = await Promise.all([
    db
      .execute(sql`select o.id, o.name, o.slug, o.kind, o.country,
        coalesce((select array_agg(r.role order by r.role) from organization_roles r where r.organization_id = o.id), '{}') as roles,
        ${bounded(sql`select 1 from edition_publishers ep where ep.publisher_id = o.id`)} as editions,
        ${bounded(sql`select po.work_id from perfume_organizations po where po.organization_id = o.id
          union select rl.work_id from perfume_retailer_links rl where rl.organization_id = o.id`)} as perfumes,
        ${bounded(sql`select fo.work_id from film_organizations fo where fo.organization_id = o.id
          union select v.work_id from film_releases fr join film_versions v on v.id = fr.version_id where fr.distributor_id = o.id`)} as films,
        ${bounded(sql`select distinct ob.work_id from art_objects ob where ob.owner_organization_id = o.id`)} as paintings,
        ${bounded(sql`select distinct ov.venue_id from organization_venues ov where ov.organization_id = o.id`)} as venues,
        ${bounded(sql`select 1 from publishing_houses c where c.parent_id = o.id`)} as houses,
        ${bounded(sql`select 1 from acquisition_targets t where t.publisher_id = o.id`)} as wanted,
        ${bounded(sql`select 1 from perfume_bottles b where b.supplier_id = o.id
          union all select 1 from film_holdings h where h.supplier_id = o.id`)} as supplied
      from publishing_houses o where ${where}
      order by ${order} limit ${options.limit} offset ${options.offset}`)
      .then((r) =>
        resultRows<
          ContributionCounts & {
            id: string;
            name: string;
            slug: string;
            kind: DirectoryRole | null;
            country: string | null;
            roles: DirectoryRole[];
          }
        >(r),
      ),
    db
      .execute(sql`select count(*)::int as count from publishing_houses o where ${where}`)
      .then((r) => resultRows<{ count: number }>(r)),
  ]);
  return {
    total: totals[0]?.count ?? 0,
    rows: rows.map(
      ({ kind, roles, editions, houses, wanted, perfumes, films, paintings, venues, supplied, ...row }) => ({
        ...row,
        roles: [...(kind ? [kind] : []), ...roles],
        counts: { editions, houses, wanted, perfumes, films, paintings, venues, supplied },
      }),
    ),
  };
}
export type DirectoryOrganization = Awaited<
  ReturnType<typeof getOrganizationDirectory>
>["rows"][number];

type Listed = { id: string; kind: string; total: number };

/** The first works of a list, in title order, with the full count */
async function listed(ids: SQL) {
  const rows = resultRows<Listed>(
    await db.execute(sql`select w.id, w.kind, count(*) over ()::int as total
      from works w where w.id in (${ids})
      order by lower(w.title), w.id limit ${SHOWN}`),
  );
  return { rows, total: rows[0]?.total ?? 0 };
}

/**
 * Everything an organization takes part in, by collection and role: the
 * editions it publishes (with the houses above and under it), the perfumes it
 * makes, brands or sells, the films it produces or distributes, and the
 * paintings it owns or shows at its venues. Each list holds the first works
 * as cards; each count is complete. Works of a collection that is not open
 * are left out of the lists.
 */
export async function getOrganizationContributions(id: string) {
  z.uuid().parse(id);
  const at = sql`${id}::uuid`;
  const [publishing, perfumeRoles, listedPerfumes, produced, distributed, owned, shown, counts] =
    await Promise.all([
      db
        .execute(sql`with recursive family as (
            select id, 0 as depth from publishing_houses where id = ${at}
            union all select c.id, f.depth + 1 from publishing_houses c join family f on c.parent_id = f.id where f.depth < 3
          ) select
          (select count(*)::int from edition_publishers ep where ep.publisher_id = ${at}) as editions,
          (select count(distinct e.work_id)::int from edition_publishers ep join editions e on e.id = ep.edition_id where ep.publisher_id = ${at}) as books,
          (select count(*)::int from edition_publishers ep where ep.publisher_id in (select id from family)) as "familyEditions",
          (select count(distinct e.work_id)::int from edition_publishers ep join editions e on e.id = ep.edition_id
            where ep.publisher_id in (select id from family)) as "familyBooks",
          (select count(*)::int from acquisition_targets t where t.publisher_id = ${at}) as wanted,
          coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'kind', c.kind) order by c.name, c.id)
            from publishing_houses c where c.parent_id = ${at}), '[]') as children,
          (select jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug, 'kind', p.kind)
            from publishing_houses o join publishing_houses p on p.id = o.parent_id where o.id = ${at}) as parent`)
        .then(
          (r) =>
            resultRows<{
              editions: number;
              books: number;
              /** With the houses under it */
              familyEditions: number;
              familyBooks: number;
              wanted: number;
              children: { id: string; name: string; slug: string; kind: DirectoryRole | null }[];
              parent: { id: string; name: string; slug: string; kind: DirectoryRole | null } | null;
            }>(r)[0],
        ),
      db
        .execute(sql`select role, id, kind, total from (
          select po.role, w.id, w.kind, count(*) over (partition by po.role)::int as total,
            row_number() over (partition by po.role order by lower(w.title), w.id) as n
          from perfume_organizations po join works w on w.id = po.work_id where po.organization_id = ${at}
        ) x where n <= ${SHOWN} order by role, n`)
        .then((r) => resultRows<Listed & { role: "perfume_house" | "brand" | "manufacturer" }>(r)),
      listed(sql`select rl.work_id from perfume_retailer_links rl where rl.organization_id = ${at}`),
      listed(sql`select fo.work_id from film_organizations fo where fo.organization_id = ${at}`),
      listed(
        sql`select v.work_id from film_releases fr join film_versions v on v.id = fr.version_id where fr.distributor_id = ${at}`,
      ),
      listed(sql`select ob.work_id from art_objects ob where ob.owner_organization_id = ${at}`),
      listed(sql`select ob.work_id from art_object_whereabouts wh join art_objects ob on ob.id = wh.object_id
        where wh.certainty = 'confirmed' and wh.ends_on_id is null
        and wh.venue_id in (select ov.venue_id from organization_venues ov where ov.organization_id = ${at})`),
      db
        .execute(sql`select
          (select count(*)::int from perfume_retailer_links rl where rl.organization_id = ${at}) as listings,
          (select count(*)::int from perfume_bottles b where b.supplier_id = ${at}) as bottles,
          (select count(*)::int from film_holdings h where h.supplier_id = ${at}) as "filmCopies",
          (select count(*)::int from art_objects ob where ob.owner_organization_id = ${at}) as "ownedObjects"`)
        .then(
          (r) =>
            resultRows<{ listings: number; bottles: number; filmCopies: number; ownedObjects: number }>(r)[0],
        ),
    ]);

  const open = new Set<string>(getEnabledWorkKinds());
  const ids = (rows: Listed[]) => rows.filter((w) => open.has(w.kind)).map((w) => w.id);
  const roles = (["perfume_house", "brand", "manufacturer"] as const).map((role) => {
    const rows = perfumeRoles.filter((r) => r.role === role);
    return { role, ids: ids(rows), total: rows[0]?.total ?? 0 };
  });
  const perfumeIds = [...new Set([...roles.flatMap((r) => r.ids), ...ids(listedPerfumes.rows)])];
  const filmIds = [...new Set([...ids(produced.rows), ...ids(distributed.rows)])];
  const paintingIds = [...new Set([...ids(owned.rows), ...ids(shown.rows)])];
  const [perfumeCards, filmCards, paintingCards] = await Promise.all([
    loadPerfumeCards(perfumeIds),
    loadFilmCards(filmIds),
    loadPaintingCards(paintingIds),
  ]);
  const pick = <T extends { id: string }>(cards: T[], wanted: string[]) => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    return wanted.flatMap((w) => byId.get(w) ?? []);
  };
  return {
    publishing,
    perfumes: {
      roles: roles.map((r) => ({ role: r.role, total: r.total, cards: pick(perfumeCards, r.ids) })),
      listed: { total: listedPerfumes.total, cards: pick(perfumeCards, ids(listedPerfumes.rows)) },
      listings: counts.listings,
      bottles: counts.bottles,
    },
    films: {
      produced: { total: produced.total, cards: pick(filmCards, ids(produced.rows)) },
      distributed: { total: distributed.total, cards: pick(filmCards, ids(distributed.rows)) },
      copies: counts.filmCopies,
    },
    paintings: {
      owned: { total: owned.total, objects: counts.ownedObjects, cards: pick(paintingCards, ids(owned.rows)) },
      shown: { total: shown.total, cards: pick(paintingCards, ids(shown.rows)) },
    },
  };
}
export type OrganizationContributions = Awaited<ReturnType<typeof getOrganizationContributions>>;

const profileSchema = z.object({
  name: z.string().trim().min(1, "Give the organization a name").max(200),
  roles: z.array(z.enum(NON_PUBLISHING_ROLES)).max(NON_PUBLISHING_ROLES.length),
  country: z.string().trim().max(200).nullable().optional(),
  website: z
    .url({ protocol: /^https?$/, error: "Enter a web address that starts with http:// or https://" })
    .nullable()
    .optional(),
  description: z.string().max(10000).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
});
export type OrganizationProfileInput = z.input<typeof profileSchema>;

/**
 * Edits an organization from the shared directory: its name, other names,
 * country, website, description and its roles outside publishing. Its book
 * profile (group, publisher or imprint, and the house above it) stays as the
 * publisher page set it. A role that records still use cannot be removed;
 * the database says which collection holds them.
 */
export async function updateOrganizationProfile(id: string, input: OrganizationProfileInput) {
  z.uuid().parse(id);
  const { roles, aliases: names, ...fields } = profileSchema.parse(input);
  const [current, held, countryId] = await Promise.all([
    db.query.publishingHouses.findFirst({ where: eq(identities.id, id), columns: { kind: true } }),
    db
      .select({ role: organizationRoles.role })
      .from(organizationRoles)
      .where(eq(organizationRoles.organizationId, id)),
    countryIdFor(fields.country),
  ]);
  if (!current) throw new Error("Organization not found");
  if (!current.kind && roles.length === 0)
    throw new Error("Choose at least one role for this organization");
  // The paintings it owns keep it a museum or gallery once it is one
  const institution = (list: readonly string[]) => list.includes("museum") || list.includes("gallery");
  const keepsInstitution = !institution(held.map((r) => r.role)) || institution(roles);
  await withReadableErrors(() =>
    atomic((d) => [
      d.execute(sql`select id from publishing_houses where id = ${id}::uuid for update`),
      d.execute(
        assertSql(sql`exists (select 1 from publishing_houses where id = ${id}::uuid)`, "Organization not found"),
      ),
      ...(keepsInstitution
        ? []
        : [
            d.execute(
              assertSql(
                sql`not exists (select 1 from art_objects where owner_organization_id = ${id}::uuid)`,
                "This organization owns paintings; keep it a museum or a gallery",
              ),
            ),
          ]),
      d
        .update(identities)
        .set({ ...fields, countryId })
        .where(eq(identities.id, id)),
      d.delete(organizationRoles).where(eq(organizationRoles.organizationId, id)),
      ...(roles.length
        ? [
            d
              .insert(organizationRoles)
              .values([...new Set(roles)].map((role) => ({ organizationId: id, role }))),
          ]
        : []),
      d.delete(aliases).where(eq(aliases.publisherId, id)),
      ...(names.length
        ? [d.insert(aliases).values([...new Set(names)].map((name) => ({ publisherId: id, name })))]
        : []),
    ]),
  );
  invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.orders, CACHE_TAGS.venues);
  return { id };
}

/** The country a text names, matched as the publisher form matches it; none for a blank text */
async function countryIdFor(text: string | null | undefined) {
  if (!text?.trim()) return null;
  const rows = await db
    .select({ id: countries.id, name: countries.name, alpha2: countries.alpha2 })
    .from(countries);
  return resolveCountry(text, countryLookup(rows));
}

/**
 * Adds an organization from the directory, with roles outside publishing and
 * its country resolved from the text like a publisher's.
 */
export async function addOrganization(input: OrganizationProfileInput) {
  const { roles, aliases: names, ...fields } = profileSchema.parse(input);
  if (roles.length === 0) throw new Error("Choose at least one role for this organization");
  const countryId = await countryIdFor(fields.country);
  return saveOrganization({ ...fields, countryId, roles, aliases: names });
}

/**
 * Deletes an organization nothing links to. Editions, perfumes, films,
 * paintings, venues, copies, orders and the houses under it all keep it.
 */
export async function removeOrganization(id: string) {
  return withReadableErrors(() => deleteOrganization(id), {
    reference: "Records still link to this organization. Remove those links first.",
  });
}
