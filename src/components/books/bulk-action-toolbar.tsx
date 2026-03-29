"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X, Tag, Signal, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { deleteWork, updateWork } from "@/lib/actions/works";
import { toast } from "sonner";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "@/lib/constants/catalogue";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";

interface BulkActionToolbarProps {
  selectedCount: number;
  selectedIds: Set<string>;
  /** Map of workId -> title for display in delete confirmation */
  selectedTitles: Map<string, string>;
  allIds: string[];
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
  onExitSelection: () => void;
}

export function BulkActionToolbar({
  selectedCount,
  selectedIds,
  selectedTitles,
  allIds,
  onSelectAll,
  onDeselectAll,
  onExitSelection,
}: BulkActionToolbarProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (selectedCount === 0) return null;

  const titlesList = Array.from(selectedIds)
    .map((id) => selectedTitles.get(id) ?? "Unknown")
    .slice(0, 5);
  const displayName =
    titlesList.length < selectedCount
      ? `${titlesList.join(", ")} and ${selectedCount - titlesList.length} more`
      : titlesList.join(", ");

  async function bulkUpdate(field: string, value: string | number | null) {
    setIsUpdating(true);
    const ids = Array.from(selectedIds);
    let updated = 0;
    try {
      for (const id of ids) {
        await updateWork(id, { [field]: value });
        updated++;
      }
      toast.success(
        `${updated} ${updated === 1 ? "work" : "works"} updated`,
      );
      router.refresh();
    } catch {
      toast.error(
        `Updated ${updated} of ${ids.length} works before error`,
      );
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleBulkDelete() {
    setIsDeleting(true);
    let deleted = 0;
    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await deleteWork(id);
        deleted++;
      }
      toast.success(`${deleted} ${deleted === 1 ? "work" : "works"} deleted`);
      onExitSelection();
      router.refresh();
    } catch {
      toast.error(`Deleted ${deleted} of ${ids.length} works before error`);
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }

  const statusEntries = Object.entries(STATUS_CONFIG) as [
    CatalogueStatus,
    (typeof STATUS_CONFIG)[CatalogueStatus],
  ][];

  const priorityEntries = Object.entries(PRIORITY_CONFIG) as [
    AcquisitionPriority,
    (typeof PRIORITY_CONFIG)[AcquisitionPriority],
  ][];

  const ratings = [1, 2, 3, 4, 5] as const;

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

        {/* Edit Status */}
        <DropdownMenu
          align="center"
          side="top"
          trigger={
            <Button variant="ghost" size="sm" disabled={isUpdating}>
              <Tag className="h-3.5 w-3.5" strokeWidth={1.5} />
              Status
            </Button>
          }
        >
          <DropdownMenuLabel>Set status</DropdownMenuLabel>
          {statusEntries.map(([value, config]) => (
            <DropdownMenuItem
              key={value}
              onClick={() => bulkUpdate("catalogueStatus", value)}
              disabled={isUpdating}
            >
              {config.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>

        {/* Edit Priority */}
        <DropdownMenu
          align="center"
          side="top"
          trigger={
            <Button variant="ghost" size="sm" disabled={isUpdating}>
              <Signal className="h-3.5 w-3.5" strokeWidth={1.5} />
              Priority
            </Button>
          }
        >
          <DropdownMenuLabel>Set priority</DropdownMenuLabel>
          {priorityEntries.map(([value, config]) => (
            <DropdownMenuItem
              key={value}
              onClick={() => bulkUpdate("acquisitionPriority", value)}
              disabled={isUpdating}
            >
              {config.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>

        {/* Edit Rating */}
        <DropdownMenu
          align="center"
          side="top"
          trigger={
            <Button variant="ghost" size="sm" disabled={isUpdating}>
              <Star className="h-3.5 w-3.5" strokeWidth={1.5} />
              Rating
            </Button>
          }
        >
          <DropdownMenuLabel>Set rating</DropdownMenuLabel>
          {ratings.map((value) => (
            <DropdownMenuItem
              key={value}
              onClick={() => bulkUpdate("rating", value)}
              disabled={isUpdating}
            >
              {value} {value === 1 ? "star" : "stars"}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => bulkUpdate("rating", null)}
            disabled={isUpdating}
          >
            Clear rating
          </DropdownMenuItem>
        </DropdownMenu>

        <div className="h-4 w-px bg-glass-border" />

        {/* Delete */}
        <Button
          variant="danger"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          disabled={isDeleting || isUpdating}
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
        title={`Delete ${selectedCount} ${selectedCount === 1 ? "work" : "works"}`}
        description="Are you sure you want to delete the selected works? This action cannot be undone."
        itemName={displayName}
        cascade="This will permanently delete all editions, instances, and media associated with the selected works."
      />
    </>
  );
}
