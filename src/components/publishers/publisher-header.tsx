"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ImageIcon, Library, Pencil } from "lucide-react";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { Monogram } from "@/components/shared/no-photo";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editHint, editTooltipKeys } from "@/lib/shortcuts/shortcuts";

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
  logoIsCard = false,
  facts,
  favourite,
}: {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  /** A logo card (SLN-441): a 3:2 tile it fills */
  logoIsCard?: boolean;
  /** What the house is and where, in reading order: "Imprint of Penguin", "United Kingdom" */
  facts: React.ReactNode[];
  favourite: boolean;
}) {
  const router = useRouter();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const edit = () => router.push(`/publishers/${slug}/edit`);
  // E then P or M: the same editor page and dialog as the buttons (SLN-633)
  useEditActions([
    { key: EDIT_KEYS.publisher, label: "Publisher", icon: Pencil, run: edit },
    { key: EDIT_KEYS.media, label: "Media", icon: ImageIcon, run: () => setMediaOpen(true) },
  ]);

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
    { label: "Edit", icon: Pencil, onClick: edit, shortcut: editHint(EDIT_KEYS.publisher) },
    { label: "Manage media", icon: ImageIcon, onClick: () => setMediaOpen(true), shortcut: editHint(EDIT_KEYS.media) },
    { label: "View in library", icon: Library, onClick: () => router.push(`/library?publisher=${id}`) },
  ];

  return (
    <>
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:gap-8">
        {/* A logo is never cut: it sits whole, centered, on its tile; a logo
            card fills its own 3:2 tile */}
        <div
          className={`relative flex ${logoIsCard ? "h-40 w-60" : "size-40"} shrink-0 items-center justify-center overflow-hidden rounded-sm border border-glass-border bg-bg-tertiary`}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${name} logo`}
              className={`protected-image ${logoIsCard ? "h-full w-full object-cover" : "max-h-[85%] max-w-[85%] object-contain"}`}
            />
          ) : (
            <Monogram name={name} />
          )}
        </div>

        <div className="@container min-w-0 flex-1">
          {/* A long name keeps the row's width on a narrow screen: the
              controls go under it when it would not fit on one line beside
              them, and stay beside a short name or a wide row's name */}
          <div className="type-page-title flex flex-wrap items-start gap-x-4 @xl:flex-nowrap">
            <h1 className="type-page-title min-w-0 flex-[1_1_auto] break-words">{name}</h1>
            {/* On the cap-height center of the name's first line */}
            <CapAlignedControls height={32} coarseHeight={44} className="type-page-title">
              <FavouriteToggle
                favourite={favourite}
                target={{ entity: "publisher", id }}
                name={name}
                shortcut
              />
              <Link
                href={`/publishers/${slug}/edit`}
                data-tooltip="Edit publisher"
                data-tooltip-keys={editTooltipKeys(EDIT_KEYS.publisher)}
                className="inline-flex h-8 items-center rounded-sm border border-glass-border px-3 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11"
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
