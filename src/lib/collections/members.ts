import { sql } from "drizzle-orm";

/**
 * Collection membership writes, shared by the collection actions and the
 * add-book wizard so a book joins its collections in the same transaction.
 *
 * A collection holds editions (`collection_editions`) and whole works
 * (`collection_works`: films, perfumes, paintings, or a book with no edition
 * chosen). Both share one order: `sort_order` runs across the two tables.
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

/** The last position in the collection's one order, -1 when it is empty */
function lastPosition(id: string) {
  return sql`greatest(
    coalesce((select max(sort_order) from collection_editions where collection_id=${id}::uuid),-1),
    coalesce((select max(sort_order) from collection_works where collection_id=${id}::uuid),-1))`;
}

/**
 * Appends editions to a collection after its last member and records one
 * "added to collection" activity per work; members already there are skipped.
 */
export function addMembers(id: string, ids: string[]) {
  return sql`with added as (
    insert into collection_editions(collection_id,edition_id,sort_order)
    select ${id}::uuid, selected.id, (${lastPosition(id)} + selected.n)::int
    from unnest(${idArray(ids)}) with ordinality selected(id,n)
    on conflict do nothing returning edition_id
  ), events as (
    insert into activity_events(entity_type,entity_id,event_key,metadata)
    select distinct 'work', e.work_id, 'work.collection_added', jsonb_build_object('collectionName',c.name,'extra',jsonb_build_object('collectionId',c.id))
    from added join editions e on e.id=added.edition_id cross join collections c where c.id=${id}::uuid
  ) select count(*)::int as changed from added`;
}

/**
 * Appends whole works after the collection's last member, with one "added to
 * collection" activity each; works already there are skipped.
 */
export function addWorkMembers(id: string, ids: string[]) {
  return sql`with added as (
    insert into collection_works(collection_id,work_id,sort_order)
    select ${id}::uuid, selected.id, (${lastPosition(id)} + selected.n)::int
    from unnest(${idArray(ids)}) with ordinality selected(id,n)
    on conflict do nothing returning work_id
  ), events as (
    insert into activity_events(entity_type,entity_id,event_key,metadata)
    select 'work', added.work_id, 'work.collection_added', jsonb_build_object('collectionName',c.name,'extra',jsonb_build_object('collectionId',c.id))
    from added cross join collections c where c.id=${id}::uuid
  ) select count(*)::int as changed from added`;
}

/**
 * The members a collection shows, in its one order: every edition, and every
 * work except a book that also has an edition there (the edition stands for
 * it). Columns: kind ('edition' or 'work'), id, position (from 1).
 */
export function shownMembers(id: string) {
  return sql`select kind, id, row_number() over(order by sort_order, added_at, kind, id)::int as position from (
    select 'edition'::text as kind, ce.edition_id as id, ce.sort_order, ce.added_at
      from collection_editions ce where ce.collection_id=${id}::uuid
    union all
    select 'work'::text, cw.work_id, cw.sort_order, cw.added_at
      from collection_works cw where cw.collection_id=${id}::uuid
      and not exists(select 1 from collection_editions ce join editions e on e.id=ce.edition_id
        where ce.collection_id=${id}::uuid and e.work_id=cw.work_id)
  ) members`;
}

/**
 * Moves one shown member a place earlier (-1) or later (1) in the
 * collection's one order and renumbers the shown members from 0. A book
 * held only behind its edition keeps its stored place.
 */
export function moveMember(
  id: string,
  member: { kind: "edition" | "work"; id: string },
  direction: -1 | 1,
) {
  return sql`with ranked as (${shownMembers(id)}),
    target as (select position from ranked where kind=${member.kind} and id=${member.id}::uuid),
    moved as (
      select kind, id, case
        when position=(select position from target) then greatest(1, least((select count(*)::int from ranked), position+${direction}))
        when position=(select position from target)+${direction} then position-${direction}
        else position end as position
      from ranked
    ), editions_moved as (
      update collection_editions ce set sort_order=moved.position-1 from moved
      where ce.collection_id=${id}::uuid and moved.kind='edition' and ce.edition_id=moved.id returning 1
    ), works_moved as (
      update collection_works cw set sort_order=moved.position-1 from moved
      where cw.collection_id=${id}::uuid and moved.kind='work' and cw.work_id=moved.id returning 1
    ) select (select count(*) from editions_moved) + (select count(*) from works_moved) as moved`;
}
