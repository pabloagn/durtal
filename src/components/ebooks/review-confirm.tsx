"use client";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import type { ReviewDecisionState } from "@/lib/ebooks/review-queue/decision-state";
import { ReviewIssues } from "./review-issues";
import { effectWords } from "@/lib/ebooks/review/effect-line";
import { formatBytes } from "@/lib/ebooks/run-text";
import type { ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";

export function ReviewDecisionControls({ state, onClose, onConfirm, onEdit, fields = [] }: {
  state: ReviewDecisionState; onClose: () => void; onConfirm: () => void; onEdit: () => void;
  /** Issues for these fields show at the field itself, so the list leaves them out */
  fields?: readonly ReviewPreparationIssue["field"][];
}) {
  const locked = state.phase === "confirming" || state.phase === "unknown";
  const listed = state.issues.filter((issue) => !fields.includes(issue.field));
  return <>
    {state.phase === "preparing" && <p role="status" className="text-sm text-fg-secondary">Preparing the exact effect…</p>}
    {state.prepared && <div className="rounded-sm border border-glass-border bg-glass-highlight p-4">
      <p className="type-label mb-2">What will be written</p>
      <p className="text-sm leading-relaxed">{effectWords(state.prepared.preview.text)}</p>
      <p className="mt-2 text-xs text-fg-secondary">{[state.prepared.preview.format?.toUpperCase(),
        state.prepared.preview.fileSizeBytes !== null ? formatBytes(state.prepared.preview.fileSizeBytes) : null,
      ].filter(Boolean).join(" · ")}</p>
    </div>}
    {/* A refusal with issues says each once, at its field or in the list, not again in general words */}
    {state.error && !state.issues.length && <p role="alert" className="text-sm text-accent-red-text">{state.error}</p>}
    <ReviewIssues issues={listed} />
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

export function ReviewConfirm({ title, state, children, onClose, onConfirm, onEdit, fields }: {
  title: string; state: ReviewDecisionState; children: ReactNode;
  onClose: () => void; onConfirm: () => void; onEdit: () => void;
  fields?: readonly ReviewPreparationIssue["field"][];
}) {
  const locked = state.phase === "confirming" || state.phase === "unknown";
  return <Dialog open onClose={() => { if (!locked) onClose(); }} title={title}
    description="Check the effect before confirming." className="max-w-2xl" expandable={false}>
    <div className="space-y-5">
      {children}
      <ReviewDecisionControls state={state} onClose={onClose} onConfirm={onConfirm} onEdit={onEdit} fields={fields} />
    </div>
  </Dialog>;
}
