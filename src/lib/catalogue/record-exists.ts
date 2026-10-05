import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  filmDetails,
  paintingDetails,
  perfumeDetails,
  publishingHouses,
  works,
} from "@/lib/db/schema";
import { publisherCondition } from "@/lib/catalogue/publisher-boundary";

/**
 * Whether a detail page's record exists, checked by its layout before the
 * page's loading screen starts the response: a missing record then answers
 * 404, not a 200 with "not found" in it. Each check matches the page's own
 * lookup (`getFilm`, `getPerfume`, `getPainting`, `getOrganization`,
 * `getPublisher`) in one small query. An address that is not valid text, or
 * longer than the lookup accepts, does not exist.
 */

/** The decoded address part, or null when it cannot be decoded */
function decoded(slug: string, max: number): string | null {
  let key: string;
  try {
    key = decodeURIComponent(slug);
  } catch {
    return null;
  }
  return key.length >= 1 && key.length <= max ? key : null;
}

const DETAILS = {
  film: filmDetails,
  perfume: perfumeDetails,
  painting: paintingDetails,
} as const;

/** A film, perfume or painting by id or slug, with its profile row */
export async function workRecordExists(
  kind: keyof typeof DETAILS,
  slug: string,
): Promise<boolean> {
  const key = decoded(slug, 1000);
  if (!key) return false;
  const details = DETAILS[kind];
  const byId = z.uuid().safeParse(key).success;
  const [row] = await db
    .select({ id: works.id })
    .from(works)
    .innerJoin(details, eq(details.workId, works.id))
    .where(and(eq(works.kind, kind), byId ? eq(works.id, key) : eq(works.slug, key)))
    .limit(1);
  return !!row;
}

/** An organization by id or slug */
export async function organizationExists(slug: string): Promise<boolean> {
  const key = decoded(slug, 500);
  if (!key) return false;
  const byId = z.uuid().safeParse(key).success;
  const [row] = await db
    .select({ id: publishingHouses.id })
    .from(publishingHouses)
    .where(byId ? eq(publishingHouses.id, key) : eq(publishingHouses.slug, key))
    .limit(1);
  return !!row;
}

/** A publisher by slug (the page does not decode it) */
export async function publisherExists(slug: string): Promise<boolean> {
  if (slug.length < 1 || slug.length > 1000) return false;
  const [row] = await db
    .select({ id: publishingHouses.id })
    .from(publishingHouses)
    .where(and(publisherCondition, eq(publishingHouses.slug, slug)))
    .limit(1);
  return !!row;
}
