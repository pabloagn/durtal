import Link from "next/link";
import { formatLabel } from "@/lib/ebooks/formats";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
import type { ContinueAnchor, ContinueDescriptor } from "@/lib/ebooks/continue-target";
import { isEbookFileNativeReadable } from "@/lib/ebooks/conditions";
import { fractionPercent } from "@/lib/reader/place-label";
import { formatFullDate, formatRelativeTime } from "@/lib/utils/relative-time";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { buttonClass } from "@/components/ui/button";

const sameDevice = (a: ContinueAnchor | null, b: ContinueAnchor) => !!a && a.deviceLabel === b.deviceLabel;

/**
 * Reading places, one row per device (SLN-665): where each device was last,
 * how far that is, and a link that opens the book there. The page reads
 * only each device's newest place, so a book read on many devices, or in many
 * sittings, stays a short list; the newest five show, the rest behind "Show
 * all devices".
 */
export function EbookPlaces({
  ebook,
  descriptor,
  returnTo,
  allDevices,
}: {
  ebook: EbookDetail;
  descriptor: ContinueDescriptor | null;
  returnTo: string;
  allDevices: boolean;
}) {
  const devices = ebook.places?.devices ?? ebook.positions;
  const count = ebook.places?.deviceCount ?? devices.length;
  const heading = (description?: string) => (
    <SectionHeading title="Reading places" count={count || undefined} description={description} />
  );
  if (!devices.length)
    return <>
      {heading()}
      <p className="text-sm text-fg-secondary">Not opened on any device yet.</p>
    </>;
  return (
    <>
      {heading(count === 1 ? "Read opens at this place." : "Read opens at the newest place.")}
      <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary/70">
        {devices.map((place) => {
          const file = ebook.files.find((candidate) => candidate.id === place.fileId);
          const fraction = Math.min(1, Math.max(0, place.locator.totalProgression));
          const opensNext = sameDevice(descriptor?.anchor ?? null, place);
          // A replaced file's place opens in the current file of that format
          const readable = file && isEbookFileNativeReadable(file) && file.status !== "replaced";
          const query = new URLSearchParams({ ...(readable ? { file: place.fileId } : {}), from: place.deviceId });
          return (
            <li key={place.deviceLabel} className="flex items-start gap-4 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-fg-primary">
                  {place.deviceLabel}
                  {opensNext && <span className="ml-2 inline-block whitespace-nowrap text-xs text-accent-primary">Opens next</span>}
                </p>
                <p className="mt-1 text-fg-secondary">
                  {fractionPercent(fraction)}
                  {place.chapter ? ` · ${place.chapter}` : ""}
                </p>
                <div className="mt-2 h-0.5 max-w-60 rounded-full bg-glass-border" aria-hidden>
                  <div className="h-full rounded-full bg-fg-secondary" style={{ width: `${fraction * 100}%` }} />
                </div>
                <p className="mt-2 text-xs text-fg-secondary">
                  <time dateTime={new Date(place.clientUpdatedAt).toISOString()} data-tooltip={formatFullDate(place.clientUpdatedAt)}>
                    {formatRelativeTime(place.clientUpdatedAt)}
                  </time>
                  {" · "}
                  {file ? formatLabel(file.format) : "Earlier file"}
                  {file?.status === "replaced" || !file ? " · opens in the current file" : ""}
                </p>
              </div>
              {descriptor && (
                <CapAlignedControls height={28} coarseHeight={44}>
                  <ReaderEntryLink
                    readerPath={`/reader/${ebook.id}?${query}`}
                    returnTo={returnTo}
                    className={buttonClass("secondary", "sm")}
                    aria-label={`Read from ${place.deviceLabel}'s place`}
                  >
                    Read from here
                  </ReaderEntryLink>
                </CapAlignedControls>
              )}
            </li>
          );
        })}
      </ul>
      {count > devices.length && allDevices ? (
        <p className="mt-3 text-sm text-fg-secondary">The newest {devices.length} of {count} devices.</p>
      ) : count > devices.length ? (
        <Link href={`/ebooks/${ebook.id}?places=all#places`} scroll={false}
          className="touch-hit mt-3 inline-block text-sm text-accent-primary">
          Show all {count} devices
        </Link>
      ) : allDevices && count > 5 ? (
        <Link href={`/ebooks/${ebook.id}#places`} scroll={false}
          className="touch-hit mt-3 inline-block text-sm text-accent-primary">
          Show the newest five
        </Link>
      ) : null}
    </>
  );
}
