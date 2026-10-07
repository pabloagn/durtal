"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { deletePainting, type PaintingChoices } from "@/lib/actions/paintings";
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

  return (
    <>
      <CapAlignedControls height={32} className="type-page-title">
        {children}
        <EntityActionMenu
          items={[
            { label: "Edit", icon: Pencil, onClick: () => setOpen("edit") },
            { label: "Images", icon: ImageIcon, onClick: () => setOpen("images") },
            { label: "Collections", icon: FolderPlus, onClick: () => setOpen("collections") },
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => setOpen("delete"),
              variant: "destructive",
            },
          ]}
        />
      </CapAlignedControls>
      <Dialog
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
            const { cleanupPending } = await deletePainting(painting.id);
            toast.success(
              cleanupPending
                ? "Painting deleted; some image files could not be removed yet"
                : "Painting deleted",
            );
            router.push("/paintings");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the painting");
          }
        }}
      />
    </>
  );
}
