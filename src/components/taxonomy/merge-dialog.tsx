"use client";

import { useState, useCallback, useMemo } from "react";
import { toast } from "@/lib/notifications/toast";
import { Merge } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import { Badge } from "@/components/ui/badge";
import { countLabel } from "@/lib/utils/format";
import { searchScore } from "@/lib/utils/search-text";

interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
  sourceItem: { id: string; name: string; entityCount: number };
  familySlug: string;
  availableTargets: { id: string; name: string }[];
  onMerged: () => void;
  entityNoun?: string;
}

export function MergeDialog({
  open,
  onClose,
  sourceItem,
  familySlug,
  availableTargets,
  onMerged, entityNoun = "work",
}: MergeDialogProps) {
  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredTargets = useMemo(() => {
    // Accents, case and punctuation ignored, as every search (SLN-881)
    if (!search.trim()) return availableTargets;
    return availableTargets.filter((t) => searchScore(search, t.name) >= 0);
  }, [availableTargets, search]);

  const targetItem = availableTargets.find((t) => t.id === targetId);

  const handleClose = useCallback(() => {
    if (submitting) return;
    setTargetId("");
    setSearch("");
    setError(null);
    onClose();
  }, [onClose, submitting]);

  const handleMerge = useCallback(
    async () => {
      if (submitting || !availableTargets.some(t => t.id === targetId)) return;

      setSubmitting(true);
      setError(null);
      try {
        const { mergeTaxonomyItems } = await import(
          "@/lib/actions/taxonomy-client"
        );
        await mergeTaxonomyItems(familySlug, {
          sourceId: sourceItem.id,
          targetId,
        });
        toast.success(
          `Merged "${sourceItem.name}" into "${targetItem?.name}"`,
        );
        setTargetId("");
        setSearch("");
        onClose();
        onMerged();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to merge items";
        setError(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [targetId, submitting, availableTargets, familySlug, sourceItem, targetItem, onClose, onMerged],
  );

  return (
    <Dialog
      draft
      open={open}
      onClose={handleClose}
      title="Merge item"
      description={`Merge "${sourceItem.name}" into another item. All associated ${entityNoun}s will be reassigned.`}
      className="max-w-lg"
      expandable={false}
    >
      {/* No form: Enter in the search never submits the merge */}
      <div className="space-y-4">
        {/* Source info */}
        <div className="rounded-sm border border-glass-border bg-bg-primary/60 px-3 py-2.5">
          <div className="flex items-start gap-2 text-sm">
            <CapAligned height={14}><Merge className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} /></CapAligned>
            <span className="text-sm text-fg-primary">{sourceItem.name}</span>
            <Badge variant="muted">{countLabel(sourceItem.entityCount, entityNoun)}</Badge>
          </div>
        </div>

        {/* Arrow indicator */}
        <div className="flex justify-center">
          <span className="text-xs text-fg-secondary">merges into</span>
        </div>

        {/* Target search + selection */}
        <div className="space-y-1.5">
          <label className="type-label block">
            Target item
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="h-8 pointer-coarse:h-11 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-primary focus:outline-none"
          />
          <div className="max-h-40 overflow-y-auto rounded-sm border border-glass-border bg-bg-primary/40">
            {filteredTargets.length === 0 ? (
              <div className="px-3 py-2 text-xs text-fg-secondary">
                {availableTargets.length ? "No matching items" : "No sibling items to merge into. Move this item or add a sibling first."}
              </div>
            ) : (
              filteredTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => setTargetId(target.id)}
                  className={`flex w-full items-center px-3 py-1.5 pointer-coarse:min-h-11 text-left text-sm transition-colors ${
                    targetId === target.id
                      ? "bg-accent-primary/10 text-fg-primary"
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

        {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button data-dismiss=""
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          {/* Merging removes the item: a danger button, which Enter and
              ⌘Enter never press (docs/03, Dialog keys) */}
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => void handleMerge()}
            disabled={!targetId}
            busy={submitting}
          >
            Merge
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
