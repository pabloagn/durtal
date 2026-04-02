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
}

export function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  itemName,
  cascade,
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
        <p className="text-sm text-fg-secondary">{description}</p>
        <div className="rounded-sm border border-glass-border bg-bg-primary px-3 py-2">
          <p className="text-sm font-medium text-fg-primary">{itemName}</p>
        </div>
        {cascade && (
          <p className="rounded-sm border border-accent-red/20 bg-accent-red/5 px-3 py-2 text-xs text-accent-red">
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
          <Button
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
