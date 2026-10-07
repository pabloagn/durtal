import Link from "next/link";
import { cookies } from "next/headers";
import { ListOrdered } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions } from "@/components/reading/hub-actions";
import { QueueList, type QueueRow } from "@/components/reading/queue-list";
import { QueueHomeFilter } from "@/components/reading/queue-home-filter";
import { db } from "@/lib/db";
import { locations } from "@/lib/db/schema";
import { getQueue } from "@/lib/actions/reading-queue";
import { getPaceContext } from "@/lib/actions/reading";
import { READING_HOME_KEY } from "@/lib/preferences";
import { formatOfCopy } from "@/lib/reading/constants";
import { formatReadingDate } from "@/lib/reading/dates";
import { readingToday } from "@/lib/reading/day";
import { readingHomes } from "@/lib/reading/page-data";
import { formatMinutes } from "@/lib/reading/positions";
import { queueAtHand, queueEdition, queueSummary, queueWhereabouts, readHistory, timeToRead, timeToReadText } from "@/lib/reading/queue";

export const metadata = { title: "Up next" };

/** Rows a page shows at first and each "Show more" adds: a long list stays within the page budget */
const QUEUE_PAGE = 50;

/*
 * Up Next (SLN-452): the books he wants to read next, in his order, with
 * where each copy is and how long the list would take at his pace.
 */
export default async function UpNextPage({ searchParams }: { searchParams: Promise<{ hand?: string; show?: string }> }) {
  const { hand, show } = await searchParams;
  let stored: string | null = null;
  try {
    const raw = (await cookies()).get(READING_HOME_KEY)?.value;
    stored = raw ? (JSON.parse(raw) as string | null) : null;
  } catch {
    stored = null;
  }
  const places = await db.select({ id: locations.id, name: locations.name, type: locations.type, isActive: locations.isActive }).from(locations);
  const homes = readingHomes(places);
  const home = homes.find((h) => h.id === stored) ?? null;
  const [items, pace, today] = await Promise.all([getQueue({ homeId: home?.id ?? null }), getPaceContext([]), readingToday()]);

  const rows = items.map((item, i) => {
    const edition = queueEdition(item.editions, item.editionId, home?.id ?? null);
    const copy = edition?.copies.find((c) => c.status !== "deaccessioned");
    const format = edition?.audioMinutes ? "audio" : formatOfCopy(copy?.format);
    const time = timeToRead(edition, format, pace.priors);
    // The length the time counts: no page count outside 16 to 3,000 pages
    const length = time.kind === "audio" ? formatMinutes(time.minutes) : time.kind === "pages" ? `${time.pages} p.` : null;
    const row: QueueRow = {
      workId: item.workId,
      place: i + 1,
      title: item.title,
      href: `/library/${item.slug ?? item.workId}`,
      author: item.author,
      cover: edition?.thumbnail ?? item.workCover ?? item.editions.find((e) => e.thumbnail)?.thumbnail ?? null,
      editionId: edition?.id ?? null,
      line: [length, queueWhereabouts(item.editions, item.atHandCopyId, today), timeToReadText(time)].filter(Boolean).join(" · "),
      note: item.note,
      added: [
        `Added ${formatReadingDate(item.addedAt.slice(0, 10), "day", { omitYear: item.addedAt.slice(0, 4) === today.slice(0, 4) })}`,
        readHistory(item.readCount, item.lastFinishedOn),
      ]
        .filter(Boolean)
        .join(" · "),
    };
    return { row, time, atHand: queueAtHand(item.editions, home?.id ?? null) };
  });
  const handOnly = !!home && hand === "1";
  // At hand first, then the first 50 (or as many as "Show more" asked for)
  const matching = handOnly ? rows.filter((r) => r.atHand) : rows;
  const limit = Math.max(QUEUE_PAGE, Math.floor(Number(show)) || 0);
  const shown = matching.slice(0, limit);
  const remaining = matching.length - shown.length;
  const more = new URLSearchParams({ ...(handOnly ? { hand: "1" } : {}), show: String(limit + QUEUE_PAGE) });

  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
      {rows.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="Nothing in Up Next"
          description="Add the books you want to read next, in your order."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/library?reading=unread&holding=owned" className={`${buttonClass("secondary")} pointer-coarse:h-11`} data-queue-empty="">
                Add from your library
              </Link>
              {/* Suggestions (SLN-457): what to read next, from the books he owns */}
              <Link href="/reading/suggestions?scope=owned" className={`${buttonClass("secondary")} pointer-coarse:h-11`} data-queue-suggestions="">
                See suggestions
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-fg-secondary" data-queue-summary="">
              {queueSummary(rows.map((r) => r.time))}
            </p>
            <QueueHomeFilter home={home} homes={homes} on={handOnly} />
          </div>
          {shown.length ? (
            <>
              <QueueList key={handOnly ? "hand" : "all"} rows={shown.map((r) => r.row)} filtered={handOnly} />
              {remaining > 0 && (
                <Link
                  href={`/reading/next?${more.toString()}`}
                  scroll={false}
                  className="inline-flex h-8 items-center text-sm text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:h-11"
                  data-queue-more=""
                >
                  Show {Math.min(QUEUE_PAGE, remaining)} more
                </Link>
              )}
            </>
          ) : (
            <p className="text-sm text-fg-secondary">Nothing in Up Next is at hand in {home?.name}.</p>
          )}
        </div>
      )}
    </>
  );
}
