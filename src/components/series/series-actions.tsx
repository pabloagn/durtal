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
import { SeriesFormDialog } from "./series-form-dialog";
import { AddSeriesBooksDialog } from "./add-series-books-dialog";

const ADD_EVENT = "durtal:series-add";

/**
 * The empty series' own Add books: it opens the same dialog as the header's
 * would, at once and with no round trip (SLN-918)
 */
export function AddSeriesBooksButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => window.dispatchEvent(new CustomEvent(ADD_EVENT))}
      data-focus-empty="series"
    >
      <Plus size={14} strokeWidth={1.5} />
      Add books
    </Button>
  );
}

/** Add books (once it has some), Edit and Delete for a series page. */
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
  // Books added to an empty series: the empty state's Add, which opened the
  // dialog, leaves with it, so the focus goes to the header's Add that takes
  // its place, whether the page or the dialog goes first
  const empty = bookCount === 0;
  const focusAddIfLost = () => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) addButton.current?.focus();
  };
  const wasEmpty = useRef(empty);
  useEffect(() => {
    if (wasEmpty.current && !empty) focusAddIfLost();
    wasEmpty.current = empty;
  }, [empty]);
  useEffect(() => {
    // Empty, the header has no Add: the dialog opens from the empty state's
    const onAdd = () => {
      (addButton.current ?? document.querySelector<HTMLElement>('[data-focus-empty="series"]'))?.focus();
      setAddOpen(true);
    };
    window.addEventListener(ADD_EVENT, onAdd);
    // A new series opens on its Add books dialog: it opens from Add books, so
    // the focus comes back there when it closes, not to the page body (SLN-920)
    if (initialAdd) onAdd();
    return () => window.removeEventListener(ADD_EVENT, onAdd);
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
      {!empty && (
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
      )}
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
          setTimeout(focusAddIfLost, 0);
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
