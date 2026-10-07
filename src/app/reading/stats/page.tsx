import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { GoalDialogButton } from "@/components/reading/goal-dialog-button";
import { GoalCards } from "@/components/reading/goal-card";
import { BarChart } from "@/components/reading/charts/bar-chart";
import { CalendarHeatmap } from "@/components/reading/charts/calendar-heatmap";
import { SectionHeading } from "@/components/shared/section-heading";
import { Footnote, NameList, NumberTiles, RankList, StatsSection, audioNote } from "@/components/reading/stats-parts";
import { getGoalProgress } from "@/lib/actions/reading-goals";
import { getAppSettings } from "@/lib/actions/settings";
import { readingDay } from "@/lib/reading/dates";
import { appTimeZone } from "@/lib/utils/date";
import { ABANDON_REASON_LABELS, type AbandonReason } from "@/lib/reading/constants";
import { MONTHS, MONTHS_SHORT, WEEKDAYS, dayLabel, durationWords, minutesLabel, n, parseStatsYear, peakWords } from "@/lib/reading/charts";
import { insights } from "@/lib/reading/insights";
import { pastGoalText, reachedText } from "@/lib/reading/goals";
import {
  abandoned,
  authorStats,
  eras,
  finishedYears,
  insightInputs,
  languages,
  lengthAndPace,
  overTheYear,
  ratings,
  readingDays,
  recommenderStats,
  shelfTime,
  statsYears,
  unreadPile,
  whereAndHow,
  yearNumbers,
} from "@/lib/reading/stats";
import { languageName } from "@/lib/utils/language";
import { nationalityFilterHref, shortCountryName } from "@/lib/utils/nationality-param";
import { formatRating } from "@/lib/utils/rating";

export const metadata = { title: "Reading stats" };

const book = (b: { slug: string | null; workId: string }) => `/library/${b.slug ?? b.workId}`;
const count = (value: number, one: string, many = `${one}s`) => `${n(value)} ${Math.round(value) === 1 ? one : many}`;
const lang = (code: string) => languageName(code) ?? code;
const FORMATS: Record<string, string> = {
  print: "Print",
  ebook: "eBook",
  audio: "Audio",
};
const PARTS: Record<string, string> = {
  night: "Night",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/**
 * Reading stats (SLN-456): a year, or all time, in fourteen sections, each
 * left out without data. Computed per request; never cached.
 */
export default async function ReadingStatsPage({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const [{ year: param }, settings, years, finished] = await Promise.all([searchParams, getAppSettings(), statsYears(), finishedYears()]);
  const today = readingDay(new Date(), appTimeZone(), settings.readingDayStartHour);
  const current = Number(today.slice(0, 4));
  const year = parseStatsYear(param, years, current);
  const [numbers, months, days, rated, length, langs, authors, written, where, shelf, pile, recommenders, dropped, inputs, goals] = await Promise.all([
    yearNumbers(year),
    overTheYear(year),
    readingDays(year),
    ratings(year),
    lengthAndPace(year),
    languages(year),
    authorStats(year),
    eras(year),
    whereAndHow(year),
    shelfTime(year),
    unreadPile(today),
    recommenderStats(year),
    abandoned(year),
    insightInputs(year),
    year === null ? Promise.resolve([]) : getGoalProgress(year),
  ]);
  const span = year === null ? "all time" : String(year);
  const review = year !== null && finished.some((f) => f.year === year) ? `/reading/year/${year}` : "/reading/year";
  const empty = numbers.books === 0 && numbers.pages === 0 && numbers.hours === 0 && numbers.abandoned === 0;
  const found = insights(inputs, year);

  return (
    <>
      <PageHeader
        title="Reading"
        actions={
          <>
            <GoalDialogButton />
            <Link href={review} className={`${buttonClass("secondary")} pointer-coarse:h-11`} data-stats-review="">
              Year in review
            </Link>
          </>
        }
        tabs={<ReadingTabs />}
      />
      <nav aria-label="Year" className="-mt-4 mb-8">
        <ul className="flex gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none]" data-stats-years="">
          {[null, ...(years.includes(current) ? years : [current, ...years])].map((y) => (
            <li key={y ?? "all"} className="shrink-0">
              <Link
                href={y === null ? "/reading/stats?year=all" : y === current ? "/reading/stats" : `/reading/stats?year=${y}`}
                aria-current={y === year ? "page" : undefined}
                className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm transition-colors pointer-coarse:h-11 ${
                  y === year ? "border-accent-rose/10 bg-accent-plum/80 text-fg-primary" : "border-transparent text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary"
                }`}
              >
                {y ?? "All time"}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {empty && <EmptyState icon={BarChart3} title={`No reading in ${span}`} description="Finished books, sessions and pages show here." />}
      <div className="space-y-14">
        {!empty && (
          <StatsSection title={year === null ? "All time in numbers" : `${year} in numbers`} id="numbers">
            <NumberTiles
              tiles={[
                { label: "Books finished", value: n(numbers.books) },
                { label: "Pages", value: n(numbers.pages) },
                { label: "Hours", value: n(numbers.hours) },
                { label: "Reading days", value: n(numbers.readingDays) },
                {
                  label: "Average rating",
                  value: numbers.avgRating === null ? "None" : formatRating(Math.round(numbers.avgRating * 10) / 10),
                },
                { label: "Re-reads", value: n(numbers.rereads) },
                { label: "Abandoned", value: n(numbers.abandoned) },
                {
                  label: "Average length",
                  value: numbers.avgLength === null ? "None" : `${n(numbers.avgLength)} p.`,
                },
              ]}
            />
            {[
              audioNote(numbers.audioWithoutPages),
              year === null && numbers.undated
                ? `${count(numbers.undated, "finished book")} with no known date ${numbers.undated === 1 ? "is" : "are"} in the totals, in no chart.`
                : null,
            ]
              .filter(Boolean)
              .map((t) => (
                <Footnote key={t}>{t}</Footnote>
              ))}
            {/* This year's goals as cards; a past year's as its results */}
            {goals.length > 0 && year === current && <GoalCards goals={goals} serverToday={today} dayStartHour={settings.readingDayStartHour} />}
            {goals.length > 0 && year !== current && (
              <div className="space-y-1 text-sm text-fg-primary" data-stats-goals="">
                {goals.map((g) => (
                  <p key={g.metric}>
                    {pastGoalText(g)}
                    {g.count >= g.target && g.reachedOn ? `. ${reachedText(g.reachedOn, g.reachedPrecision ?? "day")}.` : "."}
                  </p>
                ))}
              </div>
            )}
          </StatsSection>
        )}

        {months.bars.some((b) => b.books || b.pages) || months.unknown ? (
          <StatsSection title={year === null ? "Over the years" : "Over the year"} id="over-time">
            <div className="grid gap-8 lg:grid-cols-2">
              {(["books", "pages"] as const).map((metric) => {
                // The Month unknown bar only for a metric it holds something of
                const unknown = months.unknown && months.unknown[metric] > 0 ? months.unknown : null;
                const bars = [...months.bars, ...(unknown ? [unknown] : [])].map((b) => ({
                  label: b.key === null ? "?" : year === null ? String(b.key) : MONTHS_SHORT[b.key - 1],
                  value: b[metric],
                  text: `${b.key === null ? `Month unknown, ${year}` : year === null ? b.key : `${MONTHS[b.key - 1]} ${year}`}: ${count(b[metric], metric === "books" ? "book" : "page")}`,
                }));
                return (
                  <BarChart
                    key={metric}
                    label={`${metric === "books" ? "Books finished" : "Pages read"} by ${year === null ? "year" : "month"}`}
                    bars={bars}
                    summaryUnit={metric}
                    tone={metric === "books" ? "sage" : "blue"}
                    columns={[year === null ? "Year" : "Month", metric === "books" ? "Books" : "Pages"]}
                    minRows={months.bars.length + (months.unknown ? 1 : 0)}
                    footnote={[
                      unknown ? "“?” holds the readings dated only by the year." : null,
                      months.undated ? `${count(months.undated, "reading")} with unknown dates ${months.undated === 1 ? "is" : "are"} not shown.` : null,
                      metric === "pages" ? audioNote(numbers.audioWithoutPages) : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                );
              })}
            </div>
          </StatsSection>
        ) : null}

        {days.calendar.length > 0 || days.weekdays.some((w) => w.sessions) ? (
          <StatsSection title="Reading days" id="days">
            {year !== null && days.calendar.length > 0 && <CalendarHeatmap year={year} weekStart={settings.readingWeekStart} days={days.calendar} />}
            {days.weekdays.some((w) => w.sessions) && (
              <>
                {peakWords(days.peak) && <p className="text-sm text-fg-primary">You read most on {peakWords(days.peak)}.</p>}
                <div className="grid gap-8 lg:grid-cols-2">
                  {(() => {
                    const timed = days.weekdays.some((w) => w.minutes > 0);
                    const value = (x: { minutes: number; sessions: number }) => Math.round(timed ? x.minutes : x.sessions);
                    const unit = timed ? "minutes" : "sessions";
                    return (
                      <>
                        <BarChart
                          label="Reading by weekday"
                          bars={days.weekdays.map((w) => ({
                            label: WEEKDAYS[w.weekday - 1].slice(0, 3),
                            value: value(w),
                            text: `${WEEKDAYS[w.weekday - 1]}: ${timed ? minutesLabel(w.minutes) : count(w.sessions, "session")}`,
                          }))}
                          summaryUnit={unit}
                          columns={["Weekday", timed ? "Minutes" : "Sessions"]}
                        />
                        <BarChart
                          label="Reading by time of day"
                          bars={days.partsOfDay.map((p) => ({
                            label: PARTS[p.part],
                            value: value(p),
                            text: `${PARTS[p.part]}: ${timed ? minutesLabel(p.minutes) : count(p.sessions, "session")}`,
                          }))}
                          summaryUnit={unit}
                          tone="blue"
                          columns={["Time of day", timed ? "Minutes" : "Sessions"]}
                          footnote={days.withoutStart ? `${count(days.withoutStart, "session")} with no start time ${days.withoutStart === 1 ? "is" : "are"} left out.` : undefined}
                        />
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </StatsSection>
        ) : null}

        {rated.distribution.some((d) => d.count) ? (
          <StatsSection title="Ratings" id="ratings">
            <BarChart
              label="Books by rating"
              bars={rated.distribution.map((d) => ({
                label: formatRating(d.rating),
                value: d.count,
                text: `${formatRating(d.rating)} stars: ${count(d.count, "book")}`,
              }))}
              summaryUnit="books"
              columns={["Rating", "Books"]}
            />
            {rated.reread.length > 0 && (
              <div>
                <SectionHeading as="h3" title="Most re-read" />
                {/* On touch the rows are 44px apart, so the links' press areas do not overlap */}
                <ul className="space-y-1.5 text-sm pointer-coarse:space-y-5" data-stats-reread="">
                  {rated.reread.map((r) => (
                    <li key={r.workId} className="flex items-baseline justify-between gap-3">
                      {/* The title cuts off inside the link: the link's touch area is not clipped */}
                      <Link href={book(r)} className="min-w-0 text-fg-primary transition-colors hover:text-accent-rose-text touch-hit">
                        <span className="lines-1">{r.title}</span>
                      </Link>
                      <span className="shrink-0 text-xs text-fg-secondary tabular-nums">{r.reads.map((x) => (x === null ? "unrated" : formatRating(x))).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
                {rated.higherOnReread > 0 && <Footnote>Rated higher on a re-read {count(rated.higherOnReread, "time")}.</Footnote>}
              </div>
            )}
          </StatsSection>
        ) : null}

        {length.lengths.some((l) => l.count) || length.pace.length ? (
          <StatsSection title="Length and pace" id="length">
            {length.lengths.some((l) => l.count) && (
              <BarChart
                label="Books by length in pages"
                bars={length.lengths.map((l) => ({
                  label: l.label,
                  value: l.count,
                  text: `${l.label} pages: ${count(l.count, "book")}`,
                }))}
                summaryUnit="books"
                columns={["Pages", "Books"]}
              />
            )}
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2" data-stats-extremes="">
              {(
                [
                  ["Longest", length.longest, (v: number) => `${n(v)} p.`],
                  ["Shortest", length.shortest, (v: number) => `${n(v)} p.`],
                  ["Fastest", length.fastest, (v: number) => `${count(v, "day")} from start to finish`],
                  ["Slowest", length.slowest, (v: number) => `${count(v, "day")} from start to finish`],
                ] as const
              )
                .filter(([, ref]) => ref)
                .map(([label, ref, words]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-fg-secondary">{label}</dt>
                    <dd className="lines-1">
                      <Link href={book(ref!)} className="text-fg-primary transition-colors hover:text-accent-rose-text">
                        {ref!.title}
                      </Link>
                      <span className="text-fg-secondary"> · {words(ref!.value)}</span>
                    </dd>
                  </div>
                ))}
            </dl>
            <RankList
              title="Pages an hour"
              items={length.pace.map((p) => ({
                label: `${lang(p.language)} · ${FORMATS[p.format] ?? p.format}`,
                value: p.pagesPerHour,
                text: `${n(p.pagesPerHour)} pages an hour, ${n(p.hours)} h`,
              }))}
            />
          </StatsSection>
        ) : null}

        {langs.languages.length ? (
          <StatsSection title="Languages and translation" id="languages">
            {langs.known > 0 && (
              <p className="text-sm text-fg-primary" data-stats-translation="">
                {Math.round((langs.translated / langs.known) * 100)}% in translation
                {langs.topSource ? `; ${n(langs.topSource.count)} from ${lang(langs.topSource.language)}` : ""}.
              </p>
            )}
            <div className="grid gap-8 lg:grid-cols-2">
              <RankList
                title="Original languages"
                items={langs.languages.slice(0, 10).map((l) => ({
                  label: lang(l.language),
                  value: l.count,
                  text: count(l.count, "book"),
                }))}
              />
              <RankList
                title="Translators"
                items={langs.translators.map((t) => ({
                  label: t.name,
                  href: `/people/${t.slug}`,
                  value: t.count,
                  text: count(t.count, "book"),
                }))}
              />
            </div>
          </StatsSection>
        ) : null}

        {authors.byBooks.length ? (
          <StatsSection title="Authors" id="authors">
            <div className="grid gap-8 lg:grid-cols-2">
              <RankList
                title="Most read, by books"
                items={authors.byBooks.map((a) => ({
                  label: a.name,
                  href: `/people/${a.slug}`,
                  value: a.books,
                  text: count(a.books, "book"),
                }))}
              />
              <RankList
                title="Most read, by pages"
                items={authors.byPages.map((a) => ({
                  label: a.name,
                  href: `/people/${a.slug}`,
                  value: a.pages,
                  text: count(a.pages, "page"),
                }))}
              />
              <RankList
                title="Where they come from"
                items={authors.countries.slice(0, 10).map((c) => ({
                  label: shortCountryName(c.country),
                  href: nationalityFilterHref(c.code),
                  value: c.authors,
                  text: count(c.authors, "author"),
                }))}
              />
              <RankList
                title="Gender, as recorded"
                items={authors.genders.map((g) => ({
                  label: g.gender === "female" ? "Women" : g.gender === "male" ? "Men" : "Not recorded",
                  value: g.authors,
                  text: count(g.authors, "author"),
                }))}
              />
            </div>
            {authors.newAuthors.length > 0 && (
              <p className="text-sm text-fg-secondary" data-stats-new-authors="">
                New authors in {year}: <NameList people={authors.newAuthors} />.
              </p>
            )}
          </StatsSection>
        ) : null}

        {written.centuries.length || written.movements.length || written.workTypes.length || written.categories.length ? (
          <StatsSection title="When the books were written" id="written">
            {written.decades.length > 0 && (
              <BarChart
                label="Books by the decade they were written"
                bars={written.decades.map((d) => ({
                  label: `${d.decade}s`,
                  value: d.count,
                  text: `The ${d.decade}s: ${count(d.count, "book")}`,
                }))}
                summaryUnit="books"
                columns={["Decade", "Books"]}
                footnote={`By century: ${written.centuries.map((c) => `${c.century}${c.century === 1 ? "st" : c.century === 2 ? "nd" : c.century === 3 ? "rd" : c.century === 21 ? "st" : "th"} ${n(c.count)}`).join(", ")}.`}
              />
            )}
            <div className="grid gap-8 lg:grid-cols-3">
              <RankList
                title="Literary movements"
                items={written.movements.map((m) => ({
                  label: m.name,
                  value: m.count,
                  text: count(m.count, "book"),
                }))}
              />
              <RankList
                title="Work types"
                items={written.workTypes.map((m) => ({
                  label: m.name,
                  value: m.count,
                  text: count(m.count, "book"),
                }))}
              />
              <RankList
                title="Categories"
                items={written.categories.map((m) => ({
                  label: m.name,
                  value: m.count,
                  text: count(m.count, "book"),
                }))}
              />
            </div>
          </StatsSection>
        ) : null}

        {where.formats.length || where.homes.length ? (
          <StatsSection title="Where and how" id="where">
            <div className="grid gap-8 lg:grid-cols-3">
              <RankList
                title="Formats"
                items={where.formats.map((f) => ({
                  label: FORMATS[f.format] ?? f.format,
                  value: f.minutes || f.pages,
                  text: [f.minutes ? minutesLabel(f.minutes) : null, f.pages ? count(f.pages, "page") : null].filter(Boolean).join(", ") || count(f.readings, "reading"),
                }))}
              />
              <RankList
                title="Homes"
                items={where.homes.map((h) => ({
                  label: h.home ?? "Home not recorded",
                  value: h.readings,
                  text: count(h.readings, "reading"),
                }))}
              />
              <RankList
                title="Copies"
                items={[
                  {
                    label: "Your own copy",
                    value: where.ownCopy,
                    text: count(where.ownCopy, "reading"),
                  },
                  {
                    label: "No copy (borrowed, library)",
                    value: where.noCopy,
                    text: count(where.noCopy, "reading"),
                  },
                ].filter((c) => c.value)}
              />
            </div>
          </StatsSection>
        ) : null}

        {shelf.counted || shelf.readBeforeOwned || shelf.withoutAcquisitionDate ? (
          <StatsSection title="Shelf time" id="shelf">
            {shelf.avgDays !== null && (
              <p className="text-sm text-fg-primary" data-stats-shelf="">
                On average a book waits {durationWords(shelf.avgDays)} on your shelves.
              </p>
            )}
            <RankList
              title="The longest waits"
              items={shelf.longest.map((b) => ({
                label: b.title,
                href: book(b),
                value: b.value,
                text: `${durationWords(b.value)}, from ${dayLabel(b.acquired)}`,
              }))}
            />
            <Footnote>
              {[
                shelf.readBeforeOwned ? `${count(shelf.readBeforeOwned, "book")} read before you owned ${shelf.readBeforeOwned === 1 ? "it" : "them"}` : null,
                shelf.withoutAcquisitionDate ? `${n(shelf.withoutAcquisitionDate)} without an acquisition date` : null,
                shelf.withoutPreciseStart ? `${n(shelf.withoutPreciseStart)} without a precise start` : null,
              ]
                .filter(Boolean)
                .join("; ")}
            </Footnote>
          </StatsSection>
        ) : null}

        {pile.books > 0 ? (
          <StatsSection
            title="The unread pile"
            id="pile"
            action={
              <Link
                href="/library?reading=unread&holding=owned"
                className="text-xs whitespace-nowrap text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
                data-stats-pile-link=""
              >
                See them
              </Link>
            }
          >
            <p className="text-sm text-fg-primary" data-stats-pile="">
              {count(pile.books, "book")} you own and have not read, {count(pile.pages, "page")}
              {pile.years !== null ? `: at your pace over the last three years, about ${durationWords(pile.years * 365.25)} to read them all` : ""}.
            </p>
            {pile.atHand.some((h) => h.books) && (
              <p className="text-sm text-fg-secondary" data-stats-pile-homes="">
                {pile.atHand
                  .filter((h) => h.books)
                  .map((h, i) => `${n(h.books)}${i === 0 ? " at hand" : ""} in ${h.home}`)
                  .join(", ")}
                .
              </p>
            )}
            {pile.withoutPages > 0 && <Footnote>{n(pile.withoutPages)} without a page count.</Footnote>}
          </StatsSection>
        ) : null}

        {recommenders.length ? (
          <StatsSection title="Recommenders" id="recommenders">
            <RankList
              items={recommenders.map((r) => ({
                label: r.name,
                href: `/recommenders/${r.recommenderId}`,
                value: r.read,
                text: `${n(r.read)} read${r.rated ? `, ${n(r.liked)} rated 4 or more, ${formatRating(Math.round(r.avgRating! * 10) / 10)} on average` : ""}`,
              }))}
            />
          </StatsSection>
        ) : null}

        {dropped.count ? (
          <StatsSection title="Abandoned" id="abandoned">
            <p className="text-sm text-fg-primary">
              {count(dropped.count, "book")} abandoned
              {dropped.medianPercent !== null ? `, usually at ${Math.round(dropped.medianPercent)}% of the book` : ""}.
            </p>
            <RankList
              items={dropped.reasons.map((r) => ({
                label: r.reason ? (ABANDON_REASON_LABELS[r.reason as AbandonReason] ?? r.reason) : "No reason given",
                value: r.count,
                text: count(r.count, "book"),
              }))}
            />
          </StatsSection>
        ) : null}

        {found.length ? (
          <StatsSection title="Insights" id="insights">
            <ul className="space-y-3" data-stats-insights="">
              {found.map((i) => (
                <li key={i.key}>
                  <p className="text-sm text-fg-primary">{i.text}.</p>
                  <p className="text-xs text-fg-secondary">
                    {i.numbers} ·{" "}
                    <Link href={i.href} className="underline-offset-2 hover:text-fg-primary hover:underline">
                      See them
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          </StatsSection>
        ) : null}
      </div>
    </>
  );
}
