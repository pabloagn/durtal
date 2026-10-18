"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editHint } from "@/lib/shortcuts/shortcuts";
import { DeleteConfirmDialog } from "@/app/(catalogue)/library/[slug]/delete-confirm-dialog";
import { deleteSeries } from "@/lib/actions/series";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { DetailEditButton } from "@/components/shared/detail-layout";
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
  const [addOpen, setAddOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // A new series opens on its Add books dialog: it opens from Add books, so
  // the focus comes back there when it closes, not to the page body (SLN-920)
  useEffect(() => {
    if (!initialAdd) return;
    addButton.current?.focus();
    setAddOpen(true);
    // Once, on arrival: initialAdd is the address it opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // E then S: the same dialog as the menu's Edit (SLN-633)
  useEditActions([{ key: EDIT_KEYS.series, label: "Series", icon: Pencil, run: () => setEditOpen(true) }]);

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
      <Button
        ref={addButton}
        variant="secondary"
        size="sm"
        onClick={() => setAddOpen(true)}
        data-focus-empty="series"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add books
      </Button>
      {/* Edit shows its E S key, as on every detail page (SLN-967) */}
      <DetailEditButton label="Edit series" editKey={EDIT_KEYS.series} onClick={() => setEditOpen(true)} />
      <EntityActionMenu
        items={[
          { label: "Edit", icon: Pencil, onClick: () => setEditOpen(true), shortcut: editHint(EDIT_KEYS.series) },
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
        description="This cannot be undone."
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
