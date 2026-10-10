"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { removeVenue, setVenueArchived } from "@/lib/actions/venue-pages";
import { VenueCreateDialog, type EditableVenue } from "../venue-create-dialog";

/**
 * The venue's own actions beside its name, on the name's cap-height center:
 * edit it, archive or restore it, delete it. A venue that orders, copies,
 * location history, listings or sources refer to cannot be deleted; the
 * dialog lists them and offers to archive it instead. The dialogs render at
 * the end of the page, outside the title row.
 */
export function VenueActions({
  venue,
  archived,
  blockers,
}: {
  venue: EditableVenue;
  archived: boolean;
  /** What still refers to the venue, such as "3 orders" */
  blockers: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const close = () => setOpen(null);

  async function archive(next: boolean) {
    try {
      await setVenueArchived(venue.id, next);
      toast.success(next ? `${venue.name} archived` : `${venue.name} restored`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the venue");
    }
  }

  return (
    <>
      <CapAlignedControls height={32} coarseHeight={44} className="type-page-title">
        <EntityActionMenu
          items={[
            { label: "Edit", icon: Pencil, onClick: () => setOpen("edit") },
            archived
              ? { label: "Restore", icon: ArchiveRestore, onClick: () => void archive(false) }
              : { label: "Archive", icon: Archive, onClick: () => void archive(true) },
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => setOpen("delete"),
              variant: "destructive",
            },
          ]}
        />
      </CapAlignedControls>
      {open &&
        createPortal(
          <>
            {open === "edit" && (
              <VenueCreateDialog
                open
                onOpenChange={(next) => !next && close()}
                venue={venue}
              />
            )}
            <ConfirmDeleteDialog
              open={open === "delete"}
              onClose={close}
              title="Delete venue"
              name={venue.name}
              description={
                blockers.length
                  ? `These records refer to it, so it stays. ${archived ? "It is archived already." : "Archive it to keep its history and hide it from the list."}`
                  : "This removes the venue. Nothing refers to it."
              }
              blockers={blockers}
              onConfirm={async () => {
                try {
                  await removeVenue(venue.id);
                  toast.success(`${venue.name} deleted`);
                  router.push("/places");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not delete the venue");
                }
              }}
            />
          </>,
          document.body,
        )}
    </>
  );
}
