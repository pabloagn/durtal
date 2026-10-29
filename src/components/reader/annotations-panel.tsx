"use client";

import { SEARCH_INPUT_ATTRIBUTES } from "@/lib/ui/input-attributes";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, NotebookPen, Trash2 } from "lucide-react";
import { Prose } from "@/components/shared/prose";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { SectionHeading } from "@/components/shared/section-heading";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ReaderSidePanel } from "./side-panel";
import { AnnotationExportControls } from "./annotation-export-controls";
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
  type ReaderAnnotation,
} from "@/lib/reader/annotations";
import {
  annotationCounts,
  annotationPanelGroups,
  type AnnotationTab,
} from "@/lib/reader/annotation-panel";
import type { AnnotationExportBook } from "@/lib/reader/export";
import { fractionPercent, pageWords } from "@/lib/reader/place-label";

/** What a tab says when the book has none of its kind yet */
const EMPTY: Record<AnnotationTab, string> = {
  highlights: "No highlights yet. Select text in the book to highlight it.",
  notes: "No notes yet. Select text in the book and add a note to it.",
  bookmarks: "No bookmarks yet. Bookmark a page from the top bar.",
};

/**
 * What the row's clamp cuts (a passage at three lines, a note at six: one of
 * 9,500 letters ran 8,000px, SLN-682), measured as its menu opens, so the menu
 * offers the whole text exactly when some is hidden: a short verse or a list
 * cut by its line breaks too, and never a long passage that fits a wide panel.
 * The row is on screen then, so content-visibility has laid it out.
 */
function useCut() {
  const passageRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState<"passage" | "note" | null>(null);
  const measure = useCallback(() => {
    const over = (el: HTMLElement | null) => !!el && el.scrollHeight > el.clientHeight + 1;
    setCut(over(passageRef.current) ? "passage" : over(noteRef.current) ? "note" : null);
  }, []);
  return [passageRef, noteRef, cut, measure] as const;
}

const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

function markFill(item: ReaderAnnotation) {
  if (item.style === "quote" || !item.color) return QUIET_GLASS_ANNOTATION_PALETTE.quote;
  return QUIET_GLASS_ANNOTATION_PALETTE.fills[item.color];
}

/** A quote says so (SLN-682), then the page, or the percent, then the day, written as on /ebooks/highlights */
function markPlace(item: ReaderAnnotation) {
  const place = item.locator.pageLabel ? pageWords(item.locator.pageLabel, undefined) : fractionPercent(item.progression);
  return [item.style === "quote" ? "Quote" : null, place, item.updatedAt.slice(0, 10)].filter(Boolean).join(" · ");
}

/**
 * One mark: the passage itself goes to it, and a quiet menu beside it holds
 * the rest (the full text, the note, the colour, Delete), so the list reads
 * as passages, not as rows of buttons (SLN-726).
 */
function MarkRow({ item, orphaned, expanded, onToggle, onGo, onNote, onEdit, onDelete }: {
  item: ReaderAnnotation;
  orphaned: boolean;
  expanded: boolean;
  onToggle(): void;
  onGo(): void;
  onNote(): void;
  onEdit(edit: { color: AnnotationColor }): void;
  onDelete(): void;
}) {
  const text = item.text ??
    item.locator.text?.highlight?.trim().split(/\s+/).slice(0, 8).join(" ") ??
    "Bookmark";
  const highlight = item.kind === "highlight";
  const [passageRef, noteRef, cut, measure] = useCut();
  // Named by its passage, described by its note and place
  const id = useId();
  const body = (
    <>
      <CapAligned height={12}>
        <span aria-hidden className="block h-3 w-1 rounded-sm" style={{ backgroundColor: markFill(item) }} />
      </CapAligned>
      <span className="block min-w-0 flex-1">
        <span ref={passageRef} id={`${id}-text`} className={`whitespace-pre-wrap break-words text-fg-primary ${expanded ? "block" : "line-clamp-3"}`}>{text}</span>
        {item.note && <span ref={noteRef} id={`${id}-note`} className={`mt-2 whitespace-pre-wrap break-words text-fg-secondary ${expanded ? "block" : "line-clamp-6"}`}>{item.note}</span>}
        <span id={`${id}-place`} className="mt-2 block font-sans text-xs text-fg-secondary">
          {markPlace(item)}
        </span>
      </span>
    </>
  );
  return (
    <li className="border-b border-glass-border pb-3 [content-visibility:auto] [contain-intrinsic-size:auto_160px]">
      <Prose className="flex max-w-none items-start gap-1">
        {orphaned ? (
          <span className="flex min-w-0 flex-1 items-start gap-2 py-1">{body}</span>
        ) : (
          <button
            type="button"
            data-annotation-go
            aria-labelledby={`${id}-text`}
            aria-describedby={item.note ? `${id}-note ${id}-place` : `${id}-place`}
            onClick={onGo}
            className="-ml-2 flex min-w-0 flex-1 items-start gap-2 rounded-sm py-1 pr-1 pl-2 text-left transition-colors hover:bg-glass-highlight focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary"
          >
            {body}
          </button>
        )}
        <CapAlignedControls height={28} coarseHeight={44} className="mt-1">
          <DropdownMenu
            label={highlight ? "Highlight actions" : "Bookmark actions"}
            // Expanded, the row keeps what was cut, so its menu offers Show less
            onOpenChange={(open) => open && !expanded && measure()}
            align="end"
            trigger={
              <button type="button" className="action-icon-sm">
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
              </button>
            }
          >
            {(expanded || cut) && (
              <DropdownMenuItem onClick={onToggle}>
                {expanded ? "Show less" : cut === "passage" ? "Show the full passage" : "Show the full note"}
              </DropdownMenuItem>
            )}
            {!orphaned && highlight && (
              <DropdownMenuItem onClick={onNote} icon={<NotebookPen className="h-4 w-4" strokeWidth={1.5} />}>
                {item.note ? "Edit note" : "Add a note"}
              </DropdownMenuItem>
            )}
            {!orphaned && highlight && item.style !== "quote" && <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Colour</DropdownMenuLabel>
              {ANNOTATION_COLORS.map((color) => (
                <DropdownMenuItem
                  key={color}
                  checked={item.color === color}
                  onClick={() => onEdit({ color })}
                  icon={<span aria-hidden className="block h-3 w-3 rounded-full border border-glass-border" style={{ backgroundColor: QUIET_GLASS_ANNOTATION_PALETTE.fills[color] }} />}
                >
                  {capital(color)}
                </DropdownMenuItem>
              ))}
            </>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" onClick={onDelete} icon={<Trash2 className="h-4 w-4" strokeWidth={1.5} />}>
              {highlight ? (item.note ? "Delete highlight and note" : "Delete highlight") : "Delete bookmark"}
            </DropdownMenuItem>
          </DropdownMenu>
        </CapAlignedControls>
      </Prose>
    </li>
  );
}

export function AnnotationsPanel({
  open,
  onClose,
  book,
  annotations,
  onPick,
  onNote,
  onEdit,
  onDelete,
  conflictContent,
  imagesOnly = false,
}: {
  conflictContent?: React.ReactNode;
  /** A comic's pages are pictures: there is no text to highlight, only pages to bookmark */
  imagesOnly?: boolean;
  open: boolean;
  onClose(): void;
  book: AnnotationExportBook;
  annotations: readonly ReaderAnnotation[];
  onPick(annotation: ReaderAnnotation): Promise<boolean>;
  onNote(annotation: ReaderAnnotation): void;
  onEdit(annotation: ReaderAnnotation, edit: { color: AnnotationColor }): void;
  onDelete(annotation: ReaderAnnotation): void;
}) {
  const [chosenTab, setTab] = useState<AnnotationTab>("highlights");
  const tab = imagesOnly ? "bookmarks" : chosenTab;
  const [color, setColor] = useState<AnnotationColor | "all">("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"book" | "newest">("book");
  const [expanded, setExpanded] = useState(new Set<string>());
  const counts = useMemo(() => annotationCounts(annotations), [annotations]);
  // Bookmarks have no colour: the colour filter is the highlights' and notes'
  const shownColor = tab === "bookmarks" ? "all" : color;
  const groups = useMemo(
    () => annotationPanelGroups(annotations, { tab, color: shownColor, query, order }),
    [annotations, tab, shownColor, query, order],
  );
  const total = counts.highlights + counts.bookmarks;
  const pick = async (item: ReaderAnnotation) => {
    if (await onPick(item)) onClose();
  };
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ReaderSidePanel open={open} title={imagesOnly ? "Bookmarks" : "Highlights and notes"} onClose={onClose}>
      <div data-reader-widget className="flex flex-col gap-4 px-2">
        {conflictContent}
        {imagesOnly ? (
          <p className="text-sm text-fg-secondary">
            A comic&rsquo;s pages are pictures, so they cannot be highlighted. Bookmarks still work.
          </p>
        ) : <SegmentedControl
          ariaLabel="Annotations"
          fill
          value={tab}
          onChange={setTab}
          options={[
            { value: "highlights", label: "Highlights" },
            { value: "notes", label: "Notes" },
            { value: "bookmarks", label: "Bookmarks" },
          ]}
        />}
        {counts[tab] > 0 && <>
          <input
            type="search"
            {...SEARCH_INPUT_ATTRIBUTES}
            aria-label={imagesOnly ? "Filter bookmarks" : "Filter highlights and notes"}
            // The count rides the field, so the tabs keep to one line in a 320px panel
            placeholder={`Find in ${counts[tab]} ${counts[tab] === 1 ? tab.slice(0, -1) : tab}`}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-10 rounded-sm border border-border-control bg-bg-secondary px-3 text-sm placeholder:text-fg-muted outline-none focus:border-accent-primary focus:glass-input-focus pointer-coarse:h-11"
          />
          <div className="grid grid-cols-2 gap-2">
            {tab !== "bookmarks" && (
              <Select
                ariaLabel="Colour filter"
                value={color}
                onChange={(event) => setColor(event.target.value as AnnotationColor | "all")}
                options={[{ value: "all", label: "Any colour" }, ...ANNOTATION_COLORS.map((item) => ({ value: item, label: capital(item) }))]}
              />
            )}
            <Select
              ariaLabel="Annotation order"
              value={order}
              onChange={(event) => setOrder(event.target.value as "book" | "newest")}
              options={[{ value: "book", label: "Book order" }, { value: "newest", label: "Newest first" }]}
            />
          </div>
        </>}
        {!groups.length && (
          <p className="text-sm text-fg-secondary">
            {counts[tab] === 0 ? EMPTY[tab] : `No ${tab} match.`}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.title}>
            <SectionHeading
              as="h3"
              title={group.title}
              count={group.items.length}
            />
            <ul className="flex flex-col gap-3">
              {group.items.map((item) => (
                <MarkRow
                  key={item.id}
                  item={item}
                  orphaned={!!group.orphaned}
                  expanded={expanded.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  onGo={() => void pick(item)}
                  onNote={() => onNote(item)}
                  onEdit={(edit) => onEdit(item, edit)}
                  onDelete={() => onDelete(item)}
                />
              ))}
            </ul>
          </section>
        ))}
        <div className="flex items-center justify-between gap-3">
          {total > 0 ? <AnnotationExportControls book={book} annotations={annotations} /> : <span />}
          <Link href="/ebooks/highlights" className="text-command text-sm">
            All highlights
          </Link>
        </div>
      </div>
    </ReaderSidePanel>
  );
}
