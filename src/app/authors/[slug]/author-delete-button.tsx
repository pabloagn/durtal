"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { deleteAuthor } from "@/lib/actions/authors";

interface AuthorDeleteButtonProps {
  authorId: string;
  name: string;
  workCount: number;
}

export function AuthorDeleteButton({
  authorId,
  name,
  workCount,
}: AuthorDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function handleConfirm() {
    try {
      await deleteAuthor(authorId);
      toast.success("Author deleted");
      router.push("/authors");
    } catch {
      toast.error("Failed to delete author");
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
        title="Delete author"
        description="Are you sure you want to delete this author? This action cannot be undone."
        itemName={name}
        cascade={
          workCount > 0
            ? "This will NOT delete the author's works, but will remove authorship links."
            : undefined
        }
      />
    </>
  );
}
