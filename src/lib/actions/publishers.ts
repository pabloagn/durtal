"use server";

import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { publisherCondition } from "@/lib/catalogue/publisher-boundary";
import { assertSql } from "@/lib/harmonization/store";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql, count } from "drizzle-orm";
import { z } from "zod/v4";
import { parsePagination } from "@/lib/utils/pagination";
import { compareWorks } from "@/lib/utils/title-order";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  publishingHouses as houses,
  publisherAliases,
  publisherSpecialties,
  publishingHouseSpecialties,
  editionPublishers,
  editions,
  works,
  acquisitionTargets,
  acquisitionTargetCopies,
  instances,
  locations,
  orders,
  countries,
  publisherIsbnPrefixes,
  publisherAutoDecisions,
} from "@/lib/db/schema";
import {
  publisherSchema,
  targetSchema,
  type PublisherInput,
  type TargetInput,
} from "@/lib/validations/publishers";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { targetState } from "@/lib/publishers/conditions";
import type { PosterImage } from "@/lib/utils/edition-image";
import { isbnPrefixLabel, publisherSlug } from "@/lib/publishers/names";
import {
  textSearchCondition,
  textSearchRank,
} from "@/lib/actions/utils/text-search";

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.orders);
}

/** The columns of a publisher choice in pickers and filters */
const publisherOptionColumns = {
  id: houses.id,
  name: houses.name,
  slug: houses.slug,
  country: houses.country,
  kind: houses.kind,
  parentId: houses.parentId,
  parentName: sql<
    string | null
  >`(select parent.name from publishing_houses parent where parent.id = "publishing_houses"."parent_id")`,
  /** The group above an imprint's publisher */
  groupName: sql<
    string | null
  >`(select g.name from publishing_houses parent join publishing_houses g on g.id = parent.parent_id where parent.id = "publishing_houses"."parent_id")`,
};

export async function getPublisherOptions() {
  return db
    .select(publisherOptionColumns)
    .from(houses)
    .where(publisherCondition)
    .orderBy(asc(houses.name), asc(houses.country), asc(houses.id));
}

/** Normalized name and aliases of a publisher, for the shared text search. */
const publisherHaystack = sql`search_normalize(${houses.name} || ' ' || coalesce((select string_agg(a.name, ' ') from publisher_aliases a where a.publisher_id = ${houses.id}), ''))`;

const publisherSearchSchema = z.object({
  query: z.string().max(200),
  kinds: z.array(z.enum(["group", "publisher", "imprint"])).max(3).optional(),
});

/**
 * Publisher picker search: the 10 best matches by name or alias, with the
 * same engine as the publishers list. A blank query returns nothing.
 */
export async function searchPublisherOptions(
  query: string,
  kinds?: ("group" | "publisher" | "imprint")[],
) {
  const o = publisherSearchSchema.parse({ query, kinds });
  const q = o.query.trim();
  const match = textSearchCondition(publisherHaystack, q);
  if (!match) return [];
  return db
    .select(publisherOptionColumns)
    .from(houses)
    .where(and(match, o.kinds?.length ? inArray(houses.kind, o.kinds) : undefined))
    .orderBy(
      desc(textSearchRank(publisherHaystack, sql`${houses.name}`, q)),
      asc(houses.name),
      asc(houses.id),
    )
    .limit(10);
}

/** A new publishing house from a name typed in a picker, as a picker choice */
export async function createPublisherFromName(name: string) {
  const saved = await savePublisher({ name });
  return {
    id: saved.id,
    name: saved.name,
    slug: saved.slug,
    country: saved.country,
    kind: saved.kind,
    parentId: saved.parentId,
    parentName: null,
    groupName: null,
  };
}
const publisherEditionCount = sql<number>`(select count(distinct ep.edition_id)::int from edition_publishers ep where ep.publisher_id in (select publisher_family("publishing_houses"."id")))`;

const publisherListSchema = z.object({
  search: z.string().max(200).optional(),
  sort: z.enum(["relevance", "name", "editions", "recent"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  favourites: z.boolean().optional(),
  kinds: z.array(z.enum(["group", "publisher", "imprint"])).max(3).optional(),
  countries: z.array(z.string().max(120)).max(100).optional(),
  page: z.number().int().optional(),
  perPage: z.number().int().optional(),
});
export type PublisherListOptions = z.input<typeof publisherListSchema>;

/**
 * Publisher list with the same search engine as authors (accent-insensitive,
 * typo-tolerant, ranked; names and aliases), sorts and filters.
 */
export async function getPublishers(options: PublisherListOptions = {}) {
  const o = publisherListSchema.parse(options);
  const paging = parsePagination({
    page: String(o.page ?? 1),
    perPage: String(o.perPage ?? 48),
  });
  const q = (o.search ?? "").trim();
  const sort = o.sort ?? (q ? "relevance" : "name");
  const defaultOrder = sort === "name" ? "asc" : "desc";
  const dir = (o.order ?? defaultOrder) === "asc" ? asc : desc;
  const where = and(
    publisherCondition,
    o.favourites ? eq(houses.isFavourite, true) : undefined,
    o.kinds?.length ? inArray(houses.kind, o.kinds) : undefined,
    // A publisher may list several countries ("United States; France")
    o.countries?.length
      ? sql`exists (select 1 from regexp_split_to_table(${houses.country}, '\\s*[;/]\\s*') c where trim(c) in (${sql.join(
          o.countries.map((c) => sql`${c}`),
          sql`, `,
        )}))`
      : undefined,
    textSearchCondition(publisherHaystack, q),
  );
  const orderBy =
    sort === "relevance" && q
      ? [
          dir(textSearchRank(publisherHaystack, sql`${houses.name}`, q)),
          asc(houses.name),
        ]
      : sort === "editions"
        ? [dir(publisherEditionCount), asc(houses.name)]
        : sort === "recent"
          ? [dir(houses.createdAt), asc(houses.name)]
          : [dir(sql`lower(${houses.name})`)];
  const [rows, [total]] = await Promise.all([
    db
      .select({
        publisher: houses,
        editionCount: publisherEditionCount,
        parentName: sql<
          string | null
        >`(select parent.name from publishing_houses parent where parent.id = "publishing_houses"."parent_id")`,
      })
      .from(houses)
      .where(where)
      .orderBy(...orderBy, asc(houses.id))
      .limit(paging.perPage)
      .offset(paging.offset),
    db.select({ count: count() }).from(houses).where(where),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      publisher: { ...row.publisher, kind: row.publisher.kind! },
    })),
    total: total.count,
  };
}

/** Single countries that publishers belong to, for the filter ("United States; France" counts for both). */
export async function getPublisherCountries() {
  const result = await db.execute(
    sql`select distinct trim(c) as country from publishing_houses, regexp_split_to_table(country, '\\s*[;/]\\s*') c where kind is not null and trim(c) <> '' order by 1`,
  );
  const rows = (Array.isArray(result) ? result : result.rows) as {
    country: string;
  }[];
  return rows.map((r) => r.country);
}

export async function getPublisher(slug: string) {
  const [publisher] = await db
    .select()
    .from(houses)
    .where(and(publisherCondition, eq(houses.slug, slug)));
  if (!publisher) return null;
  const [aliases, specialties, children, parent, prefixes, automatic] = await Promise.all([
    db
      .select()
      .from(publisherAliases)
      .where(eq(publisherAliases.publisherId, publisher.id))
      .orderBy(asc(publisherAliases.name)),
    db
      .select({ id: publisherSpecialties.id, name: publisherSpecialties.name })
      .from(publishingHouseSpecialties)
      .innerJoin(
        publisherSpecialties,
        eq(publisherSpecialties.id, publishingHouseSpecialties.specialtyId),
      )
      .where(eq(publishingHouseSpecialties.publishingHouseId, publisher.id)),
    db
      .select()
      .from(houses)
      .where(eq(houses.parentId, publisher.id))
      .orderBy(asc(houses.name)),
    publisher.parentId
      ? db.select().from(houses).where(eq(houses.id, publisher.parentId))
      : Promise.resolve([]),
    db
      .select({ prefix: publisherIsbnPrefixes.prefix })
      .from(publisherIsbnPrefixes)
      .where(eq(publisherIsbnPrefixes.publisherId, publisher.id))
      .orderBy(asc(publisherIsbnPrefixes.prefix)),
    db
      .select({ name: publisherAutoDecisions.name, createdAt: publisherAutoDecisions.createdAt })
      .from(publisherAutoDecisions)
      .where(
        and(
          eq(publisherAutoDecisions.publisherId, publisher.id),
          eq(publisherAutoDecisions.action, "create"),
          sql`${publisherAutoDecisions.undoneAt} is null`,
        ),
      ),
  ]);
  return {
    ...publisher,
    kind: publisher.kind!,
    aliases: aliases.map((a) => a.name),
    isbnPrefixes: prefixes.map((p) => isbnPrefixLabel(p.prefix)),
    /** Set when the automatic path created this house from book data */
    createdFrom: automatic[0] ?? null,
    specialtyIds: specialties.map((s) => s.id),
    specialties,
    children,
    parent: parent[0] ?? null,
    /** The group above this house's publisher (imprints only) */
    group: parent[0]?.parentId
      ? ((
          await db
            .select()
            .from(houses)
            .where(eq(houses.id, parent[0].parentId))
        )[0] ?? null)
      : null,
  };
}

export async function getPublisherSpecialties() {
  return db
    .select()
    .from(publisherSpecialties)
    .orderBy(asc(publisherSpecialties.name));
}

export async function savePublisher(input: PublisherInput, id?: string) {
  const parsed = publisherSchema.parse(input);
  const publisherId = id ? z.uuid().parse(id) : randomUUID();
  if (
    id &&
    !(
      await db
        .select({ id: houses.id })
        .from(houses)
        .where(and(publisherCondition, eq(houses.id, id)))
    ).length
  )
    throw new Error("Publisher not found");
  const { aliases, specialtyIds, isbnPrefixes, ...data } = parsed;
  const countryMatches = data.country
    ? await db
        .select({ id: countries.id })
        .from(countries)
        .where(sql`lower(${countries.name}) = lower(${data.country})`)
    : [];
  const countryId = countryMatches.length === 1 ? countryMatches[0].id : null;
  const slug = publisherSlug(data.name, publisherId);
  await atomic((d) => [
    ...(id
      ? [
          d.execute(
            sql`select id from publishing_houses where id=${publisherId}::uuid for update`,
          ),
          d.execute(
            assertSql(
              sql`exists (select 1 from publishing_houses where id=${publisherId}::uuid and kind is not null)`,
              "Publisher not found",
            ),
          ),
        ]
      : []),
    id
      ? d
          .update(houses)
          .set({ ...data, countryId })
          .where(eq(houses.id, publisherId))
      : d.insert(houses).values({ ...data, countryId, id: publisherId, slug }),
    d
      .delete(publisherAliases)
      .where(eq(publisherAliases.publisherId, publisherId)),
    ...(aliases.length
      ? [
          d
            .insert(publisherAliases)
            .values(
              [...new Set(aliases)].map((name) => ({ publisherId, name })),
            ),
        ]
      : []),
    ...(isbnPrefixes
      ? [
          d
            .delete(publisherIsbnPrefixes)
            .where(eq(publisherIsbnPrefixes.publisherId, publisherId)),
          ...(isbnPrefixes.length
            ? [
                d
                  .insert(publisherIsbnPrefixes)
                  .values(
                    [...new Set(isbnPrefixes)].map((prefix) => ({
                      prefix,
                      publisherId,
                    })),
                  )
                  .onConflictDoUpdate({
                    target: publisherIsbnPrefixes.prefix,
                    set: { publisherId },
                  }),
              ]
            : []),
        ]
      : []),
    d
      .delete(publishingHouseSpecialties)
      .where(eq(publishingHouseSpecialties.publishingHouseId, publisherId)),
    ...(specialtyIds.length
      ? [
          d.insert(publishingHouseSpecialties).values(
            [...new Set(specialtyIds)].map((specialtyId) => ({
              publishingHouseId: publisherId,
              specialtyId,
            })),
          ),
        ]
      : []),
  ]);
  changed();
  return (await db.select().from(houses).where(eq(houses.id, publisherId)))[0];
}

export async function setPublisherFavourite(id: string, favourite: boolean) {
  const [row] = await db
    .update(houses)
    .set({ isFavourite: z.boolean().parse(favourite) })
    .where(and(publisherCondition, eq(houses.id, z.uuid().parse(id))))
    .returning({ id: houses.id });
  if (!row) throw new Error("Publisher not found");
  changed();
}

export async function getEditionPublisherLinks(editionId: string) {
  return db
    .select({ publisher: houses })
    .from(editionPublishers)
    .innerJoin(houses, eq(houses.id, editionPublishers.publisherId))
    .where(eq(editionPublishers.editionId, z.uuid().parse(editionId)))
    .orderBy(asc(houses.name));
}

/** Other unconfirmed editions whose publisher or imprint text is `name` */
function sameNameEditions(name: string, editionId: string) {
  const key = sql`publisher_name_key(${name})`;
  return and(
    sql`${editions.id} <> ${editionId}`,
    eq(editions.publisherLinksConfirmed, false),
    or(
      sql`publisher_name_key(${editions.publisher}) = ${key}`,
      sql`publisher_name_key(${editions.imprint}) = ${key}`,
    ),
  );
}

/**
 * The edition's publisher and imprint text that no publishing house or alias
 * matches, with the number of other unconfirmed editions that use the same
 * text. Saving such a name as an alias links those editions too.
 */
export async function getUnmatchedEditionNames(editionId: string) {
  const id = z.uuid().parse(editionId);
  const result = await db.execute(sql`
    select n.name,
      (select count(*)::int from editions o where o.id <> e.id and not o.publisher_links_confirmed
        and (publisher_name_key(o.publisher) = publisher_name_key(n.name)
          or publisher_name_key(o.imprint) = publisher_name_key(n.name))) as others
    from editions e
    cross join lateral (
      select distinct on (publisher_name_key(v)) trim(v) as name
      from (values (e.publisher), (e.imprint)) as x(v)
      where nullif(trim(v), '') is not null
    ) n
    where e.id = ${id} and not exists (select 1 from publisher_candidates(n.name))
    order by n.name`);
  return (Array.isArray(result) ? result : result.rows) as {
    name: string;
    others: number;
  }[];
}

/**
 * Confirm an edition's publishing houses. With one house, `aliases` saves the
 * edition's unmatched publisher or imprint text as other names of that house,
 * so every unconfirmed edition with the same text links too. A name that
 * already matches a house or alias is never added: it would make that match
 * ambiguous and remove its links. Returns how many other editions now link to
 * the house through the new aliases.
 */
export async function setEditionPublisherLinks(
  editionId: string,
  publisherIds: string[],
  aliases: string[] = [],
) {
  z.uuid().parse(editionId);
  const ids = z.array(z.uuid()).max(20).parse(publisherIds);
  const requested = z.array(z.string().trim().min(1).max(200)).max(2).parse(aliases);
  const unmatched = requested.length ? await getUnmatchedEditionNames(editionId) : [];
  const names = requested.filter((n) => unmatched.some((u) => u.name === n));
  if (names.length !== requested.length)
    throw new Error("Only an unmatched name of this edition can become an alias");
  if (names.length && ids.length !== 1)
    throw new Error("Choose exactly one publisher to save a name as its alias");
  await atomic((d) => [
    ...(names.length
      ? [
          d
            .insert(publisherAliases)
            .values(names.map((name) => ({ publisherId: ids[0], name })))
            .onConflictDoNothing(),
        ]
      : []),
    d.execute(
      sql`select set_edition_publishers(${editionId}::uuid, ARRAY(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid))`,
    ),
  ]);
  changed();
  if (!names.length) return { linkedElsewhere: 0 };
  const [{ linked }] = await db
    .select({ linked: count() })
    .from(editions)
    .where(
      and(
        or(...names.map((name) => sameNameEditions(name, editionId))),
        sql`exists (select 1 from edition_publishers ep where ep.edition_id = ${editions.id} and ep.publisher_id = ${ids[0]})`,
      ),
    );
  return { linkedElsewhere: linked };
}

export async function resetEditionPublisherLinks(editionId: string) {
  await db
    .update(editions)
    .set({ publisherLinksConfirmed: false })
    .where(eq(editions.id, z.uuid().parse(editionId)));
  changed();
}

export async function getAcquisitionTargets(workId: string) {
  const targets = await db
    .select({
      target: acquisitionTargets,
      state: targetState,
      publisher: houses,
      edition: editions,
    })
    .from(acquisitionTargets)
    .leftJoin(houses, eq(houses.id, acquisitionTargets.publisherId))
    .leftJoin(editions, eq(editions.id, acquisitionTargets.editionId))
    .where(
      and(
        eq(acquisitionTargets.workId, z.uuid().parse(workId)),
        eq(acquisitionTargets.isCancelled, false),
      ),
    )
    .orderBy(asc(acquisitionTargets.createdAt));
  const [copies, linkedOrders] = await Promise.all([
    db
      .select({
        targetId: acquisitionTargets.id,
        instanceId: instances.id,
        title: editions.title,
        publisher: editions.publisher,
        location: locations.name,
      })
      .from(acquisitionTargets)
      .innerJoin(
        editions,
        sql`target_accepts_edition(${acquisitionTargets.id},${editions.id})`,
      )
      .innerJoin(instances, eq(instances.editionId, editions.id))
      .innerJoin(locations, eq(locations.id, instances.locationId))
      .where(
        and(
          eq(acquisitionTargets.workId, workId),
          sql`${instances.status} <> 'deaccessioned'`,
        ),
      ),
    db
      .select({
        id: orders.id,
        targetId: orders.acquisitionTargetId,
        status: orders.status,
        date: orders.orderDate,
      })
      .from(orders)
      .where(
        and(
          eq(orders.workId, workId),
          sql`${orders.acquisitionTargetId} is not null`,
        ),
      )
      .orderBy(desc(orders.orderDate)),
  ]);
  return targets.map((t) => ({
    ...t,
    copies: copies.filter((c) => c.targetId === t.target.id),
    orders: linkedOrders.filter((o) => o.targetId === t.target.id),
  }));
}

export async function createAcquisitionTarget(input: TargetInput) {
  const data = targetSchema.parse(input);
  await requireBookWork(data.workId);
  const [row] = await db
    .insert(acquisitionTargets)
    .values(data)
    .onConflictDoNothing()
    .returning();
  if (!row) throw new Error("This acquisition target already exists");
  changed();
  return row;
}

export async function cancelAcquisitionTarget(id: string) {
  const [row] = await db
    .update(acquisitionTargets)
    .set({ isCancelled: true })
    .where(eq(acquisitionTargets.id, z.uuid().parse(id)))
    .returning();
  if (!row) throw new Error("Target not found");
  changed();
}

export async function getOrderAcquisitionOptions(workId: string) {
  const [targets, availableEditions] = await Promise.all([
    getAcquisitionTargets(workId),
    db
      .select({
        id: editions.id,
        title: editions.title,
        publisher: editions.publisher,
        isbn13: editions.isbn13,
        language: editions.language,
        publicationYear: editions.publicationYear,
      })
      .from(editions)
      .where(eq(editions.workId, z.uuid().parse(workId)))
      .orderBy(asc(editions.title), asc(editions.id)),
  ]);
  const matches = await db
    .select({ targetId: acquisitionTargets.id, editionId: editions.id })
    .from(acquisitionTargets)
    .innerJoin(
      editions,
      sql`target_accepts_edition(${acquisitionTargets.id}, ${editions.id})`,
    )
    .where(eq(acquisitionTargets.workId, workId));
  return { targets, editions: availableEditions, matches };
}

export async function getPublisherCatalogue(
  id: string,
  filter = "all",
  page = 1,
  perPage = 24,
) {
  const paging = parsePagination(
    { page: String(page), perPage: String(perPage) },
    { defaultPerPage: 24 },
  );
  z.uuid().parse(id);
  z.enum(["all", "owned", "wanted", "on_order"]).parse(filter);
  const belongs = sql`exists (select 1 from edition_publishers ep where ep.edition_id = ${editions.id} and ep.publisher_id in (select publisher_family(${id}::uuid)))`;
  const owned = sql<boolean>`exists (select 1 from instances i where i.edition_id = ${editions.id} and i.status <> 'deaccessioned')`;
  const onOrder = sql<boolean>`exists (select 1 from orders o where o.edition_id = ${editions.id} and o.status not in ('cancelled', 'returned', 'delivered', 'received', 'purchased'))`;
  const wanted = sql<boolean>`(exists (select 1 from acquisition_targets where work_id = ${editions.workId} and target_accepts_edition(id, ${editions.id}) and (${targetState}) = 'wanted')
    or (exists (select 1 from works w where w.id = ${editions.workId} and w.catalogue_status in ('wanted', 'shortlisted'))
      and not exists (select 1 from acquisition_targets t where t.work_id = ${editions.workId} and not t.is_cancelled)))`;
  const condition = and(
    belongs,
    filter === "owned"
      ? owned
      : filter === "wanted"
        ? wanted
        : filter === "on_order"
          ? onOrder
          : undefined,
  );
  const matchingWorks = db
    .selectDistinct({ id: editions.workId, title: works.title })
    .from(editions)
    .innerJoin(works, eq(works.id, editions.workId))
    .where(condition);
  const [allWorks, [totals], pendingTargets] = await Promise.all([
    matchingWorks,
    db
      .select({
        works: sql<number>`count(distinct ${editions.workId})::int`,
        editions: count(),
      })
      .from(editions)
      .where(condition),
    db
      .select({
        target: acquisitionTargets,
        work: works,
        state: targetState,
        publisher: houses,
      })
      .from(acquisitionTargets)
      .innerJoin(works, eq(works.id, acquisitionTargets.workId))
      .innerJoin(houses, eq(houses.id, acquisitionTargets.publisherId))
      .where(
        and(
          sql`${houses.id} in (select publisher_family(${id}::uuid))`,
          eq(acquisitionTargets.isCancelled, false),
          sql`(${targetState}) <> 'received'`,
        ),
      )
      .orderBy(asc(works.title)),
  ]);
  const workRows = allWorks
    .sort(compareWorks)
    .slice(paging.offset, paging.offset + paging.perPage);
  const rows = workRows.length
    ? await db
        .select({
          edition: editions,
          work: works,
          owned,
          onOrder,
          wanted,
          authors: sql<string>`(select string_agg(a.name, ', ' order by wa.sort_order) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${works.id})`,
          // The book's active poster: the image of an edition without a cover
          poster: sql<PosterImage | null>`(select json_build_object('s3Key', m.s3_key, 'thumbnailS3Key', m.thumbnail_s3_key, 'cropX', m.crop_x, 'cropY', m.crop_y, 'cropZoom', m.crop_zoom, 'brightness', m.brightness, 'contrast', m.contrast) from media m where m.work_id = ${works.id} and m.type = 'poster' and m.is_active order by m.created_at, m.id limit 1)`,
        })
        .from(editions)
        .innerJoin(works, eq(works.id, editions.workId))
        .where(
          and(
            condition,
            inArray(
              editions.workId,
              workRows.map((w) => w.id),
            ),
          ),
        )
        .orderBy(
          asc(works.title),
          asc(editions.publicationYear),
          asc(editions.id),
        )
    : [];
  return {
    rows: rows.sort((a, b) => compareWorks(a.work, b.work)),
    totals,
    pendingTargets:
      filter === "owned"
        ? []
        : pendingTargets.filter((t) => filter === "all" || t.state === filter),
  };
}

export async function getTargetOrderSeed(id: string) {
  z.uuid().parse(id);
  const [target] = await db
    .select()
    .from(acquisitionTargets)
    .where(
      and(
        eq(acquisitionTargets.id, id),
        eq(acquisitionTargets.isCancelled, false),
      ),
    );
  if (!target) return null;
  const work = await db.query.works.findFirst({
    where: eq(works.id, target.workId),
    with: { workAuthors: { with: { author: true } }, media: true },
  });
  if (!work) return null;
  return { target, work: { ...work, slug: work.slug ?? "" } };
}

export async function fulfilTargetWithCopy(
  targetId: string,
  instanceId: string,
) {
  z.uuid().parse(targetId);
  z.uuid().parse(instanceId);
  await atomic((d) => [
    d
      .insert(acquisitionTargetCopies)
      .values({ targetId, instanceId })
      .onConflictDoUpdate({
        target: acquisitionTargetCopies.targetId,
        set: { instanceId },
      }),
    d.execute(sql`insert into work_status_history (work_id,from_status,to_status,notes)
      select w.id,w.catalogue_status,'accessioned','Acquisition target fulfilled with an owned copy'
      from works w join acquisition_targets t on t.work_id=w.id where t.id=${targetId} and w.catalogue_status <> 'accessioned'`),
    d
      .update(works)
      .set({ catalogueStatus: "accessioned", updatedAt: new Date() })
      .where(
        sql`${works.id} = (select work_id from acquisition_targets where id=${targetId}) and ${works.catalogueStatus} <> 'accessioned'`,
      ),
  ]);
  changed();
}

export async function getAcquisitionTargetsForExport(workIds: string[]) {
  const ids = z.array(z.uuid()).min(1).max(500).parse(workIds);
  return db
    .select({
      target: acquisitionTargets,
      state: targetState,
      instanceId: acquisitionTargetCopies.instanceId,
    })
    .from(acquisitionTargets)
    .leftJoin(
      acquisitionTargetCopies,
      eq(acquisitionTargetCopies.targetId, acquisitionTargets.id),
    )
    .where(inArray(acquisitionTargets.workId, ids));
}
