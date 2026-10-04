"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { MediaManagerDialog } from "@/components/books/media-manager-dialog";
import { deletePerfume } from "@/lib/actions/perfumes";
import { PerfumeForm, type EditablePerfume } from "./perfume-form";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";

/**
 * The perfume's own actions beside its title, on the title's cap-height
 * center: edit its identity, manage its images, delete it. A perfume with
 * bottles, samples or retailer listings cannot be deleted; the dialog says
 * what to do first. The dialogs stay outside the title's type.
 */
export function PerfumeActions({
  perfume,
  fingerprint,
  sources,
  containers,
  listings,
  children,
}: {
  perfume: EditablePerfume;
  fingerprint: string;
  sources: { id: string; label: string }[];
  /** Bottles, samples and decants, disposed ones included */
  containers: number;
  listings: number;
  /** Controls before the menu, such as the favourite toggle */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "images" | "delete" | null>(null);
  const close = () => setOpen(null);
  const blockers = [
    ...(containers
      ? [
          `It has ${containers} ${containers === 1 ? "bottle or sample" : "bottles and samples"}: delete ${containers === 1 ? "it" : "them"} first.`,
        ]
      : []),
    ...(listings
      ? [
          `It has ${listings} retailer ${listings === 1 ? "listing" : "listings"}. A listing without prices can be deleted first; one with recorded prices stays as history, and the perfume stays with it.`,
        ]
      : []),
  ];

  return (
    <>
      <CapAlignedControls height={32} className="type-page-title">
        {children}
        <EntityActionMenu
          items={[
            { label: "Edit", icon: Pencil, onClick: () => setOpen("edit") },
            { label: "Images", icon: ImageIcon, onClick: () => setOpen("images") },
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
        title="Edit perfume"
        description={perfume.title}
        className="max-w-3xl"
      >
        {open === "edit" && (
          <PerfumeForm
            mode="edit"
            perfume={perfume}
            fingerprint={fingerprint}
            sources={sources}
            onCancel={close}
            onSaved={() => {
              close();
              router.refresh();
            }}
          />
        )}
      </Dialog>
      <MediaManagerDialog
        open={open === "images"}
        onClose={close}
        entityId={perfume.id}
        title={perfume.title}
        slot="square"
      />
      <ConfirmDeleteDialog
        open={open === "delete"}
        onClose={close}
        title="Delete perfume"
        name={perfume.title}
        description="The perfume, its formulations, notes, sources and images are deleted. This cannot be undone."
        blockers={blockers}
        onConfirm={async () => {
          try {
            const { cleanupPending } = await deletePerfume(perfume.id);
            toast.success(
              cleanupPending
                ? "Perfume deleted; some image files could not be removed yet"
                : "Perfume deleted",
            );
            router.push("/perfumes");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the perfume");
          }
        }}
      />
    </>
  );
}
