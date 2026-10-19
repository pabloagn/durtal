"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useCoverMenu } from "@/hooks/use-cover-menu";
import { FadeImage } from "@/components/shared/fade-image";
import { coverToneStyle, mediaImageStyle } from "@/lib/utils/media-style";
import type { MediaCrop } from "@/lib/utils/media-style";

/** One picture in a mosaic */
export interface MosaicItem {
  key: string;
  href: string;
  /** Shown on hover and read by screen readers */
  title: string;
  /** A second line under the title on hover (the author, the house) */
  subtitle?: string | null;
  /** The picture's width over its height (2/3 for a book cover) */
  aspect: number;
  /** The picture itself, filling the tile (`MosaicImage`, or a kind's own poster) */
  media: ReactNode;
  mark?: ReactNode;
  /** Optional catalogue menu, rendered beside the document link. */
  actions?: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;
}

function MosaicTile({ item, isSelecting, selected, onSelect }: {
  item: MosaicItem;
  isSelecting: boolean;
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Reset before rendering selection so the menu stays closed when it ends.
  if (isSelecting && menuOpen) setMenuOpen(false);
  const coverMenu = useCoverMenu(!isSelecting && !!item.actions, () => setMenuOpen(true));
  const content = <>
    <span className="mosaic-media">{item.media}</span>
    {!isSelecting && item.mark}
    <span className="absolute inset-0" aria-hidden />
    <span className="mosaic-caption glass" aria-hidden>
      <span className="block truncate text-xs text-fg-primary">{item.title}</span>
      {item.subtitle && <span className="block truncate text-micro text-fg-secondary">{item.subtitle}</span>}
    </span>
  </>;
  const className = `mosaic-tile group/tile ${selected ? "mosaic-tile-selected" : ""}`;
  const link = <Link href={item.href}
    data-focus-row={item.actions ? undefined : ""}
    aria-label={item.subtitle ? `${item.title}, ${item.subtitle}` : item.title}
    aria-pressed={isSelecting ? selected : undefined}
    className={item.actions ? "absolute inset-0 outline-none" : className}
    style={item.actions ? undefined : { "--tile-aspect": item.aspect } as CSSProperties}
    {...coverMenu}
    onClick={(event) => {
      if (!isSelecting || !onSelect) return;
      event.preventDefault(); onSelect(item.key);
    }}>{content}</Link>;
  if (!item.actions) return link;
  return <div data-focus-row="" className={`${className} group focus-within:ring-2 focus-within:ring-accent-primary focus-within:[&_.mosaic-caption]:opacity-100 focus-within:[&_.mosaic-caption]:translate-y-0`}
    style={{ "--tile-aspect": item.aspect } as CSSProperties}>
    {link}
    {!isSelecting && <div className={`artwork-actions !bottom-auto !top-1 ${menuOpen ? "before:!opacity-100 [&>div]:!opacity-100" : ""}`}>
      {item.actions(menuOpen, setMenuOpen)}
    </div>}
  </div>;
}

/**
 * Images per row from the size slider (2 to 8). A mosaic is denser than the
 * grid, which also shows a card's text: two more per row.
 */
export function mosaicPerRow(sliderValue: number) {
  return Math.min(10, Math.max(4, sliderValue + 2));
}

/**
 * A mosaic of pictures, nothing else: no card, no text, no chips. Rows are
 * justified: every picture in a row has one height, each keeps its own
 * proportions (a painting is not cropped to a poster), and every row but the
 * last fills the width, in reading order. `perRow` pictures of the reference
 * proportions (`aspect`) fit a full row; a narrow screen holds fewer, as a
 * picture of those proportions is never under 150px tall. The last row has
 * the height of a full row. Hovering a picture lifts it and shows its title
 * on glass while the others dim. A right-click opens the link's menu.
 */
export function Mosaic({
  items,
  perRow,
  aspect,
  isSelecting = false,
  selectedIds,
  onSelect,
}: {
  items: MosaicItem[];
  perRow: number;
  /** The usual proportions in this list, which sets the row height */
  aspect: number;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="@container">
      <div
        className="mosaic"
        // A deleted picture hands the focus to the next one (FocusKeeper)
        data-focus-list="mosaic"
        style={{ "--mosaic-per-row": perRow, "--mosaic-aspect": aspect } as CSSProperties}
      >
        {items.map((item) => <MosaicTile key={item.key} item={item} isSelecting={isSelecting}
          selected={selectedIds?.has(item.key) ?? false} onSelect={onSelect} />)}
        {/* Takes the free space of the last row, so it keeps its height */}
        <span className="mosaic-fill" aria-hidden />
      </div>
    </div>
  );
}

/**
 * A stored picture for a mosaic tile: over its own tone while it loads,
 * framed as it was cropped; `fallback` when there is none.
 */
export function MosaicImage({
  src,
  crop,
  tone,
  fallback,
  fit = "cover",
}: {
  src: string | null | undefined;
  crop?: MediaCrop | null;
  tone?: string | null;
  fallback: ReactNode;
  fit?: "cover" | "contain";
}) {
  return (
    <span className="absolute inset-0 overflow-hidden bg-bg-tertiary" style={src ? coverToneStyle(tone) : undefined}>
      {src ? (
        <FadeImage
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          fallback={fallback}
          className={`protected-image absolute inset-0 h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
          style={fit === "cover" ? mediaImageStyle(crop) : undefined}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
