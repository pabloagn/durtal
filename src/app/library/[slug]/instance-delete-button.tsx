"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { deleteInstance } from "@/lib/actions/instances";

interface InstanceDeleteButtonProps {
  instanceId: string;
  instanceLabel: string;
}

export function InstanceDeleteButton({
  instanceId,
  instanceLabel,
}: InstanceDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleConfirm() {
    await deleteInstance(instanceId);
    toast.success("Instance deleted");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 w-7 p-0 hover:text-accent-red"
        title="Delete instance"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Button>

      <DeleteConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete instance"
        description="Are you sure you want to delete this copy? This action cannot be undone."
        itemName={instanceLabel}
      />
    </>
  );
}
