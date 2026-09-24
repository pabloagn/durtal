"use client";

import { useState, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface DeleteItemDialogProps {
  open: boolean;
  onClose: () => void;
  item: { id: string; name: string; entityCount: number };
  familySlug: string;
  availableReassignTargets: { id: string; name: string }[];
  onDeleted: () => void;
}

export function DeleteItemDialog({
  open,
  onClose,
  item,
  familySlug,
  availableReassignTargets,
  onDeleted,
}: DeleteItemDialogProps) {
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    setReassignTargetId("");
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSubmitting(true);

      try {
        const { deleteTaxonomyItem } = await import(
          "@/lib/actions/taxonomy-families"
        );
        await deleteTaxonomyItem(
          familySlug,
          item.id,
          reassignTargetId || undefined,
        );
        toast.success(`Deleted "${item.name}"`);
        handleClose();
        onDeleted();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete item";
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [familySlug, item, reassignTargetId, handleClose, onDeleted],
  );

  const reassignOptions = availableReassignTargets.map((t) => ({
    value: t.id,
    label: t.name,
  }));

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Delete Item"
      description={`Are you sure you want to delete "${item.name}"?`}
      className="max-w-lg"
      expandable={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Warning for items with entities */}
        {item.entityCount > 0 && (
          <div className="flex items-start gap-2.5 rounded-sm border border-accent-red/15 bg-accent-red/5 px-3 py-2.5">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-red"
              strokeWidth={1.5}
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-fg-primary">
                This item is associated with{" "}
                <Badge variant="red">{item.entityCount}</Badge> work
                {item.entityCount === 1 ? "" : "s"}.
              </p>
              <p className="text-xs text-fg-secondary">
                You can optionally reassign these works to another item before
                deleting.
              </p>
            </div>
          </div>
        )}

        {/* Reassign dropdown (only shown when there are entities) */}
        {item.entityCount > 0 && reassignOptions.length > 0 && (
          <Select
            label="Reassign works to"
            options={reassignOptions}
            placeholder="No reassignment (unlink works)"
            value={reassignTargetId}
            onChange={(e) => setReassignTargetId(e.target.value)}
          />
        )}

        {/* Confirmation text */}
        <p className="text-xs text-fg-muted">
          This action cannot be undone.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            disabled={submitting}
          >
            {submitting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
