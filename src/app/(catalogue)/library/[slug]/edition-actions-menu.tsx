"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Building2, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { EntityActionMenu, type EntityActionItem } from "@/components/shared/entity-action-menu";
import { AddToCollectionDialog } from "@/components/books/add-to-collection-dialog";
import { MatchAgainDialog } from "@/components/books/match-again-dialog";
import { editPublisherLinks } from "@/components/publishers/edition-publishers";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { keptNotesText } from "@/lib/reading/notes-text";
import { deleteEdition } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

/**
 * An edition card's less frequent actions (SLN-693), in the same Actions menu
 * as the book's own: Add to collection, Match again, the publisher links and,
 * set apart at the end, Delete edition.
 */
export function EditionActionsMenu({
  editionId,
  editionTitle,
  workId,
  authorName,
  metadataSource,
  hasPublisherLinks,
  instanceCount,
  quoteCount = 0,
  noteCount = 0,
}: {
  editionId: string;
  editionTitle: string;
  workId?: string;
  authorName: string;
  metadataSource?: string | null;
  hasPublisherLinks: boolean;
  instanceCount: number;
  /** Its quotes and notes, which stay with the book without the edition (SLN-480) */
  quoteCount?: number;
  noteCount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"collection" | "match" | "delete" | null>(null);
  const close = () => setOpen(null);

  const items: EntityActionItem[] = [
    { label: "Add to collection", icon: FolderPlus, onClick: () => setOpen("collection") },
    ...(workId ? [{ label: "Match again", icon: RefreshCw, onClick: () => setOpen("match") }] : []),
    {
      label: hasPublisherLinks ? "Edit publisher links" : "Link publisher",
      icon: Building2,
      onClick: () => editPublisherLinks(editionId),
    },
    { label: "Delete edition", icon: Trash2, variant: "destructive", onClick: () => setOpen("delete") },
  ];

  async function handleDelete() {
    try {
      await deleteEdition(editionId);
    } catch (error) {
      // The server's reason, such as an accepted enrichment value resting on
      // this edition's sources (SLN-1033)
      toast.error(refusalMessage(error, "Could not delete the edition"));
      close();
      return;
    }
    toast.success("Edition deleted");
    close();
    router.refresh();
    triggerActivityRefresh();
  }

  return (
    <>
      <EntityActionMenu items={items} size="sm" label={`Actions for ${editionTitle}`} />
      {open === "collection" && (
        <AddToCollectionDialog open onClose={close} workIds={[]} editionId={editionId} title={editionTitle} />
      )}
      {workId && (
        <MatchAgainDialog
          open={open === "match"}
          onClose={close}
          workId={workId}
          editionId={editionId}
          currentTitle={editionTitle}
          currentAuthor={authorName}
          currentMetadataSource={metadataSource}
        />
      )}
      <DeleteConfirmDialog
        open={open === "delete"}
        onClose={close}
        onConfirm={handleDelete}
        title="Delete edition"
        description={`This cannot be undone.${keptNotesText(quoteCount, noteCount, ", without this edition")}`}
        itemName={editionTitle}
        cascade={[
          instanceCount > 0 ? `This will also delete ${instanceCount} instance${instanceCount === 1 ? "" : "s"}.` : null,
          "Linked eBooks return to review; their files, reading positions and annotations are kept.",
        ].filter(Boolean).join(" ")}
      />
    </>
  );
}
