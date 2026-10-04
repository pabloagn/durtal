"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ImageIcon, Library, Pencil } from "lucide-react";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { MediaManagerDialog } from "@/components/books/media-manager-dialog";
import { Monogram } from "@/components/shared/no-photo";
import { PublisherFavourite } from "./favourite-button";

/**
 * The head of a publisher page: the house's logo, shown whole on a dark
 * tile, its name, what it is and where, and its actions. Like the author
 * page, a background image runs behind it when the house has one.
 */
export function PublisherHeader({
  id,
  slug,
  name,
  logoUrl,
  facts,
  favourite,
}: {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  /** What the house is and where, in reading order: "Imprint of Penguin", "United Kingdom" */
  facts: React.ReactNode[];
  favourite: boolean;
}) {
  const router = useRouter();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const actions = [
    {
      label: copied ? "Copied" : "Copy name",
      icon: copied ? Check : Copy,
      onClick: async () => {
        await navigator.clipboard.writeText(name);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
    },
    { label: "Edit", icon: Pencil, onClick: () => router.push(`/publishers/${slug}/edit`) },
    { label: "Manage media", icon: ImageIcon, onClick: () => setMediaOpen(true) },
    { label: "View in library", icon: Library, onClick: () => router.push(`/library?publisher=${id}`) },
  ];

  return (
    <>
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:gap-8">
        {/* A logo is never cut: it sits whole, centered, on its tile */}
        <div className="relative flex size-40 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-glass-border bg-bg-tertiary">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${name} logo`}
              className="protected-image max-h-[85%] max-w-[85%] object-contain"
            />
          ) : (
            <Monogram name={name} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="type-page-title flex items-start gap-4">
            <h1 className="type-page-title min-w-0 flex-1 break-words">{name}</h1>
            {/* On the cap-height center of the name's first line */}
            <CapAlignedControls height={32} className="type-page-title">
              <PublisherFavourite id={id} favourite={favourite} />
              <Link
                href={`/publishers/${slug}/edit`}
                className="inline-flex h-8 items-center rounded-sm border border-glass-border px-3 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
              >
                Edit
              </Link>
              <EntityActionMenu items={actions} />
            </CapAlignedControls>
          </div>
          {facts.length > 0 && (
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm text-fg-secondary">
              {facts.map((fact, i) => (
                <span key={i} className="flex items-baseline gap-x-2">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {fact}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <MediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        entityType="organization"
        entityId={id}
        title={name}
        slot="square"
      />
    </>
  );
}
