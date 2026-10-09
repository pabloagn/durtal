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
        // This read-only dialog has one control. Keep both Tab directions
        // on it, including the native dialog's browser-chrome focus cycle.
        if (!open || event.key !== "Tab") return;
        const dialog = (event.target as HTMLElement).closest("dialog");
        const close = dialog?.querySelector<HTMLButtonElement>("button");
        if (close) {
          event.preventDefault();
          close.focus();
        }
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
        onClick={() => setOpen(true)}
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
        <ul className="space-y-3 text-sm text-fg-secondary">
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
