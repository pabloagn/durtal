import Link from "next/link";
import { BookMarked } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions, StartBookButton } from "@/components/reading/hub-actions";
import { CurrentReadingCard, PausedRow, finishedItem } from "@/components/reading/hub-cards";
import { FinishedCovers } from "@/components/reading/reading-tiles";
import { getOpenReadings } from "@/lib/actions/reading";
import { getRecentlyFinished } from "@/lib/reading/journal";
import { readingDay } from "@/lib/reading/dates";
import { readingDayStartHour } from "@/lib/reading/day";
import { readingEstimates } from "@/lib/reading/estimates";
import { appTimeZone } from "@/lib/utils/date";

export const metadata = { title: "Reading" };

/*
 * The reading hub (SLN-448): what is being read now, what is paused, and the
 * latest finished reads. Later steps add their blocks here (the timer, Up
 * next, a passage of the day, the goal, On this day, suggestions).
 */
export default async function ReadingPage() {
  const [open, finished] = await Promise.all([getOpenReadings(), getRecentlyFinished(6)]);
  const zone = appTimeZone();
  const dayStartHour = await readingDayStartHour();
  const day = { today: readingDay(new Date(), zone, dayStartHour), zone, dayStartHour };
  const reading = open.filter((o) => o.reading.status === "reading");
  const estimates = await readingEstimates(
    reading.map((o) => o.reading.id),
    day.today,
  );
  const paused = open.filter((o) => o.reading.status === "paused");
  const empty = open.length === 0 && finished.length === 0;

  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
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
