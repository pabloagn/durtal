"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Pencil,
  Trash2,
  RefreshCw,
  Image,
  FolderPlus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { MediaManagerDialog } from "@/components/books/media-manager-dialog";
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";
import { MatchAgainDialog } from "@/components/books/match-again-dialog";
import { WorkQuickEditDialog } from "@/components/books/work-quick-edit-dialog";
import { deleteWork } from "@/lib/actions/works";
import { toast } from "sonner";

interface BookCardActionsMenuProps {
  workId: string;
  slug: string;
  title: string;
  authorName?: string;
  primaryEditionId?: string;
}

export function BookCardActionsMenu({
  workId,
  title,
  authorName,
  primaryEditionId,
}: BookCardActionsMenuProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);

  async function handleDelete() {
    try {
      await deleteWork(workId);
      toast.success("Work deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete work");
    }
    setDeleteOpen(false);
  }

  return (
    <>
      <DropdownMenu
        align="end"
        trigger={
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80">
            <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
          </span>
        }
      >
        <DropdownMenuItem
          icon={<Pencil className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setEditOpen(true)}
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
        <DropdownMenuItem
          icon={<RefreshCw className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setMatchOpen(true)}
        >
          Match again
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Image className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setMediaOpen(true)}
        >
          Manage media
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<FolderPlus className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setCollectionOpen(true)}
          disabled={!primaryEditionId}
        >
          Add to collection
        </DropdownMenuItem>
      </DropdownMenu>

      <WorkQuickEditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        workId={workId}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete work"
        description="Are you sure you want to delete this work? This action cannot be undone."
        itemName={title}
        cascade="This will permanently delete all editions, instances, and media associated with this work."
      />

      <MediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        workId={workId}
        title={title}
      />

      {primaryEditionId && (
        <AddToCollectionDialog
          open={collectionOpen}
          onClose={() => setCollectionOpen(false)}
          editionId={primaryEditionId}
          title={title}
        />
      )}

      <MatchAgainDialog
        open={matchOpen}
        onClose={() => setMatchOpen(false)}
        workId={workId}
        currentTitle={title}
        currentAuthor={authorName ?? ""}
      />
    </>
  );
}
