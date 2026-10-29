"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { showError, undoToast } from "../reading-client";
import { Cover } from "../reading-tiles";
import { Undo2 } from "lucide-react";
import { removeSuggestionFeedback, restoreSuggestionFeedback } from "@/lib/actions/catalogue-client";

export interface HiddenRow {
  workId: string;
  title: string;
  href: string;
  author: string | null;
  cover: string | null;
  /** "Not now, until 3 Nov", "Never", "Not for me: Too long, The prose" */
  verdict: string;
  note: string | null;
  /** "Hidden on 5 Oct" */
  date: string;
}

/** The Hidden view (SLN-457): every Not now, Never and Not for me, each with Undo, which makes the book a candidate again */
export function HiddenList({ rows }: { rows: HiddenRow[] }) {
  const router = useRouter();
  // A row stays busy from the press until the refresh takes it away, so a
  // second press cannot run the removal again
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const release = (workId: string) => {
    inFlight.current.delete(workId);
    setBusy(new Set(inFlight.current));
  };
  // Once the refresh has taken a row away, it is free again: Undo in the
  // toast brings it back pressable
  useEffect(() => {
    const shown = new Set(rows.map((row) => row.workId));
    for (const workId of inFlight.current) if (!shown.has(workId)) release(workId);
  }, [rows]);
  async function undo(row: HiddenRow) {
    if (inFlight.current.has(row.workId)) return;
    inFlight.current.add(row.workId);
    setBusy(new Set(inFlight.current));
    try {
      const removed = await removeSuggestionFeedback({ workId: row.workId });
      router.refresh();
      if (!removed) release(row.workId);
      if (removed)
        undoToast(`${row.title} is back in suggestions`, async () => {
          try {
            await restoreSuggestionFeedback(removed);
            router.refresh();
          } catch (err) {
            showError(err, () => router.refresh());
            return false;
          }
        }, "Previous suggestion feedback restored");
    } catch (err) {
      release(row.workId);
      showError(err, () => router.refresh());
    }
  }
  return (
    <ol className="rounded-sm border border-glass-border" data-hidden-list="">
      {rows.map((row) => (
        <li key={row.workId} className="flex items-start gap-4 border-t border-glass-border px-3 py-3 first:border-t-0" data-hidden={row.workId}>
          <Cover s3Key={row.cover} title={row.title} className="h-16 w-11" />
          <div className="min-w-0 flex-1 space-y-0.5">
            {/* Title and author wrap in full (SLN-879) */}
            <h3 className="[overflow-wrap:anywhere]">
              <Link href={row.href} className="block text-sm text-fg-primary transition-colors hover:text-accent-primary touch-hit">
                {row.title}
              </Link>
            </h3>
            {row.author && <p className="text-xs text-fg-secondary [overflow-wrap:anywhere]">{row.author}</p>}
            <p className="text-xs text-fg-primary" data-hidden-verdict="">
              {row.verdict}
            </p>
            {row.note && <p className="text-xs italic text-fg-secondary">{row.note}</p>}
            <p className="text-xs text-fg-secondary">{row.date}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void undo(row)} busy={busy.has(row.workId)} className="pointer-coarse:h-11" data-hidden-undo={row.workId}>
            <Undo2 aria-hidden strokeWidth={1.5} />
            Undo
          </Button>
        </li>
      ))}
    </ol>
  );
}
