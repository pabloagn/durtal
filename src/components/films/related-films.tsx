import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import type { getRelatedFilms } from "@/lib/actions/films";
import { FilmCard, type FilmCardData } from "./film-card";

type Related = Awaited<ReturnType<typeof getRelatedFilms>>;

/** "Kurt Russell, Wilford Brimley and 2 more" */
function shortNames(names: string[], limit = 2) {
  return names.length > limit
    ? `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`
    : names.join(" and ");
}

function Row({
  title,
  href,
  films,
  caption,
}: {
  title: string;
  href?: string;
  films: FilmCardData[];
  caption?: (film: FilmCardData) => string;
}) {
  return (
    <section className="mb-10">
      <HorizontalCarousel title={title} titleHref={href}>
        {films.map((film) => (
          <div key={film.id} className="w-[160px] flex-shrink-0 snap-start">
            <FilmCard film={film} caption={caption?.(film)} />
          </div>
        ))}
      </HorizontalCarousel>
    </section>
  );
}

/**
 * Films to look at next: more by the first director, films that share cast,
 * and films that share genres, each card saying which. Rows with nothing to
 * show are left out.
 */
export function RelatedFilms({ related }: { related: Related }) {
  const cast = new Map(related.cast.map((f) => [f.id, f.shared]));
  const genres = new Map(related.genres.map((f) => [f.id, f.shared]));
  return (
    <>
      {related.director && (
        <Row
          title={`More by ${related.director.name}`}
          href={`/films?director=${related.director.id}`}
          films={related.director.films}
        />
      )}
      {related.cast.length > 0 && (
        <Row
          title="Shared cast"
          films={related.cast}
          caption={(f) => `With ${shortNames(cast.get(f.id) ?? [])}`}
        />
      )}
      {related.genres.length > 0 && (
        <Row
          title="Shared genres"
          films={related.genres}
          caption={(f) => shortNames(genres.get(f.id) ?? [], 3)}
        />
      )}
    </>
  );
}
