"use client";

import { useState, useCallback, useMemo, type FormEvent } from "react";
import { toast } from "sonner";
import { Merge } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
  sourceItem: { id: string; name: string; entityCount: number };
  familySlug: string;
  availableTargets: { id: string; name: string }[];
  onMerged: () => void;
}

export function MergeDialog({
  open,
  onClose,
  sourceItem,
  familySlug,
  availableTargets,
  onMerged,
}: MergeDialogProps) {
  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filteredTargets = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return availableTargets;
    return availableTargets.filter((t) =>
      t.name.toLowerCase().includes(q),
    );
  }, [availableTargets, search]);

  const targetItem = availableTargets.find((t) => t.id === targetId);

  const handleClose = useCallback(() => {
    setTargetId("");
    setSearch("");
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!targetId) return;

      setSubmitting(true);
      try {
        const { mergeTaxonomyItems } = await import(
          "@/lib/actions/taxonomy-families"
        );
        await mergeTaxonomyItems(familySlug, {
          sourceId: sourceItem.id,
          targetId,
        });
        toast.success(
          `Merged "${sourceItem.name}" into "${targetItem?.name}"`,
        );
        handleClose();
        onMerged();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to merge items";
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [targetId, familySlug, sourceItem, targetItem, handleClose, onMerged],
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Merge Item"
      description={`Merge "${sourceItem.name}" into another item. All associated works will be reassigned.`}
      className="max-w-lg"
      expandable={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Source info */}
        <div className="rounded-sm border border-glass-border bg-bg-primary/60 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Merge className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
            <span className="text-sm text-fg-primary">{sourceItem.name}</span>
            <Badge variant="muted">{sourceItem.entityCount} works</Badge>
          </div>
        </div>

        {/* Arrow indicator */}
        <div className="flex justify-center">
          <span className="text-xs text-fg-muted">merges into</span>
        </div>

        {/* Target search + selection */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-fg-secondary">
            Target item
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items..."
            className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
          />
          <div className="max-h-40 overflow-y-auto rounded-sm border border-glass-border bg-bg-primary/40">
            {filteredTargets.length === 0 ? (
              <div className="px-3 py-2 text-xs text-fg-muted">
                No matching items
              </div>
            ) : (
              filteredTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => setTargetId(target.id)}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
                    targetId === target.id
                      ? "bg-accent-rose/10 text-fg-primary"
                      : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                  }`}
                >
                  {target.name}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Preview */}
        {targetItem && sourceItem.entityCount > 0 && (
          <p className="text-xs text-fg-secondary">
            {sourceItem.entityCount} work
            {sourceItem.entityCount === 1 ? "" : "s"} will be reassigned from{" "}
            <span className="text-fg-primary">{sourceItem.name}</span> to{" "}
            <span className="text-fg-primary">{targetItem.name}</span>.
          </p>
        )}

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
            variant="primary"
            size="sm"
            disabled={submitting || !targetId}
          >
            {submitting ? "Merging..." : "Merge"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
