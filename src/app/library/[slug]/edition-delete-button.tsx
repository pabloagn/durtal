"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { deleteEdition } from "@/lib/actions/editions";

interface EditionDeleteButtonProps {
  editionId: string;
  editionTitle: string;
  instanceCount: number;
}

export function EditionDeleteButton({
  editionId,
  editionTitle,
  instanceCount,
}: EditionDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleConfirm() {
    await deleteEdition(editionId);
    toast.success("Edition deleted");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-fg-muted hover:text-accent-red"
        title="Delete edition"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        Delete
      </Button>

      <DeleteConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete edition"
        description="Are you sure you want to delete this edition? This action cannot be undone."
        itemName={editionTitle}
        cascade={
          instanceCount > 0
            ? `This will also delete ${instanceCount} instance${instanceCount === 1 ? "" : "s"}.`
            : undefined
        }
      />
    </>
  );
}
