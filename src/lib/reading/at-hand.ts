import { sql, type SQL } from "drizzle-orm";
import { formatReadingDate } from "./dates";

/*
 * The one rule for "at hand" and for where a copy is (SLN-447). A copy is at
 * hand at a home when it is available and either at that home or at a
 * digital location (an e-book library, a Kindle): those travel with you.
 * Every "at hand", "On your shelf" and copy line uses these helpers.
 */

export interface CopyPlace {
  status: string;
  locationId: string;
  locationType: string | null;
  locationName?: string | null;
  subLocationName?: string | null;
  lentTo?: string | null;
  lentDate?: string | null;
}

/** An available copy at this home, or at a digital location */
export function isAtHand(copy: Pick<CopyPlace, "status" | "locationId" | "locationType">, locationId: string | null) {
  return copy.status === "available" && (copy.locationType === "digital" || (locationId !== null && copy.locationId === locationId));
}

/**
 * The work's copies at hand at a home, physical ones at the home first: a
 * select of instance ids, to wrap as `(${atHandCopySql(...)} limit 1)` for the
 * copy to name or `in (...)` for all of them.
 */
export function atHandCopySql(workId: SQL | string, locationId: SQL | string | null): SQL {
  const home = locationId === null ? sql`null::uuid` : sql`${locationId}::uuid`;
  return sql`select i.id from instances i
    join editions e on e.id = i.edition_id
    join locations l on l.id = i.location_id
    where e.work_id = ${workId}::uuid and i.status = 'available'
      and (i.location_id = ${home} or l.type = 'digital')
    order by (l.type = 'physical') desc, i.created_at, i.id`;
}

const STATUS_WORDS: Record<string, string> = {
  in_storage: "In storage",
  in_transit: "In transit",
  missing: "Missing",
  damaged: "Damaged",
  deaccessioned: "No longer in the collection",
};

/**
 * Where a copy is: "On your shelf in Amsterdam, Study, shelf 3", "Lent to M.
 * since 3 May", "In storage", "Digital". `today` (YYYY-MM-DD) drops the year
 * of a lending date in the current year.
 */
export function copyWhereabouts(copy: CopyPlace, { today }: { today?: string } = {}) {
  if (copy.status === "lent_out") {
    const since = copy.lentDate
      ? ` since ${formatReadingDate(copy.lentDate, "day", { omitYear: !!today && copy.lentDate.slice(0, 4) === today.slice(0, 4) })}`
      : "";
    return `Lent to ${copy.lentTo?.trim() || "someone"}${since}`;
  }
  if (copy.status !== "available") return STATUS_WORDS[copy.status] ?? "Unavailable";
  if (copy.locationType === "digital") return "Digital";
  const place = [copy.locationName, copy.subLocationName].filter(Boolean).join(", ");
  return place ? `On your shelf in ${place}` : "On your shelf";
}

export interface HomeLocation {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

/** The "I'm at" choices: physical, active places. A digital location is never a home. */
export function homeOptions<T extends HomeLocation>(locations: T[]): T[] {
  return locations.filter((l) => l.type === "physical" && l.isActive);
}
