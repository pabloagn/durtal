"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { pickOne } from "@/lib/reading/suggest/score";
import type { SuggestionRow } from "@/lib/reading/suggest/view";
import { useReadingDialogs } from "../reading-dialogs-provider";
import { Cover } from "../reading-tiles";

/**
 * Pick one for me (SLN-457): a draw among the top ten weighted by score,
 * with its reasons, Start reading and Another. The palette's "Suggest a
 * book" opens it (`?pick=1`).
 */
export function PickOne({ top, initiallyOpen = false }: { top: SuggestionRow[]; initiallyOpen?: boolean }) {
  const { open } = useReadingDialogs();
  const [shown, setShown] = useState<string[]>([]);
  // Opened from the palette: the first draw is fixed, so the server and the browser draw the same book; Another draws at random
  const [current, setCurrent] = useState<SuggestionRow | null>(() => (initiallyOpen ? pickOne(top, (r) => r.workId, () => 0.37) : null));

  function draw() {
    const next = pickOne(top, (r) => r.workId, Math.random, current ? [...shown, current.workId] : shown);
    if (current) setShown((s) => (s.length + 1 >= top.length ? [] : [...s, current.workId]));
    setCurrent(next);
  }

  return (
    <>
      <Button variant="primary" onClick={draw} disabled={!top.length} className="pointer-coarse:h-11" data-pick-open="">
        Pick one for me
      </Button>
      {current && (
        <Dialog open onClose={() => setCurrent(null)} title="Pick one for me" className="max-w-md">
          <div className="flex gap-4" data-pick={current.workId}>
            <Cover s3Key={current.cover} className="h-28 w-20" />
            <div className="min-w-0 flex-1 space-y-1">
              <Link href={current.href} className="type-item-title block text-fg-primary transition-colors hover:text-accent-rose-text">
                {current.title}
              </Link>
              {current.author && <p className="text-xs text-fg-secondary">{current.author}</p>}
              {current.line && <p className="text-xs text-fg-secondary">{current.line}</p>}
              <ul className="space-y-0.5 pt-1 text-xs text-fg-primary" data-pick-reasons="">
                {current.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {current.prediction && <p className="text-xs text-fg-secondary">You would {current.prediction.replace("likely", "likely rate it")}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={draw} disabled={top.length < 2} className="pointer-coarse:h-11" data-pick-another="">
              Another
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const row = current;
                setCurrent(null);
                void open({ kind: "start", workId: row.workId, editionId: row.editionId });
              }}
              className="pointer-coarse:h-11"
              data-pick-start=""
            >
              Start reading
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
