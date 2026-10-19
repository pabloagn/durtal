import { sql } from "drizzle-orm";

/** Said when Edit person saves over a change made since it opened (SLN-1244) */
export const STALE_PERSON =
  "This person changed in another tab or window. Reload to see it, then save again.";

/**
 * The md5 of what Edit person shows and saves: the person's own fields. The
 * dialog reads it before the person, and the save is refused when it no
 * longer matches, as a book's is (SLN-1243). Aliases, photos, credits and
 * the favourite mark have their own controls, so a change there never
 * invalidates an open edit.
 */
export function personEditFingerprint(id: string) {
  return sql`(select md5(jsonb_build_object(
    'name',a.name,'sortName',a.sort_name,'firstName',a.first_name,'lastName',a.last_name,
    'realName',a.real_name,'gender',a.gender,'nationalityId',a.nationality_id,
    'birthYear',a.birth_year,'birthMonth',a.birth_month,'birthDay',a.birth_day,
    'birthYearIsApproximate',a.birth_year_is_approximate,'deathYear',a.death_year,
    'deathMonth',a.death_month,'deathDay',a.death_day,
    'deathYearIsApproximate',a.death_year_is_approximate,'birthPlaceId',a.birth_place_id,
    'deathPlaceId',a.death_place_id,'bio',a.bio,'website',a.website,
    'openLibraryKey',a.open_library_key,'goodreadsId',a.goodreads_id
  )::text) from authors a where a.id=${id}::uuid)`;
}
