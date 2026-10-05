"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  EditionForm,
  EMPTY_EDITION,
  editionPayload,
  type EditionFormValues,
} from "@/components/books/edition-form";
import { createEdition } from "@/lib/actions/editions";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { useAppSettings } from "@/lib/hooks/use-app-settings";

interface EditionAddDialogProps {
  workId: string;
  workTitle: string;
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
  /** When provided, the dialog is externally controlled and no trigger button is rendered */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function EditionAddDialog({
  workId,
  workTitle,
  availableGenres,
  availableTags,
  open: controlledOpen,
  onOpenChange,
}: EditionAddDialogProps) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  function setOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const [isPending, setIsPending] = useState(false);
  // A new edition starts in the new-book language (Settings, General)
  const { newBookLanguage } = useAppSettings();

  const initialValues: EditionFormValues = {
    ...EMPTY_EDITION,
    title: workTitle,
    language: newBookLanguage,
  };

  async function handleSubmit(values: EditionFormValues) {
    setIsPending(true);
    try {
      const edition = await createEdition({
        workId,
        ...editionPayload(values, newBookLanguage),
      });

      toast.success("Edition created");
      if (edition.coverUnavailable)
        toast.warning(
          "The cover could not be downloaded. Its source URL was saved.",
        );
      setOpen(false);
      router.refresh();
      triggerActivityRefresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create edition";
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      {!isControlled && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-7 gap-1 px-2"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Add edition
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add Edition"
        description={workTitle}
        className="max-w-3xl"
      >
        <div className="max-h-[75vh] overflow-y-auto">
          <EditionForm
            initialValues={initialValues}
            availableGenres={availableGenres}
            availableTags={availableTags}
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            submitLabel="Create edition"
            isPending={isPending}
          />
        </div>
      </Dialog>
    </>
  );
}
