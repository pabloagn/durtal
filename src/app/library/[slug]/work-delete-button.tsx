"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { deleteWork } from "@/lib/actions/works";

interface WorkDeleteButtonProps {
  workId: string;
  title: string;
  editionCount: number;
  instanceCount: number;
}

export function WorkDeleteButton({
  workId,
  title,
  editionCount,
  instanceCount,
}: WorkDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function buildCascadeMessage(): string | undefined {
    const parts: string[] = [];
    if (editionCount > 0) {
      parts.push(`${editionCount} edition${editionCount === 1 ? "" : "s"}`);
    }
    if (instanceCount > 0) {
      parts.push(
        `${instanceCount} instance${instanceCount === 1 ? "" : "s"}`,
      );
    }
    if (parts.length === 0) return undefined;
    return `This will also delete ${parts.join(" and ")}.`;
  }

  async function handleConfirm() {
    try {
      await deleteWork(workId);
      toast.success("Work deleted");
      router.push("/library");
    } catch {
      toast.error("Failed to delete work");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-fg-muted hover:text-accent-red"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        Delete
      </Button>
      <DeleteConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title="Delete work"
        description="Are you sure you want to delete this work? This action cannot be undone."
        itemName={title}
        cascade={buildCascadeMessage()}
      />
    </>
  );
}
