import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { CardHeading } from "@/components/shared/card-heading";
import { Prose } from "@/components/shared/prose";
import { SectionHeading } from "@/components/shared/section-heading";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { Cover } from "@/components/reading/reading-tiles";
import { PrintButton } from "@/components/reading/print-button";
import { Footnote, NumberTiles, StatsSection, audioNote } from "@/components/reading/stats-parts";
import { getGoalProgress } from "@/lib/actions/reading-goals";
import { getAppSettings } from "@/lib/actions/settings";
import { MONTHS, finishText, n, yearRhythm } from "@/lib/reading/charts";
import { pastGoalText, reachedText } from "@/lib/reading/goals";
import { authorStats, finishedYears, languages, readingDays, yearReview, type ReviewBook } from "@/lib/reading/stats";
import { languageName } from "@/lib/utils/language";
import { nationalityFilterHref, shortCountryName } from "@/lib/utils/nationality-param";
import { formatRating } from "@/lib/utils/rating";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }) {
  return { title: `${(await params).year} in review` };
}

const book = (b: { slug: string | null; workId: string }) => `/library/${b.slug ?? b.workId}`;
const link = "text-fg-primary transition-colors hover:text-accent-rose-text";
const evidence = "text-xs whitespace-nowrap text-fg-secondary transition-colors hover:text-fg-primary";

/**
 * Year in review (SLN-456): one year's reading as a long page that also
 * prints. Every block links to its evidence: the journal for the year, the
 * book, the notes. A year without finished books is a 404.
 */
export default async function YearInReviewPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: param } = await params;
  if (!/^\d{4}$/.test(param)) notFound();
  const year = Number(param);
  const years = await finishedYears();
  if (!years.some((y) => y.year === year)) notFound();

  const [review, authors, langs, days, goals, settings] = await Promise.all([
    yearReview(year),
    authorStats(year),
    languages(year),
    readingDays(year),
    getGoalProgress(year),
    getAppSettings(),
  ]);
  const { numbers } = review;
  const journal = `/reading/journal?yearMin=${year}&yearMax=${year}`;
  const rhythm = yearRhythm(
    days.calendar.map((d) => d.day),
    year,
    settings.readingWeekStart,
    settings.readingRhythmDays,
  );
  const months = [...Array.from({ length: 12 }, (_, i) => i + 1), null].map((month) => ({ month, books: review.books.filter((b) => b.month === month) })).filter((m) => m.books.length);
  const highlights = (
    [
      ["First of the year", review.first, (b: ReviewBook) => `Finished ${finishText(b.finishedOn, b.precision)}`],
      ["Last of the year", review.last, (b: ReviewBook) => `Finished ${finishText(b.finishedOn, b.precision)}`],
      ["The longest", review.longest, (b: ReviewBook) => `${n(b.pages!)} pages`],
      ["Highest rated", review.highestRated, (b: ReviewBook) => `Rated ${formatRating(b.rating!)}`],
      ["Most re-read", review.mostReread, (b: ReviewBook) => `Read ${n(b.reads)} times`],
    ] as const
  ).filter(([, b]) => b);

  return (
    <article data-review={year}>
      <PageHeader
        title={`${year} in review`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PrintButton />
            <Link href={`/reading/stats?year=${year}`} className={`${buttonClass("secondary")} pointer-coarse:h-11`}>
              Stats for {year}
            </Link>
          </div>
        }
        tabs={
          <div className="print:hidden">
            <ReadingTabs />
          </div>
        }
      />

      <div className="space-y-14">
        <StatsSection
          title="The year in numbers"
          id="numbers"
          action={
            <Link href={journal} className={evidence}>
              The journal
            </Link>
          }
        >
          <NumberTiles
            tiles={[
              { label: numbers.books === 1 ? "Book finished" : "Books finished", value: n(numbers.books) },
              { label: "Pages", value: n(numbers.pages) },
              { label: "Hours", value: n(numbers.hours) },
              { label: "Reading days", value: n(numbers.readingDays) },
            ]}
          />
          <div className="space-y-1 text-sm text-fg-primary" data-review-goals="">
            {goals.map((g) => (
              <p key={g.metric}>
                {pastGoalText(g)}
                {g.count >= g.target && g.reachedOn ? `. ${reachedText(g.reachedOn, g.reachedPrecision ?? "day")}.` : "."}
              </p>
            ))}
            {numbers.readingDays > 0 && (
              <p data-review-rhythm="">
                You read on {n(numbers.readingDays)} {numbers.readingDays === 1 ? "day" : "days"}, in {n(rhythm.weeksRead)} of {n(rhythm.weeks)} weeks
                {rhythm.kept !== null ? `; ${n(rhythm.kept)} ${rhythm.kept === 1 ? "week" : "weeks"} had ${settings.readingRhythmDays} reading days or more` : ""}.
              </p>
            )}
          </div>
          {audioNote(numbers.audioWithoutPages) && <Footnote>{audioNote(numbers.audioWithoutPages)}</Footnote>}
        </StatsSection>

        <StatsSection title="The books, month by month" id="books">
          <div className="space-y-4" data-review-wall="">
            {months.map(({ month, books }) => (
              <div key={month ?? "unknown"} id={month ? `month-${month}` : "month-unknown"} className="grid scroll-mt-24 gap-x-4 gap-y-2 break-inside-avoid sm:grid-cols-[6rem_1fr]">
                <p className="text-xs text-fg-secondary">
                  {month ? MONTHS[month - 1] : "Month unknown"}
                  <span className="ml-2 tabular-nums sm:ml-0 sm:block">{n(books.length)}</span>
                </p>
                <ul className="flex flex-wrap gap-2">
                  {books.map((b) => (
                    <li key={`${b.workId}-${b.finishedOn}`}>
                      <Link
                        href={book(b)}
                        aria-label={b.title}
                        data-tooltip={b.rating !== null ? `${b.title} · ${formatRating(b.rating)}` : b.title}
                        className="block rounded-sm transition-opacity hover:opacity-80"
                      >
                        <Cover s3Key={b.cover} className="aspect-[2/3] w-14" eager />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </StatsSection>

        {highlights.length > 0 && (
          <StatsSection title="Highlights" id="highlights">
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-review-highlights="">
              {highlights.map(([label, b, words]) => (
                <li key={label} className="min-w-0 break-inside-avoid">
                  <Link href={book(b!)} className="group block">
                    <span className="mb-2 block text-xs text-fg-secondary">{label}</span>
                    <Cover s3Key={b!.cover} className="aspect-[2/3] w-full" eager />
                    <div className="mt-2">
                      <CardHeading title={b!.title} subtitle={words(b!)} titleClassName="transition-colors group-hover:text-accent-rose-text" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </StatsSection>
        )}

        {authors.newAuthors.length || authors.countries.length || langs.known || review.busiestMonth ? (
          <StatsSection
            title="Authors and languages"
            id="authors"
            action={
              <Link href={`${journal}&status=finished`} className={evidence}>
                The books
              </Link>
            }
          >
            <div className="space-y-3 text-sm text-fg-primary">
              {review.busiestMonth && (
                <p data-review-busiest="">
                  Your busiest month was{" "}
                  <a href={`#month-${review.busiestMonth.month}`} className={link}>
                    {MONTHS[review.busiestMonth.month - 1]}
                  </a>
                  , with {n(review.busiestMonth.books)} {review.busiestMonth.books === 1 ? "book" : "books"}.
                </p>
              )}
              {authors.newAuthors.length > 0 && (
                <p data-review-new-authors="">
                  {n(authors.newAuthors.length)} new {authors.newAuthors.length === 1 ? "author" : "authors"}:{" "}
                  {authors.newAuthors.map((a, i) => (
                    <span key={a.authorId}>
                      {i > 0 && ", "}
                      <Link href={`/people/${a.slug}`} className={link}>
                        {a.name}
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              )}
              {authors.countries.length > 0 && (
                <p data-review-countries="">
                  Books from {n(authors.countries.length)} {authors.countries.length === 1 ? "country" : "countries"}:{" "}
                  {authors.countries.map((c, i) => (
                    <span key={c.code}>
                      {i > 0 && ", "}
                      <Link href={nationalityFilterHref(c.code)} className={link}>
                        {shortCountryName(c.country)}
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              )}
              {langs.known > 0 && (
                <p data-review-translation="">
                  {Math.round((langs.translated / langs.known) * 100)}% in translation
                  {langs.topSource ? `; ${n(langs.topSource.count)} from ${languageName(langs.topSource.language) ?? langs.topSource.language}` : ""}.
                </p>
              )}
            </div>
          </StatsSection>
        ) : null}

        {review.favouritePassage && (
          <section className="break-inside-avoid" data-review-passage="">
            <SectionHeading
              title="Favourite passage"
              action={
                <Link href={`/reading/notes?fav=1&book=${review.favouritePassage.workId}`} className={evidence}>
                  The notes
                </Link>
              }
            />
            <figure>
              <blockquote className="border-l-2 border-accent-rose/40 pl-4">
                <Prose>
                  <p className="whitespace-pre-line break-words">{review.favouritePassage.body}</p>
                </Prose>
              </blockquote>
              <figcaption className="mt-2 pl-4.5 text-xs text-fg-secondary">
                <Link href={book(review.favouritePassage)} className={link}>
                  {review.favouritePassage.title}
                </Link>
                {review.favouritePassage.page !== null && ` · p. ${review.favouritePassage.page}`}
              </figcaption>
            </figure>
          </section>
        )}
      </div>
    </article>
  );
}
