import { getFilms } from "@/lib/actions/films";
import { getPaintings } from "@/lib/actions/paintings";
import { getPerfumes } from "@/lib/actions/perfumes";
import { FILM_SORTS } from "@/lib/validations/films";
import { PAINTING_SORTS } from "@/lib/validations/paintings";
import { PERFUME_SORTS } from "@/lib/validations/perfumes";
import { catalogueDateYears } from "./dates";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { WORK_DOMAINS } from "./domains";
import type { WorkKind } from "./kinds";
import { mediaUrl } from "@/lib/s3/media-url";

/** One record on a collection home, whatever its collection. */
export interface DomainTile {
  id: string;
  href: string;
  title: string;
  /** House, director or painter: the people the collection credits first */
  creators: string | null;
  date: string | null;
  imageUrl: string | null;
  /** The picture's main color, for its frame while it loads */
  tone: string | null;
  /** For the card's info row: films, perfumes and paintings have no status yet */
  rating: number | null;
  createdAt: Date;
}

/** The kinds with a generic home; books keep the library at /library. */
export type HomeKind = Exclude<WorkKind, "book">;

function names(people: { name: string | null }[]) {
  const list = people.map((p) => p.name).filter((n): n is string => !!n);
  return list.length ? list.join(", ") : null;
}

function imageUrl(poster: { s3Key: string; thumbnailS3Key: string | null } | null) {
  const key = poster?.thumbnailS3Key ?? poster?.s3Key;
  return key ? mediaUrl(key) : null;
}

/** What every card's info row shows, from a collection's card row */
function cardFields(work: {
  poster: { s3Key: string; thumbnailS3Key: string | null; tone: string | null } | null;
  rating: number | null;
}) {
  return {
    imageUrl: imageUrl(work.poster),
    tone: work.poster?.tone ?? null,
    rating: work.rating,
  };
}

function tile(
  kind: HomeKind,
  work: { id: string; slug: string | null; title: string; createdAt: Date },
  rest: Omit<DomainTile, "id" | "href" | "title" | "createdAt">,
): DomainTile {
  return {
    id: work.id,
    href: `${WORK_DOMAINS[kind].basePath}/${work.slug ?? work.id}`,
    title: work.title,
    createdAt: work.createdAt,
    ...rest,
  };
}

interface HomeQuery {
  sort: string;
  order?: "asc" | "desc";
  limit: number;
  offset: number;
}

/** Each collection's cards as tiles, for the dashboard */
const SOURCES: Record<HomeKind, { list: (query: HomeQuery) => Promise<DomainTile[]> }> = {
  perfume: {
    list: async (query) =>
      (
        await getPerfumes({
          ...query,
          sort: query.sort as (typeof PERFUME_SORTS)[number],
        })
      ).map((perfume) =>
        tile("perfume", perfume, {
          creators: names(perfume.organizations) ?? names(perfume.perfumers),
          date: catalogueDateYears(perfume.releaseDate),
          ...cardFields(perfume),
        }),
      ),
  },
  film: {
    list: async (query) =>
      (
        await getFilms({
          ...query,
          sort: query.sort as (typeof FILM_SORTS)[number],
        })
      ).map((film) =>
        tile("film", film, {
          creators: names(film.directors),
          date: catalogueDateYears(film.releaseDate),
          ...cardFields(film),
        }),
      ),
  },
  painting: {
    list: async (query) =>
      (
        await getPaintings({
          ...query,
          sort: query.sort as (typeof PAINTING_SORTS)[number],
        })
      ).map((painting) =>
        tile("painting", painting, {
          creators: names(painting.painters),
          date: catalogueDateYears(painting.creationDate),
          ...cardFields(painting),
        }),
      ),
  },
};

/** The newest records of a collection, for the dashboard. */
export function loadRecentTiles(kind: HomeKind, limit: number) {
  return SOURCES[kind].list({ sort: "recent", order: "desc", limit, offset: 0 });
}

/** What the dashboard counts for a collection: its records and its first creators. */
export async function loadDomainCounts(kind: HomeKind) {
  const role = `${kind}.${WORK_DOMAINS[kind].creatorRoles[0]}`;
  const [row] = resultRows<{ records: number; creators: number }>(
    await db.execute(sql`select
      (select count(*)::int from works where kind = ${kind}) as records,
      (select count(distinct c.person_id)::int from work_credits c join works w on w.id = c.work_id
        where w.kind = ${kind} and c.role_id = ${role} and c.person_id is not null) as creators`),
  );
  return row;
}
