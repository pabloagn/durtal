"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import { undoToast } from "@/components/reading/reading-client";
import { markWorksRead, undoMarkWorksRead } from "@/lib/actions/reading-bulk";
import type { PossibleDuplicate, SkippedBook } from "@/lib/actions/reading-bulk";
import { formatReadingDate } from "@/lib/reading/dates";

type Result = { marked: number; possibleDuplicates: PossibleDuplicate[]; skipped: SkippedBook[] };

/** "already read: finished 14 Apr 2019", the read a possible duplicate matches */
function matchText(match: PossibleDuplicate["match"]) {
  if (!match) return "already read";
  if (!match.finishedOn || match.finishedPrecision === "unknown") return "already read, date unknown";
  return `already read: finished ${formatReadingDate(match.finishedOn, match.finishedPrecision)}`;
}

/**
 * Bulk Mark as read (SLN-463): one confirm, then the counts, each possible
 * duplicate with its match and a Confirm for that book alone, and the books
 * left out with their reasons. The toast's Undo removes what the write made.
 */
export function MarkReadDialog({ workIds, onClose }: { workIds: string[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());

  /** The toast after a write, with the Undo for exactly those readings */
  function toastFor(readingIds: string[], message: string) {
    undoToast(message, async () => {
      try {
        const undone = await undoMarkWorksRead({ readingIds });
        const kept = undone.kept.map((k) => `${k.title}: ${k.reason}`).join("; ");
        toast.success(`Removed ${undone.removed} ${undone.removed === 1 ? "read" : "reads"}${kept ? `. Kept ${kept}` : ""}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not undo");
      }
    });
  }

  async function markAll() {
    setPending(true);
    try {
      const done = await markWorksRead({ workIds });
      setResult(done);
      if (done.marked) toastFor(done.readingIds, `Marked ${done.marked} ${done.marked === 1 ? "book" : "books"} as read`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark the books as read");
    } finally {
      setPending(false);
    }
  }

  async function confirmOne(workId: string) {
    setPending(true);
    try {
      const done = await markWorksRead({ workIds: [workId], confirmDuplicates: [workId] });
      if (done.marked) {
        setConfirmed((prev) => new Set(prev).add(workId));
        toastFor(done.readingIds, "Marked as read again");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark the book as read");
    } finally {
      setPending(false);
    }
  }

  const count = workIds.length;
  return (
    <Dialog open onClose={onClose} title={`Mark ${count} ${count === 1 ? "book" : "books"} as read`} className="max-w-lg" expandable={false}>
      {!result ? (
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Each selected book gets one finished read, with its dates unknown. A book you are reading keeps its open read. To give a
            date, log the read on the book&apos;s page.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void markAll()} disabled={pending} data-mark-read-confirm="">
              Mark as read
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-mark-read-result="">
          <p className="text-sm text-fg-primary">
            {[
              `Marked ${result.marked}`,
              result.possibleDuplicates.length ? `${result.possibleDuplicates.length} possibly read already` : null,
              result.skipped.length ? `${result.skipped.length} left out` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {result.possibleDuplicates.length > 0 && (
            <ul className="space-y-2" data-mark-read-duplicates="">
              {result.possibleDuplicates.map((d) => (
                <li key={d.workId} className="flex gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="lines-1 text-fg-primary">{d.title}</p>
                    <p className="text-xs text-fg-secondary">{matchText(d.match)}</p>
                  </div>
                  <CapAligned height={28} coarseHeight={44}>
                    {confirmed.has(d.workId) ? (
                      <span className="flex h-7 items-center text-xs text-fg-secondary pointer-coarse:h-11">Marked</span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => void confirmOne(d.workId)} disabled={pending}>
                        Confirm
                      </Button>
                    )}
                  </CapAligned>
                </li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <ul className="space-y-2" data-mark-read-skipped="">
              {result.skipped.map((s) => (
                <li key={s.workId} className="min-w-0 text-sm">
                  <p className="lines-1 text-fg-primary">{s.title}</p>
                  <p className="text-xs text-fg-secondary">{s.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
