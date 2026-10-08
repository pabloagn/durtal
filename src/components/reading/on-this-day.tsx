"use client";

import { Fragment } from "react";
import Link from "next/link";
import type { OnThisDay as Hit } from "@/lib/reading/stats";
import { formatRating } from "@/lib/utils/rating";
import { useBrowserReadingDay } from "./reading-client";

/**
 * The Now page's "On this day" line (SLN-456): books finished or started on
 * this calendar day in earlier years, with the read's rating, and in January
 * a link to the year just ended. The server sends the matches for its
 * reading day and a day on each side; the line shows the browser's day.
 */
export function OnThisDay({ hits, serverToday, dayStartHour, reviewYears }: { hits: Hit[]; serverToday: string; dayStartHour: number; reviewYears: number[] }) {
  const today = useBrowserReadingDay(dayStartHour) ?? serverToday;
  const shown = hits.filter((h) => h.day === today).slice(0, 3);
  const reviewYear = Number(today.slice(0, 4)) - 1;
  const review = today.slice(5, 7) === "01" && reviewYears.includes(reviewYear);
  if (!shown.length && !review) return null;
  return (
    <p className="text-sm text-fg-secondary" data-hub-on-this-day="">
      {shown.map((h, i) => (
        <Fragment key={`${h.kind}-${h.workId}-${h.year}`}>
          {i === 0 ? "On this day in " : "; in "}
          {h.year} you {h.kind}{" "}
          <Link href={`/library/${h.slug ?? h.workId}`} className="text-fg-primary transition-colors hover:text-accent-primary">
            {h.title}
          </Link>
          {h.kind === "finished" && h.rating !== null ? ` (${formatRating(h.rating)})` : ""}
        </Fragment>
      ))}
      {shown.length > 0 && "."}
      {review && (
        <>
          {shown.length > 0 && " "}
          <Link href={`/reading/year/${reviewYear}`} className="text-fg-primary transition-colors hover:text-accent-primary" data-hub-review-link="">
            Your {reviewYear} in review
          </Link>
        </>
      )}
    </p>
  );
}
