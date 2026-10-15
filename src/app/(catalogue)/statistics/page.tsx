import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { BarChart } from "@/components/reading/charts/bar-chart";
import { Footnote, NumberTiles, RankList, StatsSection } from "@/components/reading/stats-parts";
import { CoverFrame, CoverStrip, YearCovers, bookHref } from "@/components/statistics/covers";
import { SplitRing } from "@/components/statistics/split-ring";
import { WrittenChart } from "@/components/statistics/written-chart";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { loadDomainCounts, type HomeKind } from "@/lib/catalogue/domain-homes";
import { COPY_FORMAT_LABELS } from "@/lib/constants/catalogue";
import { n } from "@/lib/reading/charts";
import { yearNumbers } from "@/lib/reading/stats";
import { yearLabel } from "@/lib/statistics/charts";
import {
  breakdown,
  busiestYears,
  copyStats,
  extremes,
  favouriteCovers,
  libraryNumbers,
  rankings,
  ratingSpread,
  writtenYears,
  type Extreme,
} from "@/lib/statistics/library";
import type { InstanceFormat } from "@/lib/types";
import { languageName } from "@/lib/utils/language";
import { shortCountryName } from "@/lib/utils/nationality-param";
import { formatRating } from "@/lib/utils/rating";

export const metadata = { title: "Statistics" };

const count = (value: number, one: string, many = `${one}s`) => `${n(value)} ${Math.round(value) === 1 ? one : many}`;
/** A library list of the books he owns, with one more filter */
const owned = (filter: string) => `/library?${filter}&holding=owned`;

const CREATORS: Record<HomeKind, string> = {
  perfume: "Perfumers",
  film: "Directors",
  painting: "Painters",
};

/**
 * Statistics (SLN-742): the books he owns, in numbers and pictures, after
 * Letterboxd's member stats. Each section is left out without data.
 * Reading has its own stats (/reading/stats); its totals link there.
 * Computed per request; never cached.
 */
export default async function StatisticsPage() {
  const [numbers, written, ranks, split, ratings, copies, ends, covers, reading, others] = await Promise.all([
    libraryNumbers(),
    writtenYears(),
    rankings(),
    breakdown(),
    ratingSpread(),
    copyStats(),
    extremes(),
    favouriteCovers(),
    yearNumbers(null),
    Promise.all(
      getEnabledWorkKinds()
        .filter((kind): kind is HomeKind => kind !== "book")
        .map(async (kind) => ({ kind, counts: await loadDomainCounts(kind) })),
    ),
  ]);
  const years = await busiestYears(written.years);
  const unrated = split.unrated;

  return (
    <>
      <PageHeader title="Statistics" description="The books on your shelves, in numbers." />

      {numbers.books === 0 ? (
        <EmptyState icon={BarChart3} title="No books on your shelves yet" />
      ) : (
        <div className="space-y-14">
          <CoverStrip books={covers} />

          <StatsSection title="In numbers" id="numbers">
            <NumberTiles
              tiles={[
                { label: "Books", value: n(numbers.books) },
                { label: "Editions", value: n(numbers.editions) },
                { label: "Copies", value: n(numbers.copies) },
                { label: "Pages", value: n(numbers.pages) },
                { label: "Authors", value: n(numbers.authors) },
                { label: "Publishers", value: n(numbers.publishers) },
                { label: "Languages", value: n(numbers.languages) },
                { label: "Countries", value: n(numbers.countries) },
              ]}
            />
            <Footnote>Books you own: a book counts once one of its copies is on your shelves. Countries are your authors&apos; nationalities.</Footnote>
          </StatsSection>

          {written.years.length > 0 && (
            <StatsSection title="When they were written" id="written">
              <WrittenChart years={written.years} />
              {written.undated > 0 && <Footnote>{count(written.undated, "book")} with no known year {written.undated === 1 ? "is" : "are"} not shown.</Footnote>}
            </StatsSection>
          )}

          {years.length > 0 && (
            <StatsSection title="Years with the most books" id="years">
              <div className="space-y-8">
                {years.map((y) => (
                  <YearCovers key={y.year} year={y} />
                ))}
              </div>
            </StatsSection>
          )}

          {ranks.languages.length || ranks.countries.length || ranks.categories.length ? (
            <StatsSection title="Languages, countries and categories" id="origins">
              <div className="grid gap-8 lg:grid-cols-3">
                <RankList
                  title="Written in"
                  items={ranks.languages.map((l) => ({
                    label: languageName(l.key) ?? l.key,
                    href: owned(`origLang=${encodeURIComponent(l.key)}`),
                    value: l.count,
                    text: count(l.count, "book"),
                  }))}
                />
                <RankList
                  title="Authors from"
                  tone="blue"
                  items={ranks.countries.map((c) => ({
                    label: shortCountryName(c.name),
                    href: owned(`authorCountry=${c.key}`),
                    value: c.count,
                    text: count(c.count, "book"),
                  }))}
                />
                <RankList
                  title="Categories"
                  tone="gold"
                  items={ranks.categories.map((c) => ({
                    label: c.name,
                    href: owned(`category=${c.key}`),
                    value: c.count,
                    text: count(c.count, "book"),
                  }))}
                />
              </div>
            </StatsSection>
          ) : null}

          <StatsSection title="Breakdown" id="breakdown">
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
              <SplitRing title="Read" first={{ label: "Read", value: split.read }} second={{ label: "Not finished", value: split.unread }} />
              <SplitRing title="Rated" first={{ label: "Rated", value: split.rated }} second={{ label: "Unrated", value: split.unrated }} />
              <SplitRing
                title="In translation"
                first={{ label: "Translated", value: split.translated }}
                second={{ label: "Original", value: split.original }}
              />
              <SplitRing title="On paper" first={{ label: "Print", value: split.print }} second={{ label: "Digital", value: split.digital }} />
            </div>
            <Footnote>Read and rated count books; not finished includes the books you are reading now, which the unread pile on Reading stats leaves out. Translation counts editions with both languages recorded; print and digital count copies.</Footnote>
          </StatsSection>

          {ratings.some((r) => r.count) && (
            <StatsSection title="Ratings" id="ratings">
              <BarChart
                label="Books by rating"
                bars={ratings.map((r) => ({
                  label: formatRating(r.rating),
                  value: r.count,
                  text: `${formatRating(r.rating)} stars: ${count(r.count, "book")}`,
                }))}
                summaryUnit="books"
                tone="blue"
                columns={["Rating", "Books"]}
                footnote={unrated ? `${count(unrated, "book")} without a rating ${unrated === 1 ? "is" : "are"} not shown.` : undefined}
              />
            </StatsSection>
          )}

          {ranks.authors.length || ranks.publishers.length ? (
            <StatsSection title="Authors and publishers" id="people">
              <div className="grid gap-8 lg:grid-cols-2">
                <RankList
                  title="Most collected authors"
                  items={ranks.authors.map((a) => ({
                    label: a.name,
                    href: `/people/${a.slug ?? a.key}`,
                    value: a.count,
                    text: count(a.count, "book"),
                  }))}
                />
                <RankList
                  title="Publishers"
                  tone="blue"
                  items={ranks.publishers.map((p) => ({
                    label: p.name,
                    href: `/publishers/${p.slug ?? p.key}`,
                    value: p.count,
                    text: count(p.count, "edition"),
                  }))}
                />
              </div>
            </StatsSection>
          ) : null}

          <StatsSection title="Copies" id="copies">
            <div className="grid gap-8 lg:grid-cols-2">
              <RankList
                title="Formats"
                items={copies.formats.map((f) => ({
                  label: f.format ? (COPY_FORMAT_LABELS[f.format as InstanceFormat] ?? f.format) : "Format not recorded",
                  href: f.format ? owned(`format=${encodeURIComponent(f.format)}`) : undefined,
                  value: f.count,
                  text: count(f.count, "copy", "copies"),
                }))}
              />
              <RankList
                title="Where they are"
                tone="blue"
                items={copies.places.slice(0, 10).map((p) => ({
                  label: p.name,
                  href: owned(`location=${p.id}`),
                  value: p.count,
                  text: count(p.count, "copy", "copies"),
                }))}
              />
            </div>
            {copies.acquired.length > 0 && (
              <div>
                <SectionHeading as="h3" title="When they came" />
                <BarChart
                label="Copies by the year they came"
                bars={copies.acquired.map((a) => ({
                  label: String(a.year),
                  value: a.count,
                  text: `${a.year}: ${count(a.count, "copy", "copies")}`,
                }))}
                summaryUnit="copies"
                columns={["Year", "Copies"]}
                footnote={copies.undated ? `${count(copies.undated, "copy", "copies")} with no acquisition date ${copies.undated === 1 ? "is" : "are"} not shown.` : undefined}
                />
              </div>
            )}
          </StatsSection>

          {ends.oldest || ends.longest ? (
            <StatsSection title="At the edges" id="edges">
              <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
                {(
                  [
                    ["Oldest", ends.oldest, (b: Extreme) => yearLabel(b.value)],
                    ["Newest", ends.newest, (b: Extreme) => yearLabel(b.value)],
                    ["Longest", ends.longest, (b: Extreme) => count(b.value, "page")],
                    ["Shortest", ends.shortest, (b: Extreme) => count(b.value, "page")],
                  ] as const
                )
                  .filter(([, book]) => book)
                  .map(([label, book, value]) => (
                    <li key={label} className="min-w-0" data-stats-edge={label}>
                      {/* One link: the cover and its words, the cover at the top so a
                          long title or author never stretches its frame below it */}
                      <Link href={bookHref(book!)} className="group flex min-w-0 items-start gap-4">
                        <span className="cover-shadow w-20 shrink-0">
                          <CoverFrame book={book!} />
                        </span>
                        <span className="min-w-0">
                          <span className="type-caption block">{label}</span>
                          <span className="mt-1 block text-sm text-fg-primary [overflow-wrap:break-word] transition-colors group-hover:text-accent-primary">{book!.title}</span>
                          {book!.author && <span className="block text-xs text-fg-secondary">{book!.author}</span>}
                          <span className="mt-1 block text-xs text-fg-secondary tabular-nums">{value(book!)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </StatsSection>
          ) : null}

          {reading.books > 0 || reading.hours > 0 ? (
            <StatsSection
              title="Reading"
              id="reading"
              action={
                <Link href="/reading/stats" className="text-xs whitespace-nowrap text-command touch-hit" data-stats-reading-link="">
                  Reading stats
                </Link>
              }
            >
              <NumberTiles
                tiles={[
                  { label: "Books finished", value: n(reading.books) },
                  { label: "Pages read", value: n(reading.pages) },
                  { label: "Hours", value: n(reading.hours) },
                  { label: "Reading days", value: n(reading.readingDays) },
                ]}
              />
              <Footnote>Every book you finished, owned or not, so it can be more than Read in the Breakdown, which counts the books on your shelves.</Footnote>
            </StatsSection>
          ) : null}

          {others.some((o) => o.counts.records > 0) && (
            <StatsSection title="The other collections" id="collections">
              <NumberTiles
                tiles={others
                  .filter((o) => o.counts.records > 0)
                  .flatMap(({ kind, counts }) => [
                    { label: WORK_DOMAINS[kind].pluralLabel, value: n(counts.records) },
                    { label: CREATORS[kind], value: n(counts.creators) },
                  ])}
              />
            </StatsSection>
          )}
        </div>
      )}
    </>
  );
}
