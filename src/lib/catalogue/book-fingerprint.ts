import { sql } from "drizzle-orm";

/** Said when Edit work saves over a change made since it opened (SLN-1243) */
export const STALE_BOOK =
  "This book changed in another tab or window. Reload to see it, then save again.";

/**
 * The md5 of what Edit work shows and saves: the work's own fields, its
 * authors and its recommenders. The book page reads it with the work, and
 * the save is refused when it no longer matches, as films, perfumes and
 * paintings already are. Covers, copies and readings have their own forms,
 * so a change there never invalidates an open edit.
 */
export function bookEditFingerprint(id: string) {
  return sql`(select md5(jsonb_build_object(
    'title',w.title,'originalLanguage',w.original_language,'originalYear',w.original_year,
    'workTypeId',w.work_type_id,'isAnthology',w.is_anthology,'catalogueStatus',w.catalogue_status,
    'acquisitionPriority',w.acquisition_priority,'rating',w.rating,'description',w.description,
    'notes',w.notes,'seriesId',w.series_id,'seriesPosition',w.series_position,
    'goodreadsUrl',w.goodreads_url,'storygraphUrl',w.storygraph_url,
    'authors',coalesce((select jsonb_agg(jsonb_build_array(a.author_id,a.role) order by a.sort_order,a.author_id) from work_authors a where a.work_id=w.id),'[]'),
    'recommenders',coalesce((select jsonb_agg(r.recommender_id order by r.recommender_id) from work_recommenders r where r.work_id=w.id),'[]')
  )::text) from works w where w.id=${id}::uuid and w.kind='book')`;
}
