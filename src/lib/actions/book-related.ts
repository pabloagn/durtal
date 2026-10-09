"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import {
  loadRelatedBooks,
  type RelatedBook,
} from "@/lib/catalogue/related-books";

export interface RelatedBookGroup {
  kind: "author" | "translator" | "publisher";
  id: string;
  name: string;
  href: string | undefined;
  works: RelatedBook[];
}

/** Independent creator/publishing rows; deduplicate before each group's LIMIT. */
export async function getBookRelatedGroups(
  workId: string,
  limit = 12,
): Promise<RelatedBookGroup[]> {
  z.uuid().parse(workId);
  z.number().int().min(1).max(50).parse(limit);
  const selected = resultRows<{
    kind: RelatedBookGroup["kind"];
    sourceId: string;
    name: string;
    slug: string | null;
    workId: string;
    editionId: string | null;
  }>(
    await db.execute(sql`
    with target as (select id from works where id=${workId}::uuid and kind='book'),
    sources as (
      select 'author' as kind,a.id,a.name,a.slug,min(wa.sort_order)::int as position
      from work_authors wa join authors a on a.id=wa.author_id
      where wa.work_id in (select id from target) and wa.role in ('author','co_author') group by a.id
      union all
      select 'translator',a.id,a.name,a.slug,min(c.sort_order)::int
      from edition_contributors c join editions e on e.id=c.edition_id join authors a on a.id=c.author_id
      where e.work_id in (select id from target) and c.role='translator' group by a.id
      union all
      select 'publisher',p.id,p.name,p.slug,0
      from edition_publishers ep join editions e on e.id=ep.edition_id join publishing_houses p on p.id=ep.publisher_id
      where e.work_id in (select id from target) and p.kind is not null group by p.id
    ), candidates as (
      select s.kind,s.id as source_id,wa.work_id,null::uuid as edition_id,null::timestamptz as edition_created
      from sources s join work_authors wa on wa.author_id=s.id and wa.role in ('author','co_author') where s.kind='author'
      union all
      select s.kind,s.id,e.work_id,e.id,e.created_at from sources s
      join edition_contributors c on c.author_id=s.id and c.role='translator'
      join editions e on e.id=c.edition_id where s.kind='translator'
      union all
      select s.kind,s.id,e.work_id,e.id,e.created_at from sources s
      join lateral publisher_family(s.id) pf(id) on s.kind='publisher'
      join edition_publishers ep on ep.publisher_id=pf.id join editions e on e.id=ep.edition_id
    ), distinct_books as (
      select distinct on (c.kind,c.source_id,c.work_id) c.kind,c.source_id,c.work_id,c.edition_id,w.title
      from candidates c join works w on w.id=c.work_id and w.kind='book'
      where c.work_id<>${workId}::uuid
      order by c.kind,c.source_id,c.work_id,c.edition_created,c.edition_id
    ), ranked as (
      select *,row_number() over(partition by kind,source_id order by title collate "C",work_id) as position from distinct_books
    )
    select r.kind,s.id as "sourceId",s.name,s.slug,r.work_id as "workId",r.edition_id as "editionId"
    from ranked r join sources s on s.kind=r.kind and s.id=r.source_id where r.position<=${limit}
    order by case s.kind when 'author' then 0 when 'translator' then 1 else 2 end,s.position,s.name collate "C",s.id,r.position
  `),
  );
  const cards = await loadRelatedBooks(selected);
  const groups = new Map<string, RelatedBookGroup>();
  for (const row of selected) {
    const original = cards.books.get(row.workId);
    if (!original) continue;
    const edition = row.editionId
      ? cards.editions.get(row.editionId)
      : undefined;
    if (row.editionId && (!edition || edition.workId !== original.id)) continue;
    const book = edition
      ? {
          ...original,
          editions: [edition],
          media: [],
          editionNote: [
            edition.title,
            edition.publicationYear != null
              ? `${edition.publicationYear} edition`
              : null,
            row.kind === "translator"
              ? `Translated by ${row.name}`
              : `Published by ${row.name}`,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : original;
    const key = `${row.kind}:${row.sourceId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: row.kind,
        id: row.sourceId,
        name: row.name,
        href:
          row.kind === "publisher"
            ? `/publishers/${row.slug ?? row.sourceId}`
            : row.slug
              ? `/people/${row.slug}`
              : undefined,
        works: [],
      };
      groups.set(key, group);
    }
    group.works.push(book);
  }
  return [...groups.values()];
}
