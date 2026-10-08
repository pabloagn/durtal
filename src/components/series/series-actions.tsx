"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { deleteSeries } from "@/lib/actions/series";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { SeriesFormDialog } from "./series-form-dialog";
import { AddSeriesBooksDialog } from "./add-series-books-dialog";

/** Add books, Edit and Delete for a series page. */
export function SeriesActions({
  series,
  bookCount,
  initialAdd = false,
}: {
  series: {
    id: string;
    title: string;
    originalTitle: string | null;
    description: string | null;
    totalVolumes: number | null;
    isComplete: boolean;
  };
  bookCount: number;
  initialAdd?: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(initialAdd);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function remove() {
    try {
      await deleteSeries(series.id);
      toast.success(`${series.title} deleted. Books kept.`);
      triggerActivityRefresh();
      router.push("/series");
      router.refresh();
    } catch {
      toast.error("Could not delete the series");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add books
      </Button>
      <EntityActionMenu
        items={[
          { label: "Edit", icon: Pencil, onClick: () => setEditOpen(true) },
          {
            label: "Delete",
            icon: Trash2,
            onClick: () => setDeleteOpen(true),
            variant: "destructive",
          },
        ]}
      />
      <AddSeriesBooksDialog
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          if (initialAdd)
            router.replace(`/series/${series.id}`, { scroll: false });
        }}
        seriesId={series.id}
        seriesTitle={series.title}
      />
      <SeriesFormDialog
        series={series}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete series"
        description="Are you sure you want to delete this series? This action cannot be undone."
        itemName={series.title}
        cascade={
          bookCount > 0
            ? `This will NOT delete the ${bookCount} ${bookCount === 1 ? "book" : "books"}; they only leave the series.`
            : undefined
        }
      />
    </div>
  );
}
