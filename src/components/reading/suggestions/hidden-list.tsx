"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { removeSuggestionFeedback, restoreSuggestionFeedback } from "@/lib/actions/suggestions";
import { showError, undoToast } from "../reading-client";
import { Cover } from "../reading-tiles";

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
  async function undo(row: HiddenRow) {
    try {
      const removed = await removeSuggestionFeedback({ workId: row.workId });
      router.refresh();
      if (removed)
        undoToast(`${row.title} is back in suggestions`, async () => {
          try {
            await restoreSuggestionFeedback(removed);
            router.refresh();
          } catch (err) {
            showError(err, () => router.refresh());
          }
        });
    } catch (err) {
      showError(err, () => router.refresh());
    }
  }
  return (
    <ol className="rounded-sm border border-glass-border" data-hidden-list="">
      {rows.map((row) => (
        <li key={row.workId} className="flex items-start gap-4 border-t border-glass-border px-3 py-3 first:border-t-0" data-hidden={row.workId}>
          <Cover s3Key={row.cover} className="h-16 w-11" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <Link href={row.href} className="block text-sm text-fg-primary transition-colors hover:text-accent-rose-text touch-hit">
              <span className="lines-1">{row.title}</span>
            </Link>
            {row.author && <p className="lines-1 text-xs text-fg-secondary">{row.author}</p>}
            <p className="text-xs text-fg-primary" data-hidden-verdict="">
              {row.verdict}
            </p>
            {row.note && <p className="text-xs italic text-fg-secondary">{row.note}</p>}
            <p className="text-xs text-fg-secondary">{row.date}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void undo(row)} className="pointer-coarse:h-11" data-hidden-undo={row.workId}>
            Undo
          </Button>
        </li>
      ))}
    </ol>
  );
}
