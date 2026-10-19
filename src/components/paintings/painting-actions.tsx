"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { AddToCollectionDialog, CollectionShortcut } from "@/components/books/add-to-collection-dialog";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { DetailControls, DetailEditButton } from "@/components/shared/detail-layout";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editHint } from "@/lib/shortcuts/shortcuts";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import type { PaintingChoices } from "@/lib/actions/paintings";
import { deletePaintingFromPage } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";
import { PaintingForm, type EditablePainting } from "./painting-form";

/**
 * The painting's own actions beside its title, on the title's cap-height
 * center: edit its identity, manage its pictures, delete it. A painting with
 * objects you own cannot be deleted; the dialog says what to do first.
 */
export function PaintingActions({
  painting,
  fingerprint,
  choices,
  sources,
  owned,
  children,
}: {
  painting: EditablePainting;
  fingerprint: string;
  choices: PaintingChoices;
  sources: { id: string; label: string }[];
  /** Objects you own of it, disposed ones included */
  owned: number;
  /** Controls before the menu, such as the favourite toggle */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "images" | "collections" | "delete" | null>(null);
  const close = () => setOpen(null);
  // E then W or M: the same dialogs as the menu (SLN-633)
  useEditActions([
    { key: EDIT_KEYS.work, label: "Painting", icon: Pencil, run: () => setOpen("edit") },
    { key: EDIT_KEYS.media, label: "Images", icon: ImageIcon, run: () => setOpen("images") },
  ]);

  return (
    <>
      <CollectionShortcut run={() => setOpen("collections")} />
      <DetailControls>
        {children}
        <DetailEditButton label="Edit painting" editKey={EDIT_KEYS.work} onClick={() => setOpen("edit")} />
        <EntityActionMenu
          items={[
            { label: "Edit", icon: Pencil, onClick: () => setOpen("edit"), shortcut: editHint(EDIT_KEYS.work) },
            { label: "Images", icon: ImageIcon, onClick: () => setOpen("images"), shortcut: editHint(EDIT_KEYS.media) },
            { label: "Collections", icon: FolderPlus, onClick: () => setOpen("collections") },
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => setOpen("delete"),
              variant: "destructive",
            },
          ]}
        />
      </DetailControls>
      <Dialog
        draft
        open={open === "edit"}
        onClose={close}
        title="Edit painting"
        description={painting.title}
        className="max-w-3xl"
      >
        {open === "edit" && (
          <PaintingForm
            mode="edit"
            painting={painting}
            fingerprint={fingerprint}
            choices={choices}
            sources={sources}
            onCancel={close}
            onSaved={() => {
              close();
              router.refresh();
            }}
          />
        )}
      </Dialog>
      <AddToCollectionDialog
        open={open === "collections"}
        onClose={close}
        workIds={[painting.id]}
        title={painting.title}
      />
      <MediaManagerDialog
        open={open === "images"}
        onClose={close}
        entityId={painting.id}
        title={painting.title}
        mainImage="image"
      />
      <ConfirmDeleteDialog
        open={open === "delete"}
        onClose={close}
        title="Delete painting"
        name={painting.title}
        description="The painting, its original, versions and reproductions, their location history, sources and images are deleted. This cannot be undone."
        blockers={
          owned
            ? [
                `You own ${owned === 1 ? "an object" : `${owned} objects`} of it: delete ${owned === 1 ? "it" : "them"} first, or record another owner.`,
              ]
            : []
        }
        onConfirm={async () => {
          try {
            // On to the list in the action's own response (SLN-1330)
            const stayed = await deletePaintingFromPage(painting.id);
            const cleanupPending = !!stayed?.cleanupPending;
            toast.success(
              cleanupPending
                ? "Painting deleted; some image files could not be removed yet"
                : "Painting deleted",
            );
            if (cleanupPending) router.push("/paintings");
          } catch (err) {
            toast.error(refusalMessage(err, "Could not delete the painting"));
          }
        }}
      />
    </>
  );
}
