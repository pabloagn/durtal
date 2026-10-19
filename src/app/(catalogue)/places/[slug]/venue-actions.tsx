"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { DetailControls, DetailEditButton } from "@/components/shared/detail-layout";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editHint } from "@/lib/shortcuts/shortcuts";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { VenueCreateDialog, type EditableVenue } from "../venue-create-dialog";
import { removeVenueFromPage, setVenueArchived } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

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
  children,
}: {
  venue: EditableVenue;
  archived: boolean;
  /** What still refers to the venue, such as "3 orders" */
  blockers: string[];
  /** Controls before the menu: the favourite */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const close = () => setOpen(null);
  // E then P: the same dialog as the menu's Edit (SLN-633)
  useEditActions([{ key: EDIT_KEYS.place, label: "Place", icon: Pencil, run: () => setOpen("edit") }]);

  async function archive(next: boolean) {
    try {
      await setVenueArchived(venue.id, next);
      toast.success(next ? `${venue.name} archived` : `${venue.name} restored`);
      router.refresh();
    } catch (err) {
      toast.error(refusalMessage(err, "Could not change the venue"));
    }
  }

  return (
    <>
      <DetailControls>
        {children}
        <DetailEditButton label="Edit place" editKey={EDIT_KEYS.place} onClick={() => setOpen("edit")} />
        <EntityActionMenu
          items={[
            { label: "Edit", icon: Pencil, onClick: () => setOpen("edit"), shortcut: editHint(EDIT_KEYS.place) },
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
      </DetailControls>
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
                  // On to the list in the action's own response (SLN-1330)
                  await removeVenueFromPage(venue.id);
                  toast.success(`${venue.name} deleted`);
                } catch (err) {
                  toast.error(refusalMessage(err, "Could not delete the venue"));
                }
              }}
            />
          </>,
          document.body,
        )}
    </>
  );
}
