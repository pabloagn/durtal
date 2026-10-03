import { sql } from "drizzle-orm";

/**
 * Collection membership writes, shared by the collection actions and the
 * add-book wizard so a book joins its collections in the same transaction.
 */

export function idArray(ids: string[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

/** Serializes membership changes of one collection. */
export function lockCollection(id: string) {
  return sql`select id from collections where id=${id}::uuid for update`;
}

/**
 * Appends editions to a collection after its last member and records one
 * "added to collection" activity per work; members already there are skipped.
 */
export function addMembers(id: string, ids: string[]) {
  return sql`with added as (
    insert into collection_editions(collection_id,edition_id,sort_order)
    select ${id}::uuid, selected.id, (coalesce((select max(sort_order) from collection_editions where collection_id=${id}::uuid),-1) + selected.n)::int
    from unnest(${idArray(ids)}) with ordinality selected(id,n)
    on conflict do nothing returning edition_id
  ), events as (
    insert into activity_events(entity_type,entity_id,event_key,metadata)
    select distinct 'work', e.work_id, 'work.collection_added', jsonb_build_object('collectionName',c.name,'extra',jsonb_build_object('collectionId',c.id))
    from added join editions e on e.id=added.edition_id cross join collections c where c.id=${id}::uuid
  ) select count(*)::int as changed from added`;
}
