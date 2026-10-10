"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { deleteEdition } from "@/lib/actions/editions";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { keptNotesText } from "@/lib/reading/notes-text";

interface EditionDeleteButtonProps {
  editionId: string;
  editionTitle: string;
  instanceCount: number;
  /** Its quotes and notes, which stay with the book without the edition (SLN-480) */
  quoteCount?: number;
  noteCount?: number;
}

export function EditionDeleteButton({
  editionId,
  editionTitle,
  instanceCount,
  quoteCount = 0,
  noteCount = 0,
}: EditionDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleConfirm() {
    await deleteEdition(editionId);
    toast.success("Edition deleted");
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
        data-tooltip="Delete edition"
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        Delete
      </Button>

      <DeleteConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete edition"
        description={`This cannot be undone.${keptNotesText(quoteCount, noteCount, ", without this edition")}`}
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
