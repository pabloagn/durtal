"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: string;
  itemName: string;
  cascade?: string;
  /** Why the delete can't go ahead: shown in place of the warning, and Delete stays off */
  refusal?: string | null;
  hideConfirmOnRefusal?: boolean;
}

export function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  cascade,
  refusal,
  hideConfirmOnRefusal = false,
}: DeleteConfirmDialogProps) {
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      await onConfirm();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-lg" expandable={false}>
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">{refusal ?? description}</p>
        <div className="rounded-sm border border-glass-border bg-bg-primary px-3 py-2">
          <p className="text-sm font-medium text-fg-primary">{itemName}</p>
        </div>
        {cascade && !refusal && (
          <p className="rounded-sm border border-accent-red/20 bg-accent-red/5 px-3 py-2 text-xs text-accent-red-text">
            {cascade}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          {!(refusal && hideConfirmOnRefusal) && <Button
            variant="danger"
            size="sm"
            // Off but focusable while refused, so the focus never drops
            onClick={refusal ? undefined : handleConfirm}
            aria-disabled={refusal ? true : undefined}
            busy={isPending}
          >
            Delete
          </Button>}
        </div>
      </div>
    </Dialog>
  );
}
