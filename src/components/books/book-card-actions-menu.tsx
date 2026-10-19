"use client";

import { SpriteIcon } from "@/components/ui/sprite-icon";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, RefreshCw, Image, FolderPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "@/app/(catalogue)/library/[slug]/delete-confirm-dialog";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";
import { MatchAgainDialog } from "@/components/books/match-again-dialog";
import { WorkQuickEditDialog } from "@/components/books/work-quick-edit-dialog";
import { getWorkDeleteSummary } from "@/lib/actions/works";
import { workDeleteCascade } from "@/lib/catalogue/delete-cascade";
import { useDeleteSummary } from "@/components/books/use-delete-summary";
import { toast } from "@/lib/notifications/toast";
import { EbookReadMenuItem } from "@/components/ebooks/catalogue-read-action";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { deleteWork } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

interface BookCardActionsMenuProps {
  workId: string;
  slug: string;
  title: string;
  authorName?: string;
  primaryEditionId?: string;
  ebook?: WorkEbookDTO | null;
  readerReturnTo?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BookCardActionsMenu({
  workId,
  title,
  authorName,
  primaryEditionId: _primaryEditionId,
  ebook = null,
  readerReturnTo,
  open,
  onOpenChange,
}: BookCardActionsMenuProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const deleteSummary = useDeleteSummary(deleteOpen, workId, () => getWorkDeleteSummary([workId]));

  async function handleDelete() {
    try {
      await deleteWork(workId);
      toast.success("Book deleted");
      router.refresh();
    } catch (error) {
      toast.error(refusalMessage(error, "Could not delete the book. Try again."));
    }
    setDeleteOpen(false);
  }

  return (
    <>
      <DropdownMenu
        align="end"
        side="top"
        label="Actions"
        open={open}
        onOpenChange={onOpenChange}
        trigger={
          <button className="flex chip-button glass-chip">
            {/* From the sprite: this menu repeats on every card */}
            <SpriteIcon name="ellipsis-vertical" className="h-4 w-4" />
          </button>
        }
      >
        <EbookReadMenuItem ebook={ebook} returnTo={readerReturnTo} />
        <DropdownMenuItem
          icon={<Pencil className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setEditOpen(true)}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<RefreshCw className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setMatchOpen(true)}
        >
          Match again
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Image className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setMediaOpen(true)}
        >
          Manage media
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<FolderPlus className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => setCollectionOpen(true)}
        >
          Add to collection
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
        description="This cannot be undone."
        itemName={title}
        cascade={workDeleteCascade(deleteSummary)}
        refusal={deleteSummary?.refusal}
      />

      <MediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        entityId={workId}
        title={title}
      />

      <AddToCollectionDialog
        open={collectionOpen}
        onClose={() => setCollectionOpen(false)}
        workIds={[workId]}
        title={title}
      />

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
