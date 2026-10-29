/** A compact summary with every saved rating available in its original order. */
export function RatingHistory({ title, ratings }: { title: string; ratings: readonly (number | null)[] }) {
  if (!ratings.length) return null;
  const long = ratings.length > 6;
  const shown = long ? ratings.slice(0, 3) : ratings;
  // These are stored ratings, not averages or star controls: never round them.
  const label = (rating: number | null) => rating === null ? "unrated" : String(rating);
  const summary = shown.map((rating, index) => index ? `, then ${label(rating)}` : rating === null ? "Unrated" : `Rated ${label(rating)}`).join("");
  return (
    <div className="min-w-0 text-xs text-fg-secondary tabular-nums">
      <p>{summary}{long ? ` · ${(ratings.length - shown.length).toLocaleString("en")} more` : ""}</p>
      {long && (
        <details className="mt-1">
          <summary className="w-fit max-w-full cursor-pointer text-command touch-hit" aria-label={`Show all ${ratings.length.toLocaleString("en")} ratings for ${title}`}>
            Show all {ratings.length.toLocaleString("en")} ratings
          </summary>
          <ol className="mt-2 grid list-decimal grid-cols-2 gap-x-8 gap-y-1 pl-8 sm:grid-cols-4 lg:grid-cols-6" aria-label={`All ratings for ${title}`}>
            {ratings.map((rating, index) => <li key={index} className="min-w-0 pl-1">{label(rating)}</li>)}
          </ol>
        </details>
      )}
    </div>
  );
}
