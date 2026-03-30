"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { ExportMenu } from "@/components/shared/export-menu";
import { deleteAuthor } from "@/lib/actions/authors";
import { toast } from "sonner";

interface AuthorBulkActionToolbarProps {
  selectedCount: number;
  selectedIds: Set<string>;
  selectedNames: Map<string, string>;
  allIds: string[];
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
  onExitSelection: () => void;
}

export function AuthorBulkActionToolbar({
  selectedCount,
  selectedIds,
  selectedNames,
  allIds,
  onSelectAll,
  onDeselectAll,
  onExitSelection,
}: AuthorBulkActionToolbarProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (selectedCount === 0) return null;

  const namesList = Array.from(selectedIds)
    .map((id) => selectedNames.get(id) ?? "Unknown")
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
        await deleteAuthor(id);
        deleted++;
      }
      toast.success(
        `${deleted} ${deleted === 1 ? "author" : "authors"} deleted`,
      );
      onExitSelection();
      router.refresh();
    } catch {
      toast.error(
        `Deleted ${deleted} of ${ids.length} authors before error`,
      );
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-sm border border-glass-border bg-bg-secondary/95 px-4 py-2.5 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)] backdrop-blur-md">
        {/* Selection info */}
        <span className="text-sm text-fg-secondary">
          <span className="font-mono text-fg-primary">{selectedCount}</span>{" "}
          selected
        </span>

        <div className="h-4 w-px bg-glass-border" />

        <button
          onClick={() => onSelectAll(allIds)}
          className="text-xs text-fg-muted transition-colors hover:text-fg-primary"
        >
          Select all
        </button>
        <button
          onClick={onDeselectAll}
          className="text-xs text-fg-muted transition-colors hover:text-fg-primary"
        >
          Deselect
        </button>

        <div className="h-4 w-px bg-glass-border" />

        {/* Export */}
        <ExportMenu entity="authors" ids={selectedIds} />

        <div className="h-4 w-px bg-glass-border" />

        {/* Delete */}
        <Button
          variant="danger"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          disabled={isDeleting}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          Delete
        </Button>

        {/* Close */}
        <button
          onClick={onExitSelection}
          className="ml-1 rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
          title="Exit selection"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedCount} ${selectedCount === 1 ? "author" : "authors"}`}
        description="Are you sure you want to delete the selected authors? This action cannot be undone."
        itemName={displayName}
        cascade="This will NOT delete the authors' works, but will remove authorship links."
      />
    </>
  );
}
