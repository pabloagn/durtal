"use client";

import { useState } from "react";
import type { SimilarityReason } from "@/lib/actions/similar-works";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const labels: Record<SimilarityReason["kind"], string> = {
  collection: "Collection",
  subject: "Subject",
  theme: "Theme",
  movement: "Movement",
  series: "Series",
  recommender: "Recommended by",
  author: "Author",
  translator: "Translator",
  publisher: "Publisher",
};

/** Supplemental evidence has a bounded preview; names remain complete in the dialog. */
export function SimilarityReasons({
  title,
  reasons,
}: {
  title: string;
  reasons: SimilarityReason[];
}) {
  const [open, setOpen] = useState(false);
  if (!reasons.length) return null;
  return (
    <div
      className="mt-2 text-xs text-fg-secondary [overflow-wrap:anywhere]"
      data-similarity-reasons
      onKeyDown={(event) => {
        // Wrap between Close and the focusable reading area. The latter
        // lets keyboard users scroll complete, exceptionally long reasons.
        if (!open || event.key !== "Tab") return;
        const dialog = (event.target as HTMLElement).closest("dialog");
        const stops = dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [tabindex='0']",
        );
        if (!dialog || !stops?.length) return;
        // WebKit can omit buttons from its native Tab order. Cycle these
        // two explicit stops consistently, while preserving reading keys.
        const index = Array.from(stops).indexOf(
          document.activeElement as HTMLElement,
        );
        const next = event.shiftKey
          ? index <= 0
            ? stops.length - 1
            : index - 1
          : index < 0
            ? 0
            : (index + 1) % stops.length;
        event.preventDefault();
        stops[next].focus({ preventScroll: true });
      }}
    >
      <ul className="min-h-[calc(4lh+0.25rem)] space-y-1">
        {reasons.slice(0, 2).map((reason) => (
          <li
            key={`${reason.kind}:${reason.id}`}
            className="lines-2 min-h-[2lh] [overflow-wrap:anywhere]"
          >
            {labels[reason.kind]}: {reason.name}
          </li>
        ))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1"
        aria-haspopup="dialog"
        aria-label={`All similarity reasons for ${title}`}
        onClick={(event) => {
          // WebKit touch does not focus buttons by default: keep this opener
          // as the shared dialog's explicit focus-return origin.
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        All reasons{reasons.length > 2 ? ` (${reasons.length})` : ""}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Why these books are similar"
        description={title}
        className="max-w-lg"
        expandable={false}
      >
        <ul
          tabIndex={0}
          aria-label="Complete similarity reasons"
          className="space-y-3 text-sm text-fg-secondary"
        >
          {reasons.map((reason) => (
            <li
              key={`${reason.kind}:${reason.id}`}
              className="[overflow-wrap:anywhere]"
            >
              <span className="text-fg-primary">{labels[reason.kind]}:</span>{" "}
              {reason.name}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
