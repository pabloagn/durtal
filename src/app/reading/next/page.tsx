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

/*
 * Up Next (SLN-452): the books he wants to read next, in his order, with
 * where each copy is and how long the list would take at his pace.
 */
export default async function UpNextPage({ searchParams }: { searchParams: Promise<{ hand?: string }> }) {
  const { hand } = await searchParams;
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

  const rows = items.map((item) => {
    const edition = queueEdition(item.editions, item.editionId, home?.id ?? null);
    const copy = edition?.copies.find((c) => c.status !== "deaccessioned");
    const format = edition?.audioMinutes ? "audio" : formatOfCopy(copy?.format);
    const time = timeToRead(edition, format, pace.priors);
    const length = edition?.audioMinutes ? formatMinutes(edition.audioMinutes) : edition?.pageCount ? `${edition.pageCount} p.` : null;
    const row: QueueRow = {
      workId: item.workId,
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
  const shown = handOnly ? rows.filter((r) => r.atHand) : rows;

  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
      {rows.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title="Nothing in Up Next"
          description="Add the books you want to read next, in your order."
          action={
            <Link href="/library?reading=unread&holding=owned" className={`${buttonClass("secondary")} pointer-coarse:h-11`} data-queue-empty="">
              Add from your library
            </Link>
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
            <QueueList key={handOnly ? "hand" : "all"} rows={shown.map((r) => r.row)} />
          ) : (
            <p className="text-sm text-fg-secondary">Nothing in Up Next is at hand in {home?.name}.</p>
          )}
        </div>
      )}
    </>
  );
}
