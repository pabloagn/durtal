"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Check, Merge, Pencil, ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AuthorEditDialog } from "./author-edit-dialog";
import { AuthorMergeDialog } from "./author-merge-dialog";
import { AuthorMediaManagerDialog } from "@/components/media/author-media-manager-dialog";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { ExportMenu } from "@/components/shared/export-menu";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { ProtectedImageWrapper } from "@/components/shared/protected-image";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { deleteAuthor } from "@/lib/actions/authors";
import { nationalityFilterHref } from "@/lib/utils/nationality-param";
import { mediaImageStyle, type MediaCrop } from "@/lib/utils/media-style";

type PosterCrop = MediaCrop;

interface AuthorDetailHeaderProps {
  authorId: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  realName?: string | null;
  countryName?: string | null;
  /** Official name from the countries table, shown as the tooltip */
  countryOfficialName?: string | null;
  countryCode?: string | null;
  lifeDates?: string | null;
  posterUrl?: string | null;
  posterCrop?: PosterCrop | null;
  workCount: number;
}

export function AuthorDetailHeader({
  authorId,
  name,
  firstName,
  lastName,
  realName,
  countryName,
  countryOfficialName,
  countryCode,
  lifeDates,
  posterUrl,
  posterCrop,
  workCount,
}: AuthorDetailHeaderProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopyName() {
    const fullName =
      firstName && lastName
        ? `${firstName} ${lastName}`
        : name;
    await navigator.clipboard.writeText(fullName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleDelete() {
    try {
      await deleteAuthor(authorId);
      toast.success("Author deleted");
      router.push("/authors");
    } catch {
      toast.error("Failed to delete author");
    }
  }

  const actionItems = [
    {
      label: copied ? "Copied!" : "Copy Name",
      icon: copied ? Check : Copy,
      onClick: handleCopyName,
    },
    {
      label: "Merge",
      icon: Merge,
      onClick: () => setMergeOpen(true),
    },
    {
      label: "Edit",
      icon: Pencil,
      onClick: () => setEditOpen(true),
    },
    {
      label: "Manage Media",
      icon: ImageIcon,
      onClick: () => setMediaOpen(true),
    },
    {
      label: "Delete",
      icon: Trash2,
      onClick: () => setDeleteOpen(true),
      variant: "destructive" as const,
    },
  ];

  return (
    <>
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:gap-8">
        {posterUrl ? (
          <ProtectedImageWrapper
            className="h-64 w-48 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary cursor-pointer"
          >
            <div
              className="relative h-full w-full focus-visible:-outline-offset-1"
              onClick={() => setLightboxOpen(true)}
              role="button"
              aria-label={`View full image: ${name} portrait`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLightboxOpen(true);
                }
              }}
            >
              <Image
                src={posterUrl}
                alt={`${name} portrait`}
                fill
                sizes="192px"
                className="protected-image object-cover transition-transform duration-300 hover:scale-[1.03]"
                style={mediaImageStyle(posterCrop)}
                unoptimized
              />
            </div>
          </ProtectedImageWrapper>
        ) : (
          <div className="flex h-64 w-48 flex-shrink-0 items-center justify-center rounded-sm bg-bg-tertiary">
            <span className="font-serif text-4xl text-fg-muted/20">
              {name[0]}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Actions wrap below the name when the column is narrow */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="type-page-title break-words">
                {name}
              </h1>
              {realName && realName !== name && (
                <p className="mt-1 text-sm text-fg-secondary italic">
                  {realName}
                </p>
              )}
            </div>
            {/* On the cap-height center of the name's first line */}
            <CapAlignedControls height={32} className="type-page-title">
              <ExportMenu
                entity="authors"
                ids={[authorId]}
                side="bottom"
                align="end"
                size="sm"
              />
              <EntityActionMenu items={actionItems} />
            </CapAlignedControls>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            {countryName &&
              (countryCode ? (
                <Link
                  href={nationalityFilterHref(countryCode)}
                  data-tooltip={
                    countryOfficialName !== countryName
                      ? countryOfficialName ?? undefined
                      : undefined
                  }
                  className="text-fg-primary font-medium transition-colors hover:text-accent-rose-text"
                >
                  {countryName}
                </Link>
              ) : (
                <span className="text-fg-primary font-medium">{countryName}</span>
              ))}
            {lifeDates && (
              <span className="font-mono text-xs text-fg-secondary">
                {lifeDates}
              </span>
            )}
          </div>
        </div>
      </div>

      <AuthorEditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        authorId={authorId}
      />

      <AuthorMediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        authorId={authorId}
        authorName={name}
      />

      <AuthorMergeDialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        targetAuthorId={authorId}
        targetAuthorName={name}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete author"
        description="Are you sure you want to delete this author? This action cannot be undone."
        itemName={name}
        cascade={
          workCount > 0
            ? "This will NOT delete the author's books, but will remove authorship links."
            : undefined
        }
      />

      {posterUrl && (
        <ImageLightbox
          src={posterUrl}
          alt={`${name} portrait`}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
