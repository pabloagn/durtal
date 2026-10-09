"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { RecommenderFormDialog } from "@/components/recommenders/recommender-form-dialog";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { deleteRecommender } from "@/lib/actions/recommenders";

/** Copy / Edit / Delete for a recommender page, like the author header menu. */
export function RecommenderActions({
  recommender,
  bookCount,
}: {
  recommender: { id: string; name: string; url: string | null };
  bookCount: number;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyName() {
    try {
      await navigator.clipboard.writeText(recommender.name);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy. Allow clipboard access and try again.");
    }
  }

  async function remove() {
    try {
      await deleteRecommender(recommender.id);
      toast.success(`${recommender.name} deleted. Books kept.`);
      router.push("/recommenders");
      router.refresh();
    } catch {
      toast.error("Could not delete the recommender");
    }
  }

  return (
    <>
      <EntityActionMenu
        items={[
          {
            label: copied ? "Copied!" : "Copy Name",
            icon: copied ? Check : Copy,
            onClick: copyName,
          },
          { label: "Edit", icon: Pencil, onClick: () => setEditOpen(true) },
          {
            label: "Delete",
            icon: Trash2,
            onClick: () => setDeleteOpen(true),
            variant: "destructive",
          },
        ]}
      />
      <RecommenderFormDialog
        recommender={recommender}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete recommender"
        description="This cannot be undone."
        itemName={recommender.name}
        cascade={
          bookCount > 0
            ? `This will NOT delete the ${bookCount} ${bookCount === 1 ? "book" : "books"}; it only removes this recommendation.`
            : undefined
        }
      />
    </>
  );
}
