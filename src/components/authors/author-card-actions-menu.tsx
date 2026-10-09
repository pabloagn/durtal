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
    const copyText = firstName && lastName ? `${firstName} ${lastName}` : name;
    navigator.clipboard.writeText(copyText).then(
      () => toast.success("Name copied to clipboard"),
      () => toast.error("Failed to copy name"),
    );
  }

  function handleEdit() {
    router.push(`/people/${slug}`);
  }

  async function handleDelete() {
    try {
      await deleteAuthor(authorId);
      toast.success("Person deleted");
      router.refresh();
    } catch {
      toast.error("Could not delete the person");
    }
    setDeleteOpen(false);
  }

  return (
    <>
      <DropdownMenu
        align="end"
        side="top"
        label="Actions"
        trigger={
          <button className="flex chip-button glass-chip">
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      >
        <DropdownMenuItem
          icon={<Copy className="h-4 w-4" strokeWidth={1.5} />}
          onClick={handleCopyName}
        >
          Copy name
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Pencil className="h-4 w-4" strokeWidth={1.5} />}
          onClick={handleEdit}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
        title="Delete person"
        description="This cannot be undone."
        itemName={name}
        cascade="This will permanently remove the person from every book, edition, film, perfume and painting they are credited on."
      />
    </>
  );
}
