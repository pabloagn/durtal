"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { deleteAuthor } from "@/lib/actions/authors";
import { toast } from "sonner";

interface AuthorCardActionsMenuProps {
  authorId: string;
  slug: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
}

export function AuthorCardActionsMenu({
  authorId,
  slug,
  name,
  firstName,
  lastName,
}: AuthorCardActionsMenuProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);

  function handleCopyName() {
    const copyText =
      firstName && lastName ? `${firstName} ${lastName}` : name;
    navigator.clipboard.writeText(copyText).then(
      () => toast.success("Name copied to clipboard"),
      () => toast.error("Failed to copy name"),
    );
  }

  function handleEdit() {
    router.push(`/authors/${slug}`);
  }

  async function handleDelete() {
    try {
      await deleteAuthor(authorId);
      toast.success("Author deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete author");
    }
    setDeleteOpen(false);
  }

  return (
    <>
      <DropdownMenu
        align="end"
        side="top"
        trigger={
          <span className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80">
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </span>
        }
      >
        <DropdownMenuItem
          icon={<Copy className="h-4 w-4" strokeWidth={1.5} />}
          onClick={handleCopyName}
        >
          Copy name
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Pencil className="h-4 w-4" strokeWidth={1.5} />}
          onClick={handleEdit}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Trash2 className="h-4 w-4" strokeWidth={1.5} />}
          variant="danger"
          onClick={() => setDeleteOpen(true)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenu>

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete author"
        description="Are you sure you want to delete this author? This action cannot be undone."
        itemName={name}
        cascade="This will permanently remove the author from all associated works and editions."
      />
    </>
  );
}
