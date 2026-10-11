"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { OptionsNotice } from "@/components/shared/options-notice";
import { updateWork } from "@/lib/actions/works";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import {
  WorkForm,
  workFormValues,
  workPayload,
  type WorkAuthorRow,
} from "@/components/books/work-form";
import { useEditOptions } from "@/hooks/use-edit-options";
import { WORK_EDIT_GROUPS, withChosen, type EditOption } from "@/lib/catalogue/edit-options";

interface WorkEditDialogProps {
  work: {
    id: string;
    slug: string;
    title: string;
    originalLanguage: string;
    originalYear: number | null;
    description: string | null;
    seriesName: string | null;
    seriesPosition: string | null;
    seriesId: string | null;
    isAnthology: boolean;
    workTypeId: string | null;
    notes: string | null;
    rating: number | null;
    catalogueStatus: string;
    acquisitionPriority: string;
    goodreadsUrl: string | null;
    storygraphUrl: string | null;
    recommenderIds: string[];
  };
  authors: WorkAuthorRow[];
  /** The work's own series, type and recommenders; the full lists load when the dialog opens (SLN-510) */
  chosen: { series: EditOption[]; workTypes: EditOption[]; recommenders: EditOption[] };
  /** When provided, the dialog is externally controlled and no trigger button is rendered */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WorkEditDialog({
  work,
  authors: initialAuthors,
  chosen,
  open: controlledOpen,
  onOpenChange,
}: WorkEditDialogProps) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }
  const [isPending, startTransition] = useTransition();
  const lists = useEditOptions(WORK_EDIT_GROUPS, open);
  const current = () => workFormValues(work, work.recommenderIds, initialAuthors);
  const [values, setValues] = useState(current);

  function openDialog() {
    // Every opening starts from the work as it is now
    setValues(current());
    setOpen(true);
  }

  function closeDialog() {
    if (isPending) return;
    setOpen(false);
  }

  // When externally controlled, reset form state whenever the dialog opens
  // (during render, as the dialog turns open: no effect, no second render)
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (isControlled && open) setValues(current());
  }

  function handleSubmit() {
    const payload = workPayload(values);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateWork(work.id, payload.input);
        toast.success("Work updated");
        setOpen(false);
        // A new title or primary author gives the book a new address; the old
        // one does not redirect, so go to the new one
        if (result.slug) router.replace(`/library/${result.slug}`);
        else router.refresh();
        triggerActivityRefresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update work",
        );
      }
    });
  }

  return (
    <>
      {!isControlled && (
        <Button variant="ghost" size="sm" onClick={openDialog} type="button">
          <Pencil className="h-4 w-4" strokeWidth={1.5} />
          Edit
        </Button>
      )}

      <Dialog open={open} onClose={closeDialog} title="Edit Work">
        <WorkForm
          idPrefix="edit"
          values={values}
          onChange={setValues}
          workTypes={withChosen(lists.options.workTypes, chosen.workTypes)}
          series={withChosen(lists.options.series, chosen.series).map((s) => ({ id: s.id, title: s.name }))}
          recommenders={withChosen(lists.options.recommenders, chosen.recommenders)}
          seriesKey={`${open}-${work.id}`}
          pending={isPending}
          onCancel={closeDialog}
          onSubmit={handleSubmit}
          notice={<OptionsNotice loading={lists.loading} failed={lists.failed} onRetry={lists.retry} />}
        />
      </Dialog>
    </>
  );
}
