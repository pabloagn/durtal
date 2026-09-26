"use server";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql, count } from "drizzle-orm";
import { z } from "zod/v4";
import { parsePagination } from "@/lib/utils/pagination";
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
} from "@/lib/db/schema";
import {
  publisherSchema,
  targetSchema,
  type PublisherInput,
  type TargetInput,
} from "@/lib/validations/publishers";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { targetState } from "@/lib/publishers/conditions";

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.orders);
}

export async function getPublisherOptions() {
  return db
    .select({
      id: houses.id,
      name: houses.name,
      slug: houses.slug,
      country: houses.country,
      kind: houses.kind,
      parentId: houses.parentId,
      parentName: sql<
        string | null
      >`(select parent.name from publishing_houses parent where parent.id = "publishing_houses"."parent_id")`,
    })
    .from(houses)
    .orderBy(asc(houses.name), asc(houses.country), asc(houses.id));
}

export async function getPublishers(search = "", favourites = false, page = 1, perPage = 48) {
  const paging = parsePagination({ page: String(page), perPage: String(perPage) });
  const q = z.string().max(200).parse(search).trim();
  const where = and(
    favourites ? eq(houses.isFavourite, true) : undefined,
    q
      ? sql`(strpos(lower(${houses.name}), lower(${q})) > 0 or exists (select 1 from publisher_aliases a where a.publisher_id = ${houses.id} and strpos(lower(a.name), lower(${q})) > 0))`
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        publisher: houses,
        editionCount: sql<number>`(select count(distinct ep.edition_id)::int from edition_publishers ep join publishing_houses p on p.id = ep.publisher_id where p.id = "publishing_houses"."id" or p.parent_id = "publishing_houses"."id")`,
      })
      .from(houses)
      .where(where)
      .orderBy(desc(houses.isFavourite), asc(houses.name), asc(houses.id))
      .limit(paging.perPage)
      .offset(paging.offset),
    db.select({ count: count() }).from(houses).where(where),
  ]);
  return { rows, total: total.count };
}

export async function getPublisher(slug: string) {
  const [publisher] = await db
    .select()
    .from(houses)
    .where(eq(houses.slug, slug));
  if (!publisher) return null;
  const [aliases, specialties, children, parent] = await Promise.all([
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
  ]);
  return {
    ...publisher,
    aliases: aliases.map((a) => a.name),
    specialtyIds: specialties.map((s) => s.id),
    specialties,
    children,
    parent: parent[0] ?? null,
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
    !(await db.select({ id: houses.id }).from(houses).where(eq(houses.id, id)))
      .length
  )
    throw new Error("Publisher not found");
  const { aliases, specialtyIds, ...data } = parsed;
  const countryMatches = data.country
    ? await db
        .select({ id: countries.id })
        .from(countries)
        .where(sql`lower(${countries.name}) = lower(${data.country})`)
    : [];
  const countryId = countryMatches.length === 1 ? countryMatches[0].id : null;
  const slug = `${
    data.name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "publisher"
  }-${publisherId.slice(0, 8)}`;
  await atomic((d) => [
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
    .where(eq(houses.id, z.uuid().parse(id)))
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

export async function setEditionPublisherLinks(
  editionId: string,
  publisherIds: string[],
) {
  z.uuid().parse(editionId);
  const ids = z.array(z.uuid()).max(20).parse(publisherIds);
  await db.execute(
    sql`select set_edition_publishers(${editionId}::uuid, ARRAY(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid))`,
  );
  changed();
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
  const paging = parsePagination({ page: String(page), perPage: String(perPage) }, { defaultPerPage: 24 });
  z.uuid().parse(id);
  z.enum(["all", "owned", "wanted", "on_order"]).parse(filter);
  const belongs = sql`exists (select 1 from edition_publishers ep join publishing_houses p on p.id = ep.publisher_id where ep.edition_id = ${editions.id} and (p.id = ${id} or p.parent_id = ${id}))`;
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
  const workPage = db
    .selectDistinct({ workId: editions.workId, title: works.title })
    .from(editions)
    .innerJoin(works, eq(works.id, editions.workId))
    .where(condition)
    .orderBy(asc(works.title), asc(editions.workId))
    .limit(paging.perPage)
    .offset(paging.offset);
  const [workRows, [totals], pendingTargets] = await Promise.all([
    workPage,
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
          or(eq(houses.id, id), eq(houses.parentId, id)),
          eq(acquisitionTargets.isCancelled, false),
          sql`(${targetState}) <> 'received'`,
        ),
      )
      .orderBy(asc(works.title)),
  ]);
  const rows = workRows.length
    ? await db
        .select({
          edition: editions,
          work: works,
          owned,
          onOrder,
          wanted,
          authors: sql<string>`(select string_agg(a.name, ', ' order by wa.sort_order) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${works.id})`,
        })
        .from(editions)
        .innerJoin(works, eq(works.id, editions.workId))
        .where(
          and(
            condition,
            inArray(
              editions.workId,
              workRows.map((w) => w.workId),
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
    rows,
    totals,
    pendingTargets:
      filter === "owned"
        ? []
        : pendingTargets.filter((t) => filter === "all" || t.state === filter),
  };
}

export async function getPublisherReview(page = 1, perPage = 24) {
  const paging = parsePagination({ page: String(page), perPage: String(perPage) }, { defaultPerPage: 24 });
  const condition = and(
    eq(editions.publisherLinksConfirmed, false),
    sql`exists (select 1 from (values (${editions.publisher}), (${editions.imprint})) names(name) where nullif(trim(name), '') is not null and (select count(*) from publisher_candidates(name)) <> 1)`,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ edition: editions, work: works })
      .from(editions)
      .innerJoin(works, eq(works.id, editions.workId))
      .where(condition)
      .orderBy(asc(works.title), asc(editions.id))
      .limit(paging.perPage)
      .offset(paging.offset),
    db.select({ count: count() }).from(editions).where(condition),
  ]);
  return { rows, total: total.count };
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
