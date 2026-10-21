"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  EditionForm,
  editionPayload,
  type EditionFormValues,
} from "@/components/books/edition-form";
import { OptionsNotice } from "@/components/shared/options-notice";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import type { EditionWithRelations } from "@/lib/types/index";
import { preloadEditOptions, useEditOptions } from "@/hooks/use-edit-options";
import { EDITION_GROUPS, withChosen } from "@/lib/catalogue/edit-options";
import { mediaUrl } from "@/lib/s3/media-url";
import { updateEdition } from "@/lib/actions/catalogue-client";
import { refusalAction, refusalMessage } from "@/lib/actions/refusal";
import { saveEditionFileForm } from "@/lib/utils/edition-file-form";

interface EditionEditDialogProps {
  edition: EditionWithRelations;
}

function editionToFormValues(edition: EditionWithRelations): EditionFormValues {
  return {
    title: edition.title ?? "",
    subtitle: edition.subtitle ?? "",
    isbn13: edition.isbn13 ?? "",
    isbn10: edition.isbn10 ?? "",
    asin: edition.asin ?? "",
    lccn: edition.lccn ?? "",
    oclc: edition.oclc ?? "",
    openLibraryKey: edition.openLibraryKey ?? "",
    googleBooksId: edition.googleBooksId ?? "",
    goodreadsId: edition.goodreadsId ?? "",
    publishers: edition.publisherLinksConfirmed
      ? (edition.publisherLinks?.map((l) => l.publisher) ?? [])
      : undefined,
    publisher: edition.publisher ?? "",
    imprint: edition.imprint ?? "",
    publicationYear:
      edition.publicationYear != null ? String(edition.publicationYear) : "",
    publicationDate: edition.publicationDate ?? "",
    publicationCountry: edition.publicationCountry ?? "",
    editionName: edition.editionName ?? "",
    editionNumber:
      edition.editionNumber != null ? String(edition.editionNumber) : "",
    printingNumber:
      edition.printingNumber != null ? String(edition.printingNumber) : "",
    isFirstEdition: edition.isFirstEdition ?? false,
    isLimitedEdition: edition.isLimitedEdition ?? false,
    limitedEditionCount:
      edition.limitedEditionCount != null
        ? String(edition.limitedEditionCount)
        : "",
    language: edition.language ?? "en",
    isTranslated: edition.isTranslated ?? false,
    pageCount: edition.pageCount != null ? String(edition.pageCount) : "",
    binding: edition.binding ?? "",
    heightMm: edition.heightMm != null ? String(edition.heightMm) : "",
    widthMm: edition.widthMm != null ? String(edition.widthMm) : "",
    depthMm: edition.depthMm != null ? String(edition.depthMm) : "",
    weightGrams: edition.weightGrams != null ? String(edition.weightGrams) : "",
    illustrationType: edition.illustrationType ?? "",
    description: edition.description ?? "",
    tableOfContents: edition.tableOfContents ?? "",
    notes: edition.notes ?? "",
    coverSourceUrl: "",
    metadataLocked: edition.metadataLocked ?? false,
    metadataSource: edition.metadataSource ?? "",
    contributors: edition.contributors.map((c) => ({
      authorId: c.authorId,
      authorName: c.author.name,
      role: c.role,
    })),
    genreIds: edition.editionGenres.map((eg) => eg.genre.id),
    tagIds: edition.editionTags.map((et) => et.tag.id),
  };
}

export function EditionEditDialog({ edition }: EditionEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  // The genres and tags load as the dialog opens (SLN-510); the edition's own show at once
  const lists = useEditOptions(EDITION_GROUPS, open);

  const existingCoverUrl = edition.thumbnailS3Key
    ? mediaUrl(edition.thumbnailS3Key)
    : null;

  async function handleSubmit(values: EditionFormValues) {
    setIsPending(true);
    try {
      const input = editionPayload(values, "en");
      if (values.coverFile)
        await saveEditionFileForm(input, values.coverFile, edition.id);
      else await updateEdition(edition.id, input);

      toast.success("Edition updated");
      setOpen(false);
      router.refresh();
      triggerActivityRefresh();
    } catch (error) {
      toast.error(
        refusalMessage(error, "Failed to update edition"),
        refusalAction(error, (href) => router.push(href)),
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={(event) => {
          // Safari leaves pointer-opened buttons unfocused; the dialog needs
          // this opener before it moves focus into the edition form.
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
        onPointerEnter={() => preloadEditOptions(EDITION_GROUPS)}
        onFocus={() => preloadEditOptions(EDITION_GROUPS)}
        data-tooltip="Edit edition"
      >
        <Pencil className="h-4 w-4" strokeWidth={1.5} />
        Edit
      </Button>

      <Dialog
        draft
        open={open}
        onClose={() => setOpen(false)}
        title="Edit edition"
        description={edition.title}
        className="max-w-3xl"
      >
        <div>
          <EditionForm
            initialValues={editionToFormValues(edition)}
            availableGenres={withChosen(
              lists.options.genres,
              edition.editionGenres.map((eg) => eg.genre),
            )}
            availableTags={withChosen(
              lists.options.tags,
              edition.editionTags.map((et) => et.tag),
            )}
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            submitLabel="Save changes"
            isPending={isPending}
            existingCoverUrl={existingCoverUrl}
            notice={
              <OptionsNotice
                loading={lists.loading}
                failed={lists.failed}
                onRetry={lists.retry}
              />
            }
            listsNote={
              lists.failed
                ? "Not loaded"
                : lists.loading
                  ? "Loading…"
                  : undefined
            }
          />
        </div>
      </Dialog>
    </>
  );
}
