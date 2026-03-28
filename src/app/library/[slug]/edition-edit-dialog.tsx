"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  EditionForm,
  type EditionFormValues,
} from "@/components/books/edition-form";
import { updateEdition } from "@/lib/actions/editions";
import { findOrCreateAuthor } from "@/lib/actions/authors";
import type { EditionWithRelations } from "@/lib/types/index";

interface EditionEditDialogProps {
  edition: EditionWithRelations;
  availableAuthors: { id: string; name: string }[];
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
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
    publisher: edition.publisher ?? "",
    imprint: edition.imprint ?? "",
    publicationYear: edition.publicationYear != null ? String(edition.publicationYear) : "",
    publicationDate: edition.publicationDate ?? "",
    publicationCountry: edition.publicationCountry ?? "",
    editionName: edition.editionName ?? "",
    editionNumber: edition.editionNumber != null ? String(edition.editionNumber) : "",
    printingNumber: edition.printingNumber != null ? String(edition.printingNumber) : "",
    isFirstEdition: edition.isFirstEdition ?? false,
    isLimitedEdition: edition.isLimitedEdition ?? false,
    limitedEditionCount: edition.limitedEditionCount != null ? String(edition.limitedEditionCount) : "",
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

export function EditionEditDialog({
  edition,
  availableAuthors,
  availableGenres,
  availableTags,
}: EditionEditDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const existingCoverUrl = edition.thumbnailS3Key
    ? `/api/s3/read?key=${encodeURIComponent(edition.thumbnailS3Key)}`
    : null;

  async function handleSubmit(values: EditionFormValues) {
    setIsPending(true);
    try {
      // Resolve contributors: find or create authors that have no authorId
      const resolvedContributors = await Promise.all(
        values.contributors.map(async (c) => {
          if (c.authorId) {
            return { authorId: c.authorId, role: c.role };
          }
          const author = await findOrCreateAuthor(c.authorName);
          return { authorId: author.id, role: c.role };
        }),
      );

      await updateEdition(edition.id, {
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
        publisher: values.publisher || null,
        imprint: values.imprint || null,
        publicationYear: values.publicationYear ? parseInt(values.publicationYear, 10) : null,
        publicationDate: values.publicationDate || null,
        publicationCountry: values.publicationCountry || null,
        editionName: values.editionName || null,
        editionNumber: values.editionNumber ? parseInt(values.editionNumber, 10) : null,
        printingNumber: values.printingNumber ? parseInt(values.printingNumber, 10) : null,
        isFirstEdition: values.isFirstEdition,
        isLimitedEdition: values.isLimitedEdition,
        limitedEditionCount: values.limitedEditionCount ? parseInt(values.limitedEditionCount, 10) : null,
        language: values.language || "en",
        isTranslated: values.isTranslated,
        pageCount: values.pageCount ? parseInt(values.pageCount, 10) : null,
        binding: values.binding || null,
        heightMm: values.heightMm ? parseInt(values.heightMm, 10) : null,
        widthMm: values.widthMm ? parseInt(values.widthMm, 10) : null,
        depthMm: values.depthMm ? parseInt(values.depthMm, 10) : null,
        weightGrams: values.weightGrams ? parseInt(values.weightGrams, 10) : null,
        illustrationType: values.illustrationType || null,
        description: values.description || null,
        tableOfContents: values.tableOfContents || null,
        notes: values.notes || null,
        // Only send coverSourceUrl if it changed (non-empty)
        ...(values.coverSourceUrl ? { coverSourceUrl: values.coverSourceUrl } : {}),
        metadataLocked: values.metadataLocked,
        contributorIds: resolvedContributors,
        genreIds: values.genreIds,
        tagIds: values.tagIds,
      });

      toast.success("Edition updated");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Failed to update edition");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 w-7 p-0"
        title="Edit edition"
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Edition"
        description={edition.title}
        className="max-w-3xl"
      >
        <div className="max-h-[72vh] overflow-y-auto">
          <EditionForm
            initialValues={editionToFormValues(edition)}
            availableAuthors={availableAuthors}
            availableGenres={availableGenres}
            availableTags={availableTags}
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            submitLabel="Save changes"
            isPending={isPending}
            existingCoverUrl={existingCoverUrl}
          />
        </div>
      </Dialog>
    </>
  );
}
