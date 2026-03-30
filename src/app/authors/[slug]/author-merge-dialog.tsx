"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { mergeAuthors } from "@/lib/actions/authors";

interface AuthorMergeDialogProps {
  open: boolean;
  onClose: () => void;
  targetAuthorId: string;
  targetAuthorName: string;
  allAuthors: { id: string; name: string; slug: string | null }[];
}

export function AuthorMergeDialog({
  open,
  onClose,
  targetAuthorId,
  targetAuthorName,
  allAuthors,
}: AuthorMergeDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  const candidates = allAuthors.filter(
    (a) => a.id !== targetAuthorId && !sourceIds.includes(a.id),
  );

  const filtered = search.trim()
    ? candidates.filter((a) =>
        a.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : candidates.slice(0, 15);

  const selectedSources = sourceIds
    .map((id) => allAuthors.find((a) => a.id === id))
    .filter(Boolean) as { id: string; name: string; slug: string | null }[];

  function addSource(id: string) {
    setSourceIds((prev) => [...prev, id]);
    setSearch("");
  }

  function removeSource(id: string) {
    setSourceIds((prev) => prev.filter((s) => s !== id));
  }

  function handleClose() {
    if (isPending) return;
    setSearch("");
    setSourceIds([]);
    onClose();
  }

  function handleMerge() {
    if (sourceIds.length === 0) return;

    startTransition(async () => {
      try {
        for (const sourceId of sourceIds) {
          await mergeAuthors(sourceId, targetAuthorId);
        }
        const names = selectedSources.map((s) => `"${s.name}"`).join(", ");
        toast.success(
          `Merged ${names} into "${targetAuthorName}"`,
        );
        handleClose();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to merge authors",
        );
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Merge Authors"
      description={`Select duplicate authors to merge into "${targetAuthorName}". Their works and contributions will be transferred here, and the duplicates will be deleted.`}
    >
      <div className="space-y-4">
        {/* Selected sources → Target visual */}
        <div className="rounded-sm border border-glass-border bg-bg-primary px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fg-muted">
                Will be deleted ({selectedSources.length})
              </p>
              {selectedSources.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedSources.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 rounded-sm border border-glass-border bg-bg-secondary px-2 py-0.5 text-xs text-fg-secondary"
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() => removeSource(s.id)}
                        disabled={isPending}
                        className="text-fg-muted transition-colors hover:text-fg-primary"
                      >
                        <X className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-0.5 text-sm text-fg-muted">
                  Select duplicates below...
                </p>
              )}
            </div>
            <ArrowRight className="h-4 w-4 flex-shrink-0 text-fg-muted" strokeWidth={1.5} />
            <div className="min-w-0 flex-shrink-0 text-right">
              <p className="text-xs text-fg-muted">Will be kept</p>
              <p className="text-sm font-medium text-accent-rose">
                {targetAuthorName}
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search for duplicate authors..."
          className="h-9 w-full rounded-sm border border-glass-border bg-bg-secondary px-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
        />

        {/* Results */}
        <div className="max-h-48 overflow-y-auto rounded-sm border border-glass-border">
          {filtered.length > 0 ? (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => addSource(a.id)}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
              >
                {a.name}
              </button>
            ))
          ) : (
            <p className="px-3 py-4 text-center text-xs text-fg-muted">
              No authors found
            </p>
          )}
        </div>

        {/* Warning */}
        {sourceIds.length > 0 && (
          <p className="rounded-sm border border-accent-gold/30 bg-accent-gold/5 px-3 py-2 text-xs text-fg-secondary">
            This will transfer all works and edition contributions from{" "}
            {selectedSources.length === 1
              ? `"${selectedSources[0].name}"`
              : `${selectedSources.length} authors`}{" "}
            into &ldquo;{targetAuthorName}&rdquo;, then permanently delete the{" "}
            {selectedSources.length === 1 ? "duplicate" : "duplicates"}.
            This cannot be undone.
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-glass-border pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleMerge}
            disabled={isPending || sourceIds.length === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                Merging
              </>
            ) : (
              `Merge ${sourceIds.length > 0 ? sourceIds.length : ""} ${sourceIds.length === 1 ? "Author" : sourceIds.length > 1 ? "Authors" : ""}`.trim()
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
