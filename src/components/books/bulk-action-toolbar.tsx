"use client";

import { AddToCollectionDialog } from "./add-to-collection-dialog";
import { MarkReadDialog } from "./mark-read-dialog";
import { BULK_DELETE_CASCADE } from "./delete-cascade";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, Signal, Star, Stamp, FolderPlus, ListPlus, BookCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ExportMenu } from "@/components/shared/export-menu";
import {
  SelectionToolbar,
  type SelectionToolbarProps,
} from "@/components/shared/selection-toolbar";
import { deleteWork, updateWork } from "@/lib/actions/works";
import { bulkUpdateHuntAssessment } from "@/lib/actions/hunting";
import { localToday } from "@/lib/constants/hunting";
import { setFavourites } from "@/lib/actions/favourites";
import { MARKS_LABEL, WORK_MARKS, type WorkMark } from "@/lib/constants/marks";
import { bulkSetPoison } from "@/lib/actions/poison";
import { addManyToQueue } from "@/lib/actions/reading-queue";
import { toast } from "sonner";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "@/lib/constants/catalogue";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";
import { formatRating, HALF_STEPS } from "@/lib/utils/rating";

/** The library's selection bar: status, priority, marks, rating, reading, collections, Up Next and export */
export function BulkActionToolbar({
  selectedTitles,
  ...selection
}: SelectionToolbarProps & {
  /** Map of workId -> title for display in delete confirmation */
  selectedTitles: Map<string, string>;
}) {
  const { selectedCount, selectedIds, allIds } = selection;
  const router = useRouter();
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [markReadOpen, setMarkReadOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (selectedCount === 0) return null;

  /** Up Next (SLN-452): appended in the order of the selection */
  async function queueSelected() {
    setIsUpdating(true);
    try {
      const ids = allIds.filter((id) => selectedIds.has(id));
      const { added, alreadyQueued, beingRead } = await addManyToQueue({ workIds: ids.length ? ids : Array.from(selectedIds) });
      toast.success(
        [`Added ${added}`, alreadyQueued ? `${alreadyQueued} already in Up Next` : null, beingRead ? `${beingRead} being read` : null]
          .filter(Boolean)
          .join(" · "),
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to Up Next");
    } finally {
      setIsUpdating(false);
    }
  }

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

  async function setMark(mark: WorkMark, on: boolean) {
    setIsUpdating(true);
    try {
      const ids = Array.from(selectedIds);
      // Rarity keeps its assessment date; other marks are plain flags
      const { updated } =
        mark.key === "rare"
          ? await bulkUpdateHuntAssessment(
              ids,
              on
                ? { isRare: true, huntAssessedOn: localToday() }
                : { isRare: false, huntAssessedOn: null },
            )
          : mark.key === "favourite"
            ? await setFavourites({ entity: "work", ids, favourite: on })
            : await bulkSetPoison(ids, on);
      toast.success(
        updated === 0
          ? `${mark.label}: no books changed`
          : `${mark.label}: ${updated} ${updated === 1 ? "book" : "books"} ${on ? "marked" : "unmarked"}`,
      );
      router.refresh();
    } catch {
      toast.error(`Could not update the ${mark.label} mark. Please try again.`);
    } finally {
      setIsUpdating(false);
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


  return (
    <>
      <SelectionToolbar
        {...selection}
        names={selectedTitles}
        noun={["work", "works"]}
        deleteOne={deleteWork}
        cascade={BULK_DELETE_CASCADE}
        busy={isUpdating}
      >
        {(isDeleting) => (
          <>
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

            {/* Marks: one menu for every book mark */}
            <DropdownMenu
              align="center"
              side="top"
              trigger={
                <Button variant="ghost" size="sm" disabled={isUpdating || isDeleting}>
                  <Stamp className="h-3.5 w-3.5" strokeWidth={1.5} />
                  {MARKS_LABEL}
                </Button>
              }
            >
              {WORK_MARKS.map((mark, index) => (
                <Fragment key={mark.key}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{mark.label}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setMark(mark, true)} disabled={isUpdating || isDeleting}>
                    {mark.markAction}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMark(mark, false)} disabled={isUpdating || isDeleting}>
                    {mark.unmarkAction}
                  </DropdownMenuItem>
                </Fragment>
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
              {/* Two columns keep the ten half steps short on a phone */}
              <div className="grid grid-cols-2">
                {HALF_STEPS.map((value) => (
                  <DropdownMenuItem
                    key={value}
                    onClick={() => bulkUpdate("rating", value)}
                    disabled={isUpdating}
                  >
                    {formatRating(value)} {value === 1 ? "star" : "stars"}
                  </DropdownMenuItem>
                ))}
              </div>
              <DropdownMenuItem
                onClick={() => bulkUpdate("rating", null)}
                disabled={isUpdating}
              >
                Clear rating
              </DropdownMenuItem>
            </DropdownMenu>

            {/* Reading (SLN-463): one finished read each; dates and edits stay on the book page */}
            <DropdownMenu
              align="center"
              side="top"
              trigger={
                <Button variant="ghost" size="sm" disabled={isUpdating || isDeleting} data-bulk-reading="">
                  <BookCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Reading
                </Button>
              }
            >
              <DropdownMenuLabel>Reading</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setMarkReadOpen(true)} disabled={isUpdating || isDeleting}>
                Mark as read
              </DropdownMenuItem>
            </DropdownMenu>

            <div className="h-4 w-px bg-glass-border" />

            <Button size="sm" variant="ghost" disabled={isDeleting || isUpdating} onClick={() => setCollectionOpen(true)}>
              <FolderPlus size={14} strokeWidth={1.5} />
              Collections
            </Button>
            <Button size="sm" variant="ghost" disabled={isDeleting || isUpdating} onClick={() => void queueSelected()} data-bulk-queue="">
              <ListPlus size={14} strokeWidth={1.5} />
              Add to Up Next
            </Button>
            {/* Export */}
            <ExportMenu entity="works" ids={selectedIds} />
          </>
        )}
      </SelectionToolbar>

      {markReadOpen && <MarkReadDialog workIds={Array.from(selectedIds)} onClose={() => setMarkReadOpen(false)} />}
      {collectionOpen && (
        <AddToCollectionDialog
          open={collectionOpen}
          onClose={() => setCollectionOpen(false)}
          workIds={Array.from(selectedIds)}
          title={`${selectedCount} selected books`}
        />
      )}
    </>
  );
}
