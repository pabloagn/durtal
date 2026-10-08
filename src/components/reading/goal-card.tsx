"use client";

import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/shared/progress-bar";
import { CapAligned } from "@/components/shared/cap-aligned";
import { getGoalProgress, type GoalProgress } from "@/lib/actions/reading-goals";
import { amountText, goalLine, goalShortLine, goalTitle, projection } from "@/lib/reading/goals";
import { useBrowserReadingDay } from "./reading-client";
import { EstimateInfo } from "./estimate-info";

/*
 * A reading goal (SLN-455): "12 of 30 books", a sage bar and one neutral
 * line. The server draws it with its reading day; after mount the browser
 * redraws the words with its own day, and loads its own year's goals when
 * that year differs (late on 31 December in Mexico City). The height never
 * changes.
 */

/** The goals of the browser's reading year: the server's until the two years differ */
function useBrowserGoals(goals: GoalProgress[], serverToday: string, day: string | null) {
  const [mine, setMine] = useState<{ year: string; goals: GoalProgress[] } | null>(null);
  const year = day?.slice(0, 4) ?? serverToday.slice(0, 4);
  useEffect(() => {
    if (year === serverToday.slice(0, 4) || mine?.year === year) return;
    let live = true;
    getGoalProgress(Number(year))
      .then((next) => live && setMine({ year, goals: next }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [year, serverToday, mine?.year]);
  return mine?.year === year && mine.goals.length ? mine.goals : goals;
}

const METRIC_WORDS = { books: "books finished", pages: "pages read", hours: "hours read" } as const;

/** What the info popover says: how the goal counts, the pace, the lengths, and what is left out */
function explanation(goal: GoalProgress, today: string): string {
  const lines: string[] = [];
  if (goal.metric === "books") lines.push("Counts books finished this year, at any date precision. Unknown dates and abandoned books never count.");
  if (goal.metric === "pages") lines.push("Counts each page once: pages read again up to where you had been are not counted twice.");
  if (goal.metric === "hours") lines.push("Only timed sessions count. Readings logged without a time add no hours.");
  lines.push(goal.countRereads ? "Re-reads count." : "Re-reads do not count.");
  if (goal.excludedWorkTypes.length) lines.push(`Left out: ${goal.excludedWorkTypes.join(", ")}.`);
  if (Number(today.slice(0, 4)) === goal.year && goal.last90 > 0)
    lines.push(`At your pace over the last 90 days, about ${amountText(goal.metric, Math.round(projection(goal, goal.last90, today)))} this year.`);
  if (goal.avgPages)
    lines.push(
      `${Math.round(goal.avgPages).toLocaleString("en-US")} pages on average${goal.avgPagesLastYear ? `; ${Math.round(goal.avgPagesLastYear).toLocaleString("en-US")} last year` : ""}.`,
    );
  if (goal.metric === "pages" && goal.audioWithoutPages)
    lines.push(`${goal.audioWithoutPages} ${goal.audioWithoutPages === 1 ? "audiobook is" : "audiobooks are"} not counted in pages.`);
  return lines.join("\n");
}

function Card({ goal, today }: { goal: GoalProgress; today: string }) {
  const title = goalTitle(goal.metric, goal.count, goal.target);
  return (
    <article className="rounded-sm border border-glass-border bg-bg-secondary p-4" data-goal-card={goal.metric}>
      <div className="type-item-title flex items-start gap-2">
        <h3 className="min-h-[1lh] [overflow-wrap:anywhere] min-w-0 flex-1" data-goal-title="">
          {title}
        </h3>
        <CapAligned height={24} coarseHeight={44}>
          <EstimateInfo text={explanation(goal, today)} label={`How the ${METRIC_WORDS[goal.metric]} goal counts`} />
        </CapAligned>
      </div>
      <ProgressBar value={Math.min(goal.count, goal.target)} max={goal.target} label={title} tone="sage" className="mt-3" />
      <p className="min-h-[2lh] [overflow-wrap:anywhere] mt-2 text-xs text-fg-secondary" data-goal-line="">
        {goalLine(goal, today)}
      </p>
    </article>
  );
}

/** The hub's goal cards */
export function GoalCards({ goals, serverToday, dayStartHour }: { goals: GoalProgress[]; serverToday: string; dayStartHour: number }) {
  const day = useBrowserReadingDay(dayStartHour);
  const shown = useBrowserGoals(goals, serverToday, day);
  const today = day ?? serverToday;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {shown.map((goal) => (
        <Card key={goal.id} goal={goal} today={today} />
      ))}
    </div>
  );
}

/** The dashboard's one line: "12 of 30 books this year · on pace" */
export function GoalLine({ goal, serverToday, dayStartHour }: { goal: GoalProgress; serverToday: string; dayStartHour: number }) {
  const day = useBrowserReadingDay(dayStartHour);
  const current = useBrowserGoals([goal], serverToday, day).find((g) => g.metric === goal.metric) ?? goal;
  const today = day ?? serverToday;
  return (
    <p className="min-h-[1lh] [overflow-wrap:anywhere] text-sm text-fg-secondary" data-dashboard-goal="">
      {goalTitle(current.metric, current.count, current.target)} this year · {goalShortLine(current, today)}
    </p>
  );
}
