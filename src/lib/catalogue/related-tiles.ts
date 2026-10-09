import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { catalogueDateYears, type CatalogueDate } from "./dates";
import { WORK_DOMAINS } from "./domains";
import type { DomainTile, HomeKind } from "./domain-homes";
import type { RelatedBook } from "./related-books";
import { mediaUrl } from "@/lib/s3/media-url";

export type SimilarWork =
  | { id: string; title: string; kind: "book"; book: RelatedBook }
  | { id: string; title: string; kind: HomeKind; tile: DomainTile };

/** Small mixed-card projection, fetched only after the similarity LIMIT. */
export async function loadRelatedTiles(
  ids: string[],
): Promise<Map<string, DomainTile>> {
  if (!ids.length) return new Map();
  const rows = resultRows<{
    id: string;
    kind: HomeKind;
    slug: string | null;
    title: string;
    createdAt: Date;
    rating: number | null;
    creators: string | null;
    imageKey: string | null;
    tone: string | null;
    date: CatalogueDate | null;
  }>(
    await db.execute(sql`
    select w.id,w.kind,w.slug,w.title,w.created_at as "createdAt",w.rating,
      coalesce(h.names,c.names) as creators,
      coalesce(m.thumbnail_s3_key,m.s3_key) as "imageKey",
      m.color_palette->'dominant'->>'hex' as tone,
      case when d.id is not null then jsonb_build_object('precision',d.precision,
        'start',case when d.start_year is not null then jsonb_build_object('year',d.start_year,'month',d.start_month,'day',d.start_day) end,
        'end',case when d.end_year is not null then jsonb_build_object('year',d.end_year,'month',d.end_month,'day',d.end_day) end,
        'approximate',d.approximate,'label',d.label) end as date
    from works w
    left join film_details f on f.work_id=w.id and w.kind='film'
    left join perfume_details p on p.work_id=w.id and w.kind='perfume'
    left join painting_details a on a.work_id=w.id and w.kind='painting'
    left join catalogue_dates d on d.id=coalesce(f.release_date_id,p.release_date_id,a.creation_date_id)
    left join lateral (
      select string_agg(name,', ' order by position,name collate "C") as names from (
        select coalesce(nullif(btrim(c.credited_as),''),a.name) as name,min(c.sort_order) as position
        from work_credits c left join authors a on a.id=c.person_id
        where c.work_id=w.id and c.role_id=case w.kind
          when 'film' then 'film.director' when 'perfume' then 'perfume.perfumer' when 'painting' then 'painting.painter' end
        group by coalesce(nullif(btrim(c.credited_as),''),a.name)
      ) people
    ) c on true
    left join lateral (
      select string_agg(name,', ' order by position,name collate "C") as names from (
        select o.name,min(p.sort_order) as position from perfume_organizations p
        join publishing_houses o on o.id=p.organization_id
        where w.kind='perfume' and p.work_id=w.id and p.role in ('perfume_house','brand') group by o.id,o.name
      ) houses
    ) h on true
    left join lateral (
      select thumbnail_s3_key,s3_key,color_palette from media
      where work_id=w.id and type='poster' and is_active order by id limit 1
    ) m on true
    where w.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) and w.kind<>'book'
  `),
  );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        href: `${WORK_DOMAINS[row.kind].basePath}/${row.slug ?? row.id}`,
        creators: row.creators,
        date: catalogueDateYears(row.date),
        imageUrl: row.imageKey ? mediaUrl(row.imageKey) : null,
        tone: row.tone,
        rating: row.rating,
        createdAt: row.createdAt,
      },
    ]),
  );
}
