"use client";
import { buttonClass } from "@/components/ui/button";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Prose } from "@/components/shared/prose";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { SectionHeading } from "@/components/shared/section-heading";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ReaderSidePanel } from "./side-panel";
import { AnnotationSwatches } from "./annotation-swatches";
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

export function AnnotationsPanel({
  open,
  onClose,
  book,
  annotations,
  onPick,
  onNote,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onClose(): void;
  book: AnnotationExportBook;
  annotations: readonly ReaderAnnotation[];
  onPick(annotation: ReaderAnnotation): Promise<boolean>;
  onNote(annotation: ReaderAnnotation): void;
  onEdit(annotation: ReaderAnnotation, edit: { color: AnnotationColor }): void;
  onDelete(annotation: ReaderAnnotation): void;
}) {
  const [tab, setTab] = useState<AnnotationTab>("highlights");
  const [color, setColor] = useState<AnnotationColor | "all">("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"book" | "newest">("book");
  const [expanded, setExpanded] = useState(new Set<string>());
  const counts = useMemo(() => annotationCounts(annotations), [annotations]);
  const groups = useMemo(
    () => annotationPanelGroups(annotations, { tab, color, query, order }),
    [annotations, tab, color, query, order],
  );
  const pick = async (item: ReaderAnnotation) => {
    if (await onPick(item)) onClose();
  };
  return (
    <ReaderSidePanel open={open} title="Highlights and notes" onClose={onClose}>
      <div data-reader-widget className="flex flex-col gap-4 px-2">
        <SegmentedControl
          ariaLabel="Annotations"
          value={tab}
          onChange={setTab}
          options={[
            { value: "highlights", label: `Highlights (${counts.highlights})` },
            { value: "notes", label: `Notes (${counts.notes})` },
            { value: "bookmarks", label: `Bookmarks (${counts.bookmarks})` },
          ]}
        />
        <input
          type="search"
          aria-label="Filter highlights and notes"
          placeholder="Find text or a note"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          className="h-10 rounded-sm border border-border-primary bg-bg-secondary px-3 text-sm outline-none focus:border-accent-primary pointer-coarse:h-11"
        />
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Colour filter"
            value={color}
            onChange={(event) =>
              setColor(event.currentTarget.value as AnnotationColor | "all")
            }
            className="h-8 min-w-0 rounded-sm border border-glass-border bg-bg-secondary px-2 text-sm pointer-coarse:h-11"
          >
            <option value="all">Every colour</option>
            {ANNOTATION_COLORS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            aria-label="Annotation order"
            value={order}
            onChange={(event) =>
              setOrder(event.currentTarget.value as "book" | "newest")
            }
            className="h-8 min-w-0 rounded-sm border border-glass-border bg-bg-secondary px-2 text-sm pointer-coarse:h-11"
          >
            <option value="book">Book order</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
        {!groups.length && (
          <p className="text-sm text-fg-secondary">No {tab} match.</p>
        )}
        {groups.map((group) => (
          <section key={group.title}>
            <SectionHeading
              as="h3"
              title={group.title}
              count={group.items.length}
            />
            <ul className="flex flex-col gap-4">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="border-b border-glass-border pb-4 [content-visibility:auto] [contain-intrinsic-size:auto_160px]"
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-1 block h-3 w-1 shrink-0 rounded-sm"
                      style={{
                        backgroundColor:
                          item.style === "quote"
                            ? QUIET_GLASS_ANNOTATION_PALETTE.quote
                            : item.color
                              ? QUIET_GLASS_ANNOTATION_PALETTE.fills[item.color]
                              : QUIET_GLASS_ANNOTATION_PALETTE.quote,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <Prose>
                        <p
                          className={`whitespace-pre-wrap break-words text-fg-primary ${expanded.has(item.id) ? "" : "line-clamp-3"}`}
                        >
                          {item.text ??
                            item.locator.text?.highlight
                              ?.trim()
                              .split(/\s+/)
                              .slice(0, 8)
                              .join(" ") ??
                            "Bookmark"}
                        </p>
                      </Prose>
                      {item.note && (
                        <Prose className="mt-2 text-fg-secondary">
                          <p className="whitespace-pre-wrap break-words">
                            {item.note}
                          </p>
                        </Prose>
                      )}
                      <p className="mt-2 text-xs text-fg-secondary">
                        {item.locator.pageLabel
                          ? `p. ${item.locator.pageLabel}`
                          : `${Math.round(item.progression * 100)}%`}{" "}
                        · {new Date(item.updatedAt).toLocaleDateString()}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {!group.orphaned && (
                          <button
                            type="button"
                            className={buttonClass("ghost", "sm")}
                            onClick={() => void pick(item)}
                          >
                            Go to mark
                          </button>
                        )}
                        {item.text && (
                          <button
                            type="button"
                            className={buttonClass("ghost", "sm")}
                            aria-expanded={expanded.has(item.id)}
                            onClick={() =>
                              setExpanded((current) => {
                                const next = new Set(current);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                            }
                          >
                            {expanded.has(item.id)
                              ? "Collapse"
                              : "Show full text"}
                          </button>
                        )}
                        {!group.orphaned && item.kind === "highlight" && (
                          <details>
                            <summary
                              className={
                                buttonClass("ghost", "sm") + " cursor-pointer"
                              }
                            >
                              Edit
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={buttonClass("ghost", "sm")}
                                onClick={() => onNote(item)}
                              >
                                Edit note
                              </button>
                              {item.style !== "quote" && (
                                <AnnotationSwatches
                                  color={item.color}
                                  onPick={(value) =>
                                    onEdit(item, { color: value })
                                  }
                                />
                              )}
                            </div>
                          </details>
                        )}
                        <button
                          type="button"
                          className={buttonClass("danger", "sm")}
                          onClick={() => onDelete(item)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <AnnotationExportControls book={book} annotations={annotations} />
        <Link
          href="/ebooks/highlights"
          className="text-sm text-accent-primary hover:underline"
        >
          All highlights
        </Link>
      </div>
    </ReaderSidePanel>
  );
}
