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
  type EditionFormValues,
} from "@/components/books/edition-form";
import { createEdition } from "@/lib/actions/editions";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

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

  const initialValues: EditionFormValues = {
    ...EMPTY_EDITION,
    title: workTitle,
  };

  async function handleSubmit(values: EditionFormValues) {
    setIsPending(true);
    try {
      // A contributor without an id is found by name, or created with the
      // edition in the same write
      const resolvedContributors = values.contributors.map((c) =>
        c.authorId
          ? { authorId: c.authorId, role: c.role }
          : { authorName: c.authorName, role: c.role },
      );

      const edition = await createEdition({
        workId,
        title: values.title,
        subtitle: values.subtitle || null,
        isbn13: values.isbn13 || null,
        isbn10: values.isbn10 || null,
        asin: values.asin || null,
        lccn: values.lccn || null,
        oclc: values.oclc || null,
        openLibraryKey: values.openLibraryKey || null,
        googleBooksId: values.googleBooksId || null,
        goodreadsId: values.goodreadsId || null,
        publisherIds: values.publishers?.map((p) => p.id),
        publisher: values.publisher || null,
        imprint: values.imprint || null,
        publicationYear: values.publicationYear
          ? parseInt(values.publicationYear, 10)
          : null,
        publicationDate: values.publicationDate || null,
        publicationCountry: values.publicationCountry || null,
        editionName: values.editionName || null,
        editionNumber: values.editionNumber
          ? parseInt(values.editionNumber, 10)
          : null,
        printingNumber: values.printingNumber
          ? parseInt(values.printingNumber, 10)
          : null,
        isFirstEdition: values.isFirstEdition,
        isLimitedEdition: values.isLimitedEdition,
        limitedEditionCount: values.limitedEditionCount
          ? parseInt(values.limitedEditionCount, 10)
          : null,
        language: values.language || "en",
        isTranslated: values.isTranslated,
        pageCount: values.pageCount ? parseInt(values.pageCount, 10) : null,
        binding: values.binding || null,
        heightMm: values.heightMm ? parseInt(values.heightMm, 10) : null,
        widthMm: values.widthMm ? parseInt(values.widthMm, 10) : null,
        depthMm: values.depthMm ? parseInt(values.depthMm, 10) : null,
        weightGrams: values.weightGrams
          ? parseInt(values.weightGrams, 10)
          : null,
        illustrationType: values.illustrationType || null,
        description: values.description || null,
        tableOfContents: values.tableOfContents || null,
        notes: values.notes || null,
        ...(values.coverSourceUrl
          ? { coverSourceUrl: values.coverSourceUrl }
          : {}),
        metadataLocked: values.metadataLocked,
        contributorIds: resolvedContributors,
        genreIds: values.genreIds,
        tagIds: values.tagIds,
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
