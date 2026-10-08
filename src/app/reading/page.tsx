import Link from "next/link";
import { ArrowRight, BookMarked } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions, HubMenu, QueueStartButton, StartBookButton } from "@/components/reading/hub-actions";
import { GoalCards } from "@/components/reading/goal-card";
import { Rhythm } from "@/components/reading/rhythm";
import { GoalDialogButton } from "@/components/reading/goal-dialog-button";
import { getGoalProgress, getRhythm } from "@/lib/actions/reading-goals";
import { CurrentReadingCard, PausedRow, finishedItem } from "@/components/reading/hub-cards";
import { Cover, FinishedCovers } from "@/components/reading/reading-tiles";
import { getQueueHead } from "@/lib/actions/reading-queue";
import { getOpenReadings } from "@/lib/actions/reading";
import { getPassageOfTheDay } from "@/lib/actions/reading-notes";
import { PassageOfTheDay } from "@/components/reading/passage-of-the-day";
import { getRecentlyFinished } from "@/lib/reading/journal";
import { readingDay } from "@/lib/reading/dates";
import { readingDayStartHour } from "@/lib/reading/day";
import { addDays } from "@/lib/reading/goals";
import { finishedYears, onThisDay } from "@/lib/reading/stats";
import { OnThisDay } from "@/components/reading/on-this-day";
import { SuggestionActions } from "@/components/reading/suggestions/suggestion-list";
import { storedHomeId } from "@/lib/reading/home-cookie";
import { getSuggestionContext } from "@/lib/reading/suggest/context";
import { DEFAULT_SUGGESTION_PARAMS } from "@/lib/reading/suggest/params";
import { suggest } from "@/lib/reading/suggest/score";
import { suggestionRow } from "@/lib/reading/suggest/view";
import { readingEstimates } from "@/lib/reading/estimates";
import { appTimeZone } from "@/lib/utils/date";

export const metadata = { title: "Reading" };

/*
 * The reading hub (SLN-448): what is being read now, the goals and the weekly
 * rhythm (SLN-455), Up next, the passage of the day, what is paused, and the
 * latest finished reads; above them On this day (SLN-456); after Up next,
 * three suggestions (SLN-457).
 */
export default async function ReadingPage() {
  const zone = appTimeZone();
  const dayStartHour = await readingDayStartHour();
  const day = { today: readingDay(new Date(), zone, dayStartHour), zone, dayStartHour };
  // The passage of the day (SLN-453): the server's reading day, so every device shows the same one
  // Goals and the rhythm (SLN-455): computed per request, never cached
  // On this day (SLN-456): the server's day and one on each side; the line shows the browser's
  const [open, finished, next, passage, goals, rhythm, past, years, suggestionContext] = await Promise.all([
    getOpenReadings(),
    getRecentlyFinished(6),
    getQueueHead(5),
    getPassageOfTheDay({ day: day.today }),
    getGoalProgress(Number(day.today.slice(0, 4))),
    getRhythm(),
    onThisDay([addDays(day.today, -1), day.today, addDays(day.today, 1)]),
    finishedYears(),
    // Suggestions (SLN-457): the top three Owned, computed per request
    storedHomeId().then((homeId) => getSuggestionContext({ homeId })),
  ]);
  const suggestions = suggest(suggestionContext, DEFAULT_SUGGESTION_PARAMS)
    .slice(0, 3)
    .map((s) => suggestionRow(s, suggestionContext));
  // In January, a link to the year just ended: this year and last, as the browser's year may differ by a day
  const year = Number(day.today.slice(0, 4));
  const reviewYears = years.map((y) => y.year).filter((y) => y === year || y === year - 1);
  const reading = open.filter((o) => o.reading.status === "reading");
  const estimates = await readingEstimates(
    reading.map((o) => o.reading.id),
    day.today,
  );
  const paused = open.filter((o) => o.reading.status === "paused");
  const empty = open.length === 0 && finished.length === 0 && next.length === 0 && !passage && goals.length === 0 && !rhythm.target && suggestions.length === 0;

  return (
    <>
      <PageHeader
        title="Reading"
        actions={
          <>
            <HubActions />
            <HubMenu rhythm={!!rhythm.target} />
          </>
        }
        tabs={<ReadingTabs />}
      />
      {empty ? (
        <EmptyState
          icon={BookMarked}
          title="Nothing read yet"
          description="Start a book to follow your progress here, or bring your reading history in."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <StartBookButton />
              <Link href="/reading/import" className={`${buttonClass("secondary")} pointer-coarse:h-11`} data-hub-import="">
                Import from Goodreads or StoryGraph
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-12">
          <OnThisDay hits={past} serverToday={day.today} dayStartHour={dayStartHour} reviewYears={reviewYears} />
          {reading.length > 0 && (
            <section>
              <SectionHeading title="Currently reading" count={reading.length} />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {reading.map((o) => (
                  <CurrentReadingCard key={o.reading.id} open={o} day={day} estimate={estimates[o.reading.id]} />
                ))}
              </div>
            </section>
          )}
          {goals.length > 0 && (
            <section data-hub-goals="">
              <SectionHeading title="Goals this year" action={<GoalDialogButton label="Edit goals" variant="ghost" size="sm" />} />
              <GoalCards goals={goals} serverToday={day.today} dayStartHour={dayStartHour} />
            </section>
          )}
          {rhythm.target && <Rhythm rhythm={{ ...rhythm, target: rhythm.target }} dayStartHour={dayStartHour} />}
          {next.length > 0 && (
            <section data-hub-next="">
              <SectionHeading
                title="Up next"
                action={
                  <Link href="/reading/next" className="flex items-center gap-1 whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit">
                    View all
                    <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
                  </Link>
                }
              />
              <ol className="grid grid-cols-3 gap-4 sm:grid-cols-5">
                {next.map((item) => (
                  <li key={item.workId} className="min-w-0" data-hub-next-item={item.workId}>
                    <Link href={`/library/${item.slug ?? item.workId}`} className="group block">
                      <Cover s3Key={item.cover} className="aspect-[2/3] w-full" />
                      <span className="lines-1 mt-2 text-sm text-fg-primary transition-colors group-hover:text-accent-primary">{item.title}</span>
                    </Link>
                    <div className="mt-1">
                      <QueueStartButton workId={item.workId} editionId={item.editionId} title={item.title} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {suggestions.length > 0 && (
            <section data-hub-suggestions="">
              <SectionHeading
                title="Suggestions"
                action={
                  <Link href="/reading/suggestions" className="flex items-center gap-1 whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit">
                    See all
                    <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
                  </Link>
                }
              />
              <ol className="grid gap-6 md:grid-cols-3">
                {suggestions.map((row) => (
                  <li key={row.workId} className="flex min-w-0 gap-3" data-hub-suggestion={row.workId}>
                    <Link href={row.href} tabIndex={-1} aria-label={row.title} className="shrink-0">
                      <Cover s3Key={row.cover} className="h-20 w-14" />
                    </Link>
                    <div className="min-w-0 flex-1 space-y-1">
                      {/* The title cuts off inside the link: the link's touch area is not clipped */}
                      <Link href={row.href} className="block text-sm text-fg-primary transition-colors hover:text-accent-primary touch-hit">
                        <span className="lines-1">{row.title}</span>
                      </Link>
                      {row.author && <p className="lines-1 text-xs text-fg-secondary">{row.author}</p>}
                      {row.reasons[0] && <p className="lines-2 text-xs text-fg-primary">{row.reasons[0]}</p>}
                      <SuggestionActions row={row} compact />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {passage && <PassageOfTheDay day={day.today} initial={passage.note} initialEdition={passage.edition} candidates={passage.candidates} />}
          {paused.length > 0 && (
            <section>
              <SectionHeading title="Paused" count={paused.length} />
              <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
                {paused.map((o) => (
                  <PausedRow key={o.reading.id} open={o} day={day} />
                ))}
              </ul>
            </section>
          )}
          {finished.length > 0 && (
            <section>
              <SectionHeading title="Recently finished" />
              <FinishedCovers reads={finished.map(finishedItem)} className="grid grid-cols-3 gap-4 sm:grid-cols-6" />
            </section>
          )}
        </div>
      )}
    </>
  );
}
