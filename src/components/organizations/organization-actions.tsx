"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { removeOrganization } from "@/lib/actions/organization-directory";
import { OrganizationDialog, type EditableOrganization } from "./organization-dialog";

/**
 * The organization's own actions beside its name, on the name's cap-height
 * center: edit it, or delete it. An organization that records still link to
 * cannot be deleted; the dialog lists them.
 */
export function OrganizationActions({
  organization,
  blockers,
}: {
  organization: EditableOrganization;
  /** What still links to it, such as "124 editions" */
  blockers: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "delete" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <CapAlignedControls height={32} className="type-page-title">
        <EntityActionMenu
          items={[
            { label: "Edit", icon: Pencil, onClick: () => setOpen("edit") },
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => setOpen("delete"),
              variant: "destructive",
            },
          ]}
        />
      </CapAlignedControls>
      <OrganizationDialog open={open === "edit"} onClose={close} organization={organization} />
      <ConfirmDeleteDialog
        open={open === "delete"}
        onClose={close}
        title="Delete organization"
        name={organization.name}
        description={
          blockers.length
            ? "Records still link to this organization. Remove those links first:"
            : "This removes the organization and its other names."
        }
        blockers={blockers}
        onConfirm={async () => {
          try {
            await removeOrganization(organization.id);
            toast.success(`${organization.name} deleted`);
            router.push("/organizations");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not delete the organization");
          }
        }}
      />
    </>
  );
}
