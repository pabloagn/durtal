"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionHeading } from "@/components/shared/section-heading";
import type { Rhythm as RhythmData } from "@/lib/actions/reading-goals";
import { readingDay } from "@/lib/reading/dates";
import { rhythmView } from "@/lib/reading/goals";
import { browserZone } from "./reading-client";

/*
 * The weekly reading rhythm (SLN-455): this week's seven days, filled when he
 * read, today marked, "4 of 5 days this week", and the 12 weeks before it as
 * small bars, "kept 9 of the last 12 weeks". No streak, nothing lost. Drawn
 * with the server's day, then the browser's.
 */
export function Rhythm({ rhythm, dayStartHour }: { rhythm: RhythmData & { target: number }; dayStartHour: number }) {
  const [today, setToday] = useState(rhythm.today);
  useEffect(() => {
    setToday(readingDay(new Date(), browserZone(), dayStartHour));
  }, [dayStartHour]);
  const view = rhythmView(rhythm.days, today, rhythm.weekStart, rhythm.target);
  return (
    <section data-hub-rhythm="">
      <SectionHeading
        title="This week"
        action={
          <Link
            href="/settings/reading#reading-rhythm-days"
            className="flex items-center whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:min-h-11"
          >
            Change
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ol className="flex gap-2" aria-label="Reading days this week">
          {view.week.map((d) => (
            <li key={d.day} className="flex flex-col items-center gap-1.5" data-rhythm-day={d.day} data-read={d.read ? "" : undefined} data-today={d.today ? "" : undefined}>
              <span
                aria-hidden
                className={`block h-4 w-4 rounded-sm border ${d.read ? "border-accent-sage bg-accent-sage" : "border-glass-border"} ${
                  d.today ? "outline outline-1 outline-offset-2 outline-fg-secondary" : ""
                }`}
              />
              <span aria-hidden className={`text-xs ${d.today ? "text-fg-primary" : "text-fg-secondary"}`}>
                {d.label.slice(0, 1)}
              </span>
              <span className="sr-only">
                {d.label}
                {d.today ? ", today" : ""}: {d.read ? "read" : "no reading"}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-fg-secondary" data-rhythm-week="">
          {view.thisWeek} of {rhythm.target} {rhythm.target === 1 ? "day" : "days"} this week
        </p>
      </div>
      <div className="mt-5 flex items-end gap-3">
        <div className="flex h-8 items-end gap-1" role="img" aria-label={`Reading days in each of the last 12 weeks: ${view.weeks.map((w) => w.days).join(", ")}`}>
          {view.weeks.map((w) => (
            <span
              key={w.start}
              className={`block w-2 rounded-sm ${w.kept ? "bg-accent-sage" : "bg-bg-tertiary"}`}
              style={{ height: `${4 + (w.days / 7) * 28}px` }}
              data-rhythm-week-bar={w.days}
            />
          ))}
        </div>
        <p className="text-xs text-fg-secondary" data-rhythm-kept="">
          kept {view.kept} of the last 12 weeks
        </p>
      </div>
    </section>
  );
}
