"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Asks before a delete. What blocks the delete is listed, and Delete stays
 * off until it is resolved; the database checks again when it runs.
 */
export function ConfirmDeleteDialog({
  open,
  onClose,
  title,
  name,
  description,
  blockers = [],
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The record, as its owner names it */
  name: string;
  description: string;
  blockers?: string[];
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-lg" expandable={false}>
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">{description}</p>
        <div className="rounded-sm border border-glass-border bg-bg-primary px-3 py-2">
          <p className="text-sm font-medium text-fg-primary">{name}</p>
        </div>
        {blockers.length > 0 && (
          <ul className="space-y-1 rounded-sm border border-accent-red/20 bg-accent-red/5 px-3 py-2 text-xs text-accent-red-text">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            data-shortcut="save"
            disabled={pending || blockers.length > 0}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
