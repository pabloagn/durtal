"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";

/** What a list hands its selection toolbar */
export interface SelectionToolbarProps {
  selectedCount: number;
  selectedIds: Set<string>;
  allIds: string[];
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
  onExitSelection: () => void;
}

/**
 * The bar a list shows while records are selected: the count, Select all and
 * Deselect, the list's own actions, Delete and Exit. Delete asks first, then
 * deletes the selection one record at a time. One bar for every list.
 */
export function SelectionToolbar({
  selectedCount,
  selectedIds,
  allIds,
  onSelectAll,
  onDeselectAll,
  onExitSelection,
  names,
  noun,
  deleteOne,
  cascade,
  busy = false,
  children,
}: SelectionToolbarProps & {
  /** Each record's name by id, for the delete confirmation */
  names: Map<string, string>;
  /** One record and many: ["work", "works"] */
  noun: [string, string];
  deleteOne: (id: string) => Promise<unknown>;
  /** What deleting keeps and removes, in the confirmation */
  cascade: string;
  /** Another action of the list is running: Delete waits for it */
  busy?: boolean;
  /** The list's actions, between Deselect and Delete; `deleting` while the selection is deleted */
  children: (deleting: boolean) => ReactNode;
}) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (selectedCount === 0) return null;

  const [one, many] = noun;
  const namesList = Array.from(selectedIds)
    .map((id) => names.get(id) ?? "Unknown")
    .slice(0, 5);
  const displayName =
    namesList.length < selectedCount
      ? `${namesList.join(", ")} and ${selectedCount - namesList.length} more`
      : namesList.join(", ");

  async function handleBulkDelete() {
    setIsDeleting(true);
    let deleted = 0;
    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await deleteOne(id);
        deleted++;
      }
      toast.success(`${deleted} ${deleted === 1 ? one : many} deleted`);
      onExitSelection();
      router.refresh();
    } catch {
      toast.error(`Deleted ${deleted} of ${ids.length} ${many} before error`);
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <>
      {/* On a narrow screen the bar wraps onto a second row and stays inside the screen (SLN-452) */}
      <div className="glass fixed bottom-6 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-3 px-4 py-2.5">
        {/* Selection info */}
        <span className="whitespace-nowrap text-sm text-fg-secondary">
          <span className="font-mono text-fg-primary">{selectedCount}</span>{" "}
          selected
        </span>

        <div className="h-4 w-px bg-glass-border" />

        {/* Nothing in the bar wraps: every item keeps one line, so the
            row's center is each label's center */}
        <button
          onClick={() => onSelectAll(allIds)}
          className="whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
        >
          Select all
        </button>
        <button
          onClick={onDeselectAll}
          className="whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
        >
          Deselect
        </button>

        <div className="h-4 w-px bg-glass-border" />

        {children(isDeleting)}

        <div className="h-4 w-px bg-glass-border" />

        {/* Delete */}
        <Button
          variant="danger"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          disabled={isDeleting || busy}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          Delete
        </Button>

        {/* Close */}
        <button
          onClick={onExitSelection}
          className="ml-1 block rounded-sm p-1 text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary touch-hit"
          aria-label="Exit selection"
          data-tooltip="Exit selection"
        >
          <X className="block h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedCount} ${selectedCount === 1 ? one : many}`}
        description={`Are you sure you want to delete the selected ${many}? This action cannot be undone.`}
        itemName={displayName}
        cascade={cascade}
      />
    </>
  );
}
