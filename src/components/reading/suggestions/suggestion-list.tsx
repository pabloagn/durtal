"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CapAligned } from "@/components/shared/cap-aligned";
import { PoisonBadge } from "@/components/books/poison-badge";
import { addToQueue } from "@/lib/actions/reading-queue";
import type { SuggestionRow } from "@/lib/reading/suggest/view";
import { showError } from "../reading-client";
import { useReadingDialogs } from "../reading-dialogs-provider";
import { Cover } from "../reading-tiles";
import { NotForMeDialog } from "./not-for-me-dialog";
import { useSuggestionFeedback } from "./use-feedback";
import { WhyThis } from "./why-this";
import { toast } from "sonner";

const menuButton =
  "action-icon";

/** A suggestion's actions: Start reading, Add to Up Next, Not now, Why this? and a menu (Never, Not for me because…, Already read it) */
export function SuggestionActions({ row, compact = false }: { row: SuggestionRow; compact?: boolean }) {
  const { open } = useReadingDialogs();
  const router = useRouter();
  const give = useSuggestionFeedback();
  const [notForMe, setNotForMe] = useState(false);
  const [queued, setQueued] = useState(false);

  async function queue() {
    try {
      await addToQueue({ workId: row.workId, from: "suggestion" });
      setQueued(true);
      toast.success(`${row.title} added to Up Next`);
      router.refresh();
    } catch (err) {
      showError(err, () => router.refresh());
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1" data-suggestion-actions={row.workId}>
      <Button size="sm" onClick={() => void open({ kind: "start", workId: row.workId, editionId: row.editionId })} className="pointer-coarse:h-11" data-suggestion-start="">
        Start reading
      </Button>
      {!compact && (
        <Button size="sm" variant="ghost" onClick={() => void queue()} disabled={queued} className="pointer-coarse:h-11" data-suggestion-queue="">
          {queued ? "In Up Next" : "Add to Up Next"}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => void give(row.workId, row.title, "not_now")} className="pointer-coarse:h-11" data-suggestion-not-now="">
        Not now
      </Button>
      {!compact && (
        <WhyThis
          title={row.title}
          parts={row.why}
          prediction={row.prediction ? `You would ${row.prediction.replace("likely", "likely rate it")}, ${row.predictionSource}` : null}
        />
      )}
      <DropdownMenu
        label={`More for ${row.title}`}
        align="end"
        trigger={
          <button type="button" aria-label={`More for ${row.title}`} data-tooltip="More" className={menuButton} data-suggestion-menu={row.workId}>
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      >
        {compact && <DropdownMenuItem onClick={() => void queue()}>Add to Up Next</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => void give(row.workId, row.title, "never")}>Never</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setNotForMe(true)}>Not for me because…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void open({ kind: "past", workId: row.workId, editionId: row.editionId })}>Already read it</DropdownMenuItem>
      </DropdownMenu>
      {notForMe && <NotForMeDialog workId={row.workId} title={row.title} onClose={() => setNotForMe(false)} />}
    </div>
  );
}

/** One suggestion: cover, title and author, length, where the copy is and time to read, up to three reasons, the predicted rating */
export function SuggestionItem({ row }: { row: SuggestionRow }) {
  return (
    <li className="flex items-start gap-4 border-t border-glass-border px-3 py-4 first:border-t-0" data-suggestion={row.workId}>
      <Link href={row.href} tabIndex={-1} aria-label={row.title} className="shrink-0">
        <Cover s3Key={row.cover} className="h-24 w-16" />
      </Link>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex gap-1.5 text-sm">
          {/* The title cuts off inside the link: the link's touch area is not clipped */}
          <Link href={row.href} className="min-w-0 text-fg-primary transition-colors hover:text-accent-primary touch-hit">
            <span className="lines-1">{row.title}</span>
          </Link>
          {row.isPoison && (
            <CapAligned height={14}>
              <span className="flex h-full items-center">
                <PoisonBadge isPoison />
              </span>
            </CapAligned>
          )}
        </div>
        {row.author && <p className="lines-1 text-xs text-fg-secondary">{row.author}</p>}
        {row.line && <p className="text-xs text-fg-secondary">{row.line}</p>}
        {row.reasons.length > 0 && (
          <ul className="space-y-0.5 pt-1 text-xs text-fg-primary" data-suggestion-reasons="">
            {row.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {row.prediction && (
          <p className="text-xs text-fg-secondary" data-suggestion-prediction="">
            You would {row.prediction.replace("likely", "likely rate it")}
          </p>
        )}
        <div className="pt-1">
          <SuggestionActions row={row} />
        </div>
      </div>
    </li>
  );
}

export function SuggestionList({ rows }: { rows: SuggestionRow[] }) {
  return (
    <ol className="rounded-sm border border-glass-border" data-suggestion-list="">
      {rows.map((row) => (
        <SuggestionItem key={row.workId} row={row} />
      ))}
    </ol>
  );
}
