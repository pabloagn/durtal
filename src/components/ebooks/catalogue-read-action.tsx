"use client";

import { BookOpen } from "lucide-react";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { KeyCombo } from "@/components/shortcuts/kbd";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";

/** Compact row action uses the same document entry as card menus. */
export function CatalogueReadLink({ ebook, returnTo }: { ebook: WorkEbookDTO | null; returnTo?: unknown }) {
  if (!ebook?.readable || !ebook.readerPath) return null;
  return <ReaderEntryLink readerPath={ebook.readerPath} returnTo={returnTo}
    className="inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11"
    onClick={(event) => event.stopPropagation()}>
    <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />Read
  </ReaderEntryLink>;
}

/** Slot for card/row menus; no query or client-router entry into the reader. */
export function EbookReadMenuItem({
  ebook,
  returnTo,
}: {
  ebook: WorkEbookDTO | null;
  returnTo?: unknown;
}) {
  if (!ebook?.readable || !ebook.readerPath) return null;
  return (
    <ReaderEntryLink
      readerPath={ebook.readerPath}
      returnTo={returnTo}
      role="menuitem"
      className="dropdown-item py-2 text-sm text-fg-secondary hover:bg-bg-tertiary focus:bg-bg-tertiary outline-none pointer-coarse:min-h-11"
    >
      <span className="dropdown-icon">
        <BookOpen className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="dropdown-label">Read eBook</span>
    </ReaderEntryLink>
  );
}

/** Secondary palette action; the selected-row shortcut is wired by the palette adapter. */
export function PaletteEbookReadAction({
  ebook,
  returnTo,
  onRead,
}: {
  ebook: WorkEbookDTO | null;
  returnTo?: unknown;
  onRead?: () => void;
}) {
  if (!ebook?.readable || !ebook.readerPath) return null;
  return (
    <ReaderEntryLink
      readerPath={ebook.readerPath}
      returnTo={returnTo}
      aria-label={`Read ${ebook.title}`}
      data-tooltip="Read eBook"
      data-tooltip-keys="mod enter"
      className="inline-flex min-h-8 shrink-0 items-center gap-2 rounded-sm px-2 text-xs text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:min-h-11"
      onClick={(event) => {
        event.stopPropagation();
        onRead?.();
      }}
    >
      Read
      {/* A phone has no keys to press, and its title needs the room */}
      <span className="max-sm:hidden"><KeyCombo keys={["mod", "enter"]} /></span>
    </ReaderEntryLink>
  );
}
