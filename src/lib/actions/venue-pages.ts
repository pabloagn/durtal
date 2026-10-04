"use server";

import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { withReadableErrors } from "@/lib/db/errors";
import { loadDates } from "@/lib/catalogue/work-store";
import { catalogueDateText } from "@/lib/catalogue/dates";
import { retailerObservationAge, type RETAILER_AVAILABILITY } from "@/lib/catalogue/retailers";
import type {
  ArtObjectKind,
  ArtOwnership,
  DisplayStatus,
  WhereaboutsCertainty,
  WhereaboutsCustody,
  WhereaboutsPlace,
} from "@/lib/catalogue/painting-labels";
import type { PerfumeConcentration, PerfumeContainer } from "@/lib/catalogue/perfume-labels";
import type { VenueType } from "@/lib/catalogue/venues";
import { archiveVenue, deleteVenue } from "./venues";
import { linkOrganizationVenue, unlinkOrganizationVenue } from "./organizations";

/** Rows a venue page lists per part; each part says when there are more */
const LISTED = 100;

/**
 * The institutions that run or own a venue, each with its roles and its other
 * venues (the branches). A museum can run several venues; one venue can have
 * an operator and a different owner.
 */
export async function getVenueInstitutions(venueId: string) {
  z.uuid().parse(venueId);
  return resultRows<{
    id: string;
    name: string;
    slug: string;
    kind: string | null;
    role: "operator" | "owner";
    roles: string[];
    branches: { id: string; name: string; slug: string | null; type: VenueType; archived: boolean }[];
  }>(
    await db.execute(sql`select o.id, o.name, o.slug, o.kind, ov.role,
        coalesce((select array_agg(r.role order by r.role) from organization_roles r where r.organization_id = o.id), '{}') as roles,
        coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug, 'type', v.type, 'archived', v.archived_at is not null) order by v.name, v.id)
          from venues v where v.id <> ${venueId}::uuid
          and v.id in (select b.venue_id from organization_venues b where b.organization_id = o.id)), '[]') as branches
      from organization_venues ov join publishing_houses o on o.id = ov.organization_id
      where ov.venue_id = ${venueId}::uuid order by o.name, o.id, ov.role`),
  );
}

interface ArtRow {
  whereaboutsId: string | null;
  objectId: string;
  objectKind: ArtObjectKind;
  objectLabel: string | null;
  ownership: ArtOwnership;
  ownerLabel: string | null;
  ownerName: string | null;
  ownerSlug: string | null;
  workId: string;
  title: string;
  slug: string | null;
  placeKind: WhereaboutsPlace | null;
  placeLabel: string | null;
  venueName: string | null;
  venueSlug: string | null;
  custody: WhereaboutsCustody | null;
  displayStatus: DisplayStatus | null;
  certainty: WhereaboutsCertainty | null;
  occasionLabel: string | null;
  startsOnId: string | null;
  verifiedAt: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
}

const ART_COLUMNS = sql`ob.id as "objectId", ob.kind as "objectKind", ob.label as "objectLabel",
  ob.ownership, ob.owner_label as "ownerLabel", ow.name as "ownerName", ow.slug as "ownerSlug",
  w.id as "workId", w.title, w.slug,
  wh.id as "whereaboutsId", wh.place_kind as "placeKind", wh.place_label as "placeLabel",
  wv.name as "venueName", wv.slug as "venueSlug",
  wh.custody, wh.display_status as "displayStatus", wh.certainty, wh.occasion_label as "occasionLabel",
  wh.starts_on_id as "startsOnId", wh.verified_at as "verifiedAt",
  coalesce(sr.attribution, sr.provider) as "sourceLabel", sr.url as "sourceUrl"`;

/**
 * The art at a venue, without assumptions: what is here now (every open
 * whereabouts record at this venue, with its custody, certainty, display
 * state, start date and source as recorded) apart from what its institutions
 * own that is elsewhere now or has no recorded place. A museum holding is
 * never read as on display.
 */
export async function getVenueArt(venueId: string) {
  z.uuid().parse(venueId);
  const at = sql`${venueId}::uuid`;
  const [here, away, counts] = await Promise.all([
    db
      .execute(sql`select ${ART_COLUMNS}
        from art_object_whereabouts wh join art_objects ob on ob.id = wh.object_id join works w on w.id = ob.work_id
        left join publishing_houses ow on ow.id = ob.owner_organization_id
        left join venues wv on wv.id = wh.venue_id
        left join source_records sr on sr.id = wh.source_record_id
        where wh.venue_id = ${at} and wh.ends_on_id is null
        order by (wh.certainty = 'confirmed') desc, lower(w.title), ob.id limit ${LISTED}`)
      .then((r) => resultRows<ArtRow>(r)),
    // The object's current place: the confirmed open record, else the latest open one
    db
      .execute(sql`select ${ART_COLUMNS}
        from art_objects ob join works w on w.id = ob.work_id
        join publishing_houses ow on ow.id = ob.owner_organization_id
        left join lateral (select * from art_object_whereabouts x where x.object_id = ob.id and x.ends_on_id is null
          order by (x.certainty = 'confirmed') desc, x.recorded_at desc, x.id limit 1) wh on true
        left join venues wv on wv.id = wh.venue_id
        left join source_records sr on sr.id = wh.source_record_id
        where ob.owner_organization_id in (select organization_id from organization_venues where venue_id = ${at})
        and (wh.id is null or wh.venue_id is distinct from ${at})
        order by lower(w.title), ob.id limit ${LISTED}`)
      .then((r) => resultRows<ArtRow>(r)),
    db
      .execute(sql`select
        (select count(*)::int from art_object_whereabouts wh where wh.venue_id = ${at} and wh.ends_on_id is null) as here,
        (select count(*)::int from art_objects ob
          left join lateral (select x.venue_id, x.id from art_object_whereabouts x where x.object_id = ob.id and x.ends_on_id is null
            order by (x.certainty = 'confirmed') desc, x.recorded_at desc, x.id limit 1) wh on true
          where ob.owner_organization_id in (select organization_id from organization_venues where venue_id = ${at})
          and (wh.id is null or wh.venue_id is distinct from ${at})) as away`)
      .then((r) => resultRows<{ here: number; away: number }>(r)[0]),
  ]);
  const dates = await loadDates([...here, ...away].map((row) => row.startsOnId));
  const view = (row: ArtRow) => ({
    ...row,
    since: row.startsOnId ? catalogueDateText(dates.get(row.startsOnId) ?? null) : null,
  });
  return {
    here: { total: counts.here, rows: here.map(view) },
    away: { total: counts.away, rows: away.map(view) },
  };
}
export type VenueArt = Awaited<ReturnType<typeof getVenueArt>>;

/**
 * The fragrances a retailer sells at this venue (listings for this branch)
 * and, for the retailer that runs it, its listings with no branch (online).
 * Each listing has its formulation and its last dated observation; an
 * observation is a day's record, never a promise of stock.
 */
export async function getVenueRetail(venueId: string) {
  z.uuid().parse(venueId);
  const at = sql`${venueId}::uuid`;
  const rows = resultRows<{
    id: string;
    url: string;
    archivedAt: string | null;
    venueId: string | null;
    workId: string;
    title: string;
    slug: string | null;
    retailerName: string;
    concentration: PerfumeConcentration | null;
    concentrationLabel: string | null;
    formulationLabel: string | null;
    hasVariant: boolean;
    checkedAt: string | null;
    availability: (typeof RETAILER_AVAILABILITY)[number] | null;
    price: string | null;
    currency: string | null;
    container: PerfumeContainer | null;
    capacityMl: string | null;
    packageLabel: string | null;
    total: number;
  }>(
    await db.execute(sql`select l.id, l.url, l.archived_at as "archivedAt", l.venue_id as "venueId",
        w.id as "workId", w.title, w.slug, o.name as "retailerName",
        pv.concentration, pv.concentration_label as "concentrationLabel", pv.formulation_label as "formulationLabel",
        pv.id is not null as "hasVariant",
        ob.checked_at as "checkedAt", ob.availability, ob.price, ob.currency, ob.container,
        ob.capacity_ml as "capacityMl", ob.package_label as "packageLabel",
        count(*) over ()::int as total
      from perfume_retailer_links l join works w on w.id = l.work_id
      join publishing_houses o on o.id = l.organization_id
      left join perfume_variants pv on pv.id = l.variant_id
      left join lateral (select * from perfume_retailer_observations x where x.link_id = l.id
        order by x.checked_at desc, x.recorded_at desc, x.id limit 1) ob on true
      where l.venue_id = ${at}
        or (l.venue_id is null and l.organization_id in
          (select organization_id from organization_venues where venue_id = ${at} and role = 'operator'))
      order by (l.archived_at is not null), (l.venue_id is null), lower(w.title), l.id limit ${LISTED}`),
  );
  const now = new Date();
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map(({ total: _total, price, capacityMl, ...row }) => ({
      ...row,
      price: price === null ? null : Number(price),
      capacityMl: capacityMl === null ? null : Number(capacityMl),
      ...retailerObservationAge(row.checkedAt, now),
    })),
  };
}
export type VenueRetail = Awaited<ReturnType<typeof getVenueRetail>>;

/** Orders placed at this venue, newest first, with the full count */
export async function getVenueOrders(venueId: string) {
  z.uuid().parse(venueId);
  const rows = resultRows<{
    id: string;
    orderDate: string;
    status: string;
    price: string | null;
    currency: string | null;
    workId: string;
    title: string;
    slug: string | null;
    total: number;
  }>(
    await db.execute(sql`select o.id, o.order_date as "orderDate", o.status, coalesce(o.total_cost, o.price) as price, o.currency,
        w.id as "workId", coalesce(e.title, w.title) as title, w.slug, count(*) over ()::int as total
      from orders o join works w on w.id = o.work_id left join editions e on e.id = o.edition_id
      where o.venue_id = ${venueId}::uuid order by o.order_date desc, o.id limit 50`),
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map(({ total: _total, price, ...row }) => ({ ...row, price: price === null ? null : Number(price) })),
  };
}

/**
 * Everything that refers to a venue, counted: orders, copies bought there,
 * location history, retailer listings, institutions, sources and identifiers.
 * Any of them keeps the venue: it can be archived, not deleted.
 */
export async function getVenueReferences(venueId: string) {
  z.uuid().parse(venueId);
  const at = sql`${venueId}::uuid`;
  return resultRows<{
    orders: number;
    bottles: number;
    filmCopies: number;
    artBought: number;
    whereabouts: number;
    listings: number;
    institutions: number;
    sources: number;
    identifiers: number;
  }>(
    await db.execute(sql`select
      (select count(*)::int from orders where venue_id = ${at}) as orders,
      (select count(*)::int from perfume_bottles where venue_id = ${at}) as bottles,
      (select count(*)::int from film_holdings where venue_id = ${at}) as "filmCopies",
      (select count(*)::int from art_objects where venue_id = ${at}) as "artBought",
      (select count(*)::int from art_object_whereabouts where venue_id = ${at}) as whereabouts,
      (select count(*)::int from perfume_retailer_links where venue_id = ${at}) as listings,
      (select count(*)::int from organization_venues where venue_id = ${at}) as institutions,
      (select count(*)::int from source_records where venue_id = ${at}) as sources,
      (select count(*)::int from catalogue_identifiers where venue_id = ${at}) as identifiers`),
  )[0];
}
export type VenueReferences = Awaited<ReturnType<typeof getVenueReferences>>;

/** Deletes a venue nothing refers to; the database says what keeps it otherwise */
export async function removeVenue(id: string) {
  return withReadableErrors(() => deleteVenue(id), {
    reference: "Records still refer to this venue. Archive it instead.",
  });
}

/**
 * The countries of the venues, for the places filter: a venue's country is
 * the first country found on its place or the places above it. A venue with
 * no place, or a bare map point, has none.
 */
export async function getVenueCountries() {
  return resultRows<{ id: string; name: string; count: number }>(
    await db.execute(sql`with recursive up as (
        select v.id as venue_id, p.id as place_id, p.parent_id, p.country_id, 0 as depth
        from venues v join places p on p.id = v.place_id
        union all
        select up.venue_id, p.id, p.parent_id, p.country_id, up.depth + 1
        from up join places p on p.id = up.parent_id where up.country_id is null and up.depth < 10
      )
      select c.id, c.name, count(distinct up.venue_id)::int as count
      from up join countries c on c.id = up.country_id group by c.id, c.name order by c.name`),
  );
}

const institutionLink = z.object({
  organizationId: z.uuid(),
  venueId: z.uuid(),
  role: z.enum(["operator", "owner"]),
});

/** Records that an institution runs or owns this venue (a branch of it) */
export async function linkVenueInstitution(input: z.input<typeof institutionLink>) {
  return withReadableErrors(() => linkOrganizationVenue(institutionLink.parse(input)), {
    reference: "That institution or venue no longer exists",
  });
}

/**
 * Removes an institution from a venue. A retailer whose listings name this
 * branch keeps running it; the database says so.
 */
export async function unlinkVenueInstitution(input: z.input<typeof institutionLink>) {
  return withReadableErrors(() => unlinkOrganizationVenue(institutionLink.parse(input)));
}

/** Archives a venue, or restores it; its history and links stay */
export async function setVenueArchived(id: string, archived: boolean) {
  return withReadableErrors(() => archiveVenue(id, archived));
}
