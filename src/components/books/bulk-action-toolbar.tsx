"use client";

import { AddToCollectionDialog } from "./add-to-collection-dialog";
import { MarkReadDialog } from "./mark-read-dialog";
import { workDeleteCascadeMessage, workDeleteFallback } from "@/lib/catalogue/delete-cascade";
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
import { getWorkDeleteSummary } from "@/lib/actions/works";
import { localToday } from "@/lib/constants/hunting";
import { MARKS_LABEL, WORK_MARKS, type WorkMark } from "@/lib/constants/marks";
import { toast } from "@/lib/notifications/toast";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "@/lib/constants/catalogue";
import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";
import { formatRating, HALF_STEPS } from "@/lib/utils/rating";
import { countLabel } from "@/lib/utils/format";
import { deleteWork, updateWork, bulkUpdateHuntAssessment, setFavourites, bulkSetPoison, addManyToQueue } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

/** The library's selection bar: status, priority, marks, rating, reading, collections, Up next and export */
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

  /** Up next (SLN-452): appended in the order of the selection */
  async function queueSelected() {
    setIsUpdating(true);
    const progress = toast.pending("Adding to Up next");
    try {
      const ids = allIds.filter((id) => selectedIds.has(id));
      const { added, alreadyQueued, beingRead } = await addManyToQueue({ workIds: ids.length ? ids : Array.from(selectedIds) });
      progress.success(
        [`Added ${added}`, alreadyQueued ? `${alreadyQueued} already in Up next` : null, beingRead ? `${beingRead} being read` : null]
          .filter(Boolean)
          .join(" · "),
      );
      router.refresh();
    } catch (err) {
      progress.error(refusalMessage(err, "Could not add to Up next"));
    } finally {
      setIsUpdating(false);
    }
  }

  async function bulkUpdate(field: string, value: string | number | null) {
    setIsUpdating(true);
    const ids = Array.from(selectedIds);
    let updated = 0;
    const progress = toast.pending(`Updating ${ids.length} ${ids.length === 1 ? "work" : "works"}`);
    try {
      for (const id of ids) {
        await updateWork(id, { [field]: value });
        updated++;
      }
      progress.success(
        `${updated} ${updated === 1 ? "work" : "works"} updated`,
      );
      router.refresh();
    } catch (error) {
      // How far it got, and why it stopped (SLN-1033)
      progress.error(
        `Updated ${updated.toLocaleString("en")} of ${countLabel(ids.length, "work")}. ${refusalMessage(error, "The rest were not changed.")}`,
      );
    } finally {
      setIsUpdating(false);
    }
  }

  async function setMark(mark: WorkMark, on: boolean) {
    setIsUpdating(true);
    const progress = toast.pending(`${mark.label}: updating`);
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
      progress.success(
        updated === 0
          ? `${mark.label}: no books changed`
          : `${mark.label}: ${updated} ${updated === 1 ? "book" : "books"} ${on ? "marked" : "unmarked"}`,
      );
      router.refresh();
    } catch (error) {
      progress.error(refusalMessage(error, `Could not update the ${mark.label} mark. Please try again.`));
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


  async function summarizeDelete(ids: string[]) {
    const summary = await getWorkDeleteSummary(ids);
    return { cascade: workDeleteCascadeMessage(summary), refusal: summary.refusal };
  }

  return (
    <>
      <SelectionToolbar
        {...selection}
        names={selectedTitles}
        noun={["work", "works"]}
        deleteOne={deleteWork}
        cascade={workDeleteFallback(true)}
        summarize={summarizeDelete}
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
              Add to Up next
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
