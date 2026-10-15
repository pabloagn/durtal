"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { AddToCollectionDialog, CollectionShortcut } from "@/components/books/add-to-collection-dialog";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { DetailControls, DetailEditButton } from "@/components/shared/detail-layout";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editHint } from "@/lib/shortcuts/shortcuts";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { deleteFilm } from "@/lib/actions/films";
import { FilmForm, type EditableFilm, type FilmChoices } from "./film-form";

/**
 * The film's own actions beside its title, on the title's cap-height
 * center: edit its identity, manage its poster, still and gallery, delete
 * it. A film with copies cannot be deleted; the dialog says what to do
 * first. The dialogs stay outside the title's type.
 */
export function FilmActions({
  film,
  fingerprint,
  choices,
  sources,
  copies,
  children,
}: {
  film: EditableFilm;
  fingerprint: string;
  choices: FilmChoices;
  sources: { id: string; label: string }[];
  /** Personal copies, disposed ones included */
  copies: number;
  /** Controls before the menu, such as the favourite toggle */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "images" | "collections" | "delete" | null>(null);
  const close = () => setOpen(null);
  // E then W or M: the same dialogs as the menu (SLN-633)
  useEditActions([
    { key: EDIT_KEYS.work, label: "Film", icon: Pencil, run: () => setOpen("edit") },
    { key: EDIT_KEYS.media, label: "Images", icon: ImageIcon, run: () => setOpen("images") },
  ]);

  return (
    <>
      <CollectionShortcut run={() => setOpen("collections")} />
      <DetailControls>
        {children}
        <DetailEditButton label="Edit film" editKey={EDIT_KEYS.work} onClick={() => setOpen("edit")} />
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
        title="Edit film"
        description={film.title}
        className="max-w-3xl"
      >
        {open === "edit" && (
          <FilmForm
            mode="edit"
            film={film}
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
        workIds={[film.id]}
        title={film.title}
      />
      <MediaManagerDialog
        open={open === "images"}
        onClose={close}
        entityId={film.id}
        title={film.title}
      />
      <ConfirmDeleteDialog
        open={open === "delete"}
        onClose={close}
        title="Delete film"
        name={film.title}
        description="The film, its cast and crew, versions, releases, sources and images are deleted. This cannot be undone."
        blockers={
          copies
            ? [
                `It has ${copies} personal ${copies === 1 ? "copy" : "copies"}: delete ${copies === 1 ? "it" : "them"} first.`,
              ]
            : []
        }
        onConfirm={async () => {
          try {
            const { cleanupPending } = await deleteFilm(film.id);
            toast.success(
              cleanupPending
                ? "Film deleted; some image files could not be removed yet"
                : "Film deleted",
            );
            router.push("/films");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the film");
          }
        }}
      />
    </>
  );
}
