"use client";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import type { ReviewDecisionState } from "@/lib/ebooks/review-queue/decision-state";
import { ReviewIssues } from "./review-issues";

export function ReviewDecisionControls({ state, onClose, onConfirm, onEdit }: {
  state: ReviewDecisionState; onClose: () => void; onConfirm: () => void; onEdit: () => void;
}) {
  const locked = state.phase === "confirming" || state.phase === "unknown";
  return <>
    {state.phase === "preparing" && <p role="status" className="text-sm text-fg-secondary">Preparing the exact effect…</p>}
    {state.prepared && <div className="rounded-sm border border-glass-border bg-glass-highlight p-4">
      <p className="type-label mb-2">What will be written</p>
      <p className="text-sm leading-relaxed">{state.prepared.preview.text}</p>
      <p className="mt-2 text-xs text-fg-secondary">{[state.prepared.preview.format?.toUpperCase(),
        state.prepared.preview.fileSizeBytes !== null ? `${(state.prepared.preview.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : null,
      ].filter(Boolean).join(" · ")}</p>
    </div>}
    {state.error && <p role="alert" className="text-sm text-accent-red-text">{state.error}</p>}
    <ReviewIssues issues={state.issues} />
    <div className="flex flex-wrap justify-end gap-2">
      {state.prepared && !locked && <Button variant="ghost" onClick={onEdit}>Change choices</Button>}
      <Button onClick={onClose} disabled={locked}>Cancel</Button>
      {state.prepared && <Button variant="primary" onClick={onConfirm}
        disabled={state.phase !== "prepared" && state.phase !== "unknown"}>
        {state.phase === "confirming" ? "Confirming…" : state.phase === "unknown" ? "Retry this decision" : "Confirm decision"}
      </Button>}
    </div>
  </>;
}

export function ReviewConfirm({ title, state, children, onClose, onConfirm, onEdit }: {
  title: string; state: ReviewDecisionState; children: ReactNode;
  onClose: () => void; onConfirm: () => void; onEdit: () => void;
}) {
  const locked = state.phase === "confirming" || state.phase === "unknown";
  return <Dialog open onClose={() => { if (!locked) onClose(); }} title={title}
    description="Check the effect before confirming." className="max-w-2xl" expandable={false}>
    <div className="space-y-5">
      {children}
      <ReviewDecisionControls state={state} onClose={onClose} onConfirm={onConfirm} onEdit={onEdit} />
    </div>
  </Dialog>;
}
