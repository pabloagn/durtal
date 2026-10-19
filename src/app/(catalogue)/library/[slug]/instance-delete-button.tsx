"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { deleteInstance, getCopyDeleteSummary } from "@/lib/actions/instances";
import { copyDeleteCascadeMessage, DELETE_CASCADE_COUNTING } from "@/lib/catalogue/delete-cascade";
import { useDeleteSummary } from "@/components/books/use-delete-summary";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

interface InstanceDeleteButtonProps {
  instanceId: string;
  instanceLabel: string;
  hasEbook?: boolean;
}

export function InstanceDeleteButton({
  instanceId,
  instanceLabel,
  hasEbook = false,
}: InstanceDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // What goes with the copy and what stays, counted as the dialog opens (SLN-1112)
  const summary = useDeleteSummary(open, instanceId, () => getCopyDeleteSummary(instanceId));
  const cascade =
    summary === undefined
      ? DELETE_CASCADE_COUNTING
      : summary === null
        ? hasEbook
          ? "Its eBook returns to review; its files, reading positions and annotations are kept."
          : undefined
        : copyDeleteCascadeMessage(summary);

  async function handleConfirm() {
    await deleteInstance(instanceId);
    toast.success("Copy deleted");
    setOpen(false);
    router.refresh();
    triggerActivityRefresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-fg-secondary hover:text-accent-red-text"
        data-tooltip="Delete copy"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        Delete
      </Button>

      <DeleteConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete copy"
        description="This cannot be undone."
        cascade={cascade}
        itemName={instanceLabel}
      />
    </>
  );
}
