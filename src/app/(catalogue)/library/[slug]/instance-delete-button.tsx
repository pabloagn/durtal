"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { deleteInstance } from "@/lib/actions/catalogue-client";

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

  async function handleConfirm() {
    await deleteInstance(instanceId);
    toast.success("Instance deleted");
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
        data-tooltip="Delete instance"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        Delete
      </Button>

      <DeleteConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete instance"
        description="This cannot be undone."
        cascade={hasEbook ? "The eBook will return to review. Its files, reading positions and annotations will be kept." : undefined}
        itemName={instanceLabel}
      />
    </>
  );
}
