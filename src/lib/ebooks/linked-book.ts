import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { cardReadingOf, type CardReadingValue } from "@/lib/reading/card";
import { openReadingPercentSql, readingStateSql } from "@/lib/reading/summary";
import { mediaUrl } from "@/lib/s3/media-url";
import { mediaCrop, type MediaCrop } from "@/lib/utils/media-style";

type Database = { execute(query: SQL): PromiseLike<unknown> };

/** The book an e-book belongs to, as its card on the e-book page shows it (SLN-666) */
export interface LinkedBook {
  workId: string;
  slug: string | null;
  title: string;
  authors: string[];
  coverUrl: string | null;
  coverCrop: MediaCrop | null;
  coverTone: string | null;
  publisher: string | null;
  year: number | null;
  translators: string[];
  /** The copy's location: "Library", "eBooks" */
  location: string | null;
  rating: number | null;
  status: string | null;
  isRare: boolean;
  huntAssessedOn: string | null;
  isPoison: boolean;
  reading: CardReadingValue | undefined;
}

type Poster = {
  s3Key: string; thumbnailS3Key: string | null; cropX: number; cropY: number;
  cropZoom: number; brightness: number; contrast: number; tone: string | null;
};

/** The linked copy's book, edition and location; null when the copy is gone */
export async function getLinkedBook(
  instanceId: string,
  database: Database = db,
): Promise<LinkedBook | null> {
  const [row] = resultRows<{
    work_id: string; slug: string | null; title: string; authors: string[] | null;
    edition_cover: string | null; poster: Poster | null; work_cover: string | null; publisher: string | null; year: number | null;
    translators: string[] | null; location: string | null; rating: number | null; status: string | null;
    is_rare: boolean; hunt_assessed_on: string | null; is_poison: boolean; reading_state: string | null; reading_percent: number | null;
  }>(await database.execute(sql`select w.id as work_id, w.slug, w.title,
      (select array_agg(a.name order by wa.sort_order, a.name) from work_authors wa join authors a on a.id = wa.author_id
        where wa.work_id = w.id and wa.role in ('author', 'co_author')) as authors,
      coalesce(e.thumbnail_s3_key, e.cover_s3_key) as edition_cover,
      (select json_build_object('s3Key', m.s3_key, 'thumbnailS3Key', m.thumbnail_s3_key, 'cropX', m.crop_x, 'cropY', m.crop_y,
          'cropZoom', m.crop_zoom, 'brightness', m.brightness, 'contrast', m.contrast, 'tone', m.color_palette->'dominant'->>'hex')
        from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.created_at desc, m.id limit 1) as poster,
      (select coalesce(o.thumbnail_s3_key, o.cover_s3_key) from editions o where o.work_id = w.id
        and coalesce(o.thumbnail_s3_key, o.cover_s3_key) is not null order by o.created_at, o.id limit 1) as work_cover,
      e.publisher, e.publication_year as year,
      (select array_agg(coalesce(ec.credited_as, a.name) order by ec.sort_order, a.name) from edition_contributors ec
        join authors a on a.id = ec.author_id where ec.edition_id = e.id and ec.role = 'translator') as translators,
      l.name as location, w.rating::float8 as rating, w.catalogue_status as status, w.is_rare, w.hunt_assessed_on::text as hunt_assessed_on, w.is_poison,
      ${readingStateSql(sql`w.id`)} as reading_state, ${openReadingPercentSql(sql`w.id`)} as reading_percent
    from instances i join editions e on e.id = i.edition_id join works w on w.id = e.work_id
    left join locations l on l.id = i.location_id
    where i.id = ${instanceId}::uuid`));
  if (!row) return null;
  // The e-book edition's own cover first; else the book's, as its library
  // card shows it: the poster, else the first edition with a cover
  const poster = !row.edition_cover ? row.poster : null;
  const cover = row.edition_cover ?? (poster ? poster.thumbnailS3Key ?? poster.s3Key : row.work_cover);
  return {
    workId: row.work_id,
    slug: row.slug,
    title: row.title,
    authors: row.authors ?? [],
    coverUrl: cover ? mediaUrl(cover) : null,
    coverCrop: poster ? mediaCrop(poster) : null,
    coverTone: row.poster?.tone ?? null,
    publisher: row.publisher,
    year: row.year,
    translators: row.translators ?? [],
    location: row.location,
    rating: row.rating,
    status: row.status,
    isRare: row.is_rare,
    huntAssessedOn: row.hunt_assessed_on,
    isPoison: row.is_poison,
    reading: cardReadingOf({
      readingState: row.reading_state,
      readingPercent: row.reading_percent === null ? null : Number(row.reading_percent),
    }),
  };
}

/** "Penguin Classics · 2004 · translated by Robert Baldick": the parts there are */
export function linkedEditionLine(book: Pick<LinkedBook, "publisher" | "year" | "translators">): string {
  const translators = book.translators.length > 1
    ? `${book.translators.slice(0, -1).join(", ")} and ${book.translators.at(-1)}`
    : book.translators[0];
  return [book.publisher, book.year, translators ? `translated by ${translators}` : null]
    .filter((part) => part !== null && part !== undefined && part !== "").join(" · ");
}
