"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TocItem } from "@/lib/reader/engine";
import type { PositionIndex } from "@/lib/reader/position-index";
import { ReaderSidePanel } from "./side-panel";

interface TreeEntry {
  item: TocItem;
  id: string;
  depth: number;
  parent: string | null;
}
export function ContentsPanel({
  open,
  onClose,
  index,
  current,
  onPick,
}: {
  open: boolean;
  onClose(): void;
  index: PositionIndex;
  current: TocItem | null;
  onPick(href: string): Promise<unknown>;
}) {
  const tree = useMemo(() => {
    const entries: TreeEntry[] = [];
    const walk = (items: TocItem[], depth: number, parent: string | null) => {
      items.forEach((item, at) => {
        const id = (parent ?? "toc") + "-" + at;
        entries.push({ item, id, depth, parent });
        walk(item.subitems, depth + 1, id);
      });
    };
    walk(index.contents, 0, null);
    return entries;
  }, [index]);
  const byId = useMemo(
    () => new Map(tree.map((entry) => [entry.id, entry])),
    [tree],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const active = tree.find((entry) => entry.item.href === current?.href);
  useEffect(() => {
    if (!open) return;
    const next = new Set(
      tree.filter((entry) => entry.depth === 0).map((entry) => entry.id),
    );
    let ancestor = active;
    while (ancestor?.parent) {
      next.add(ancestor.parent);
      ancestor = byId.get(ancestor.parent);
    }
    let scrollFrame = 0;
    // Synchronize the tree with the externally selected chapter before scrolling it.
    const frame = requestAnimationFrame(() => {
      setExpanded(next);
      setFocused(active?.id ?? tree[0]?.id ?? null);
      scrollFrame = requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLElement>('[aria-current="location"]')
          ?.scrollIntoView({ block: "center" }),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
    };
  }, [open, tree, active, byId]);
  const visible = tree.filter((entry) => {
    let parent = entry.parent;
    while (parent) {
      if (!expanded.has(parent)) return false;
      parent = byId.get(parent)?.parent ?? null;
    }
    return true;
  });
  const focus = (entry: TreeEntry | undefined) => {
    if (!entry) return;
    setFocused(entry.id);
    root.current
      ?.querySelector<HTMLElement>('[data-toc-id="' + entry.id + '"]')
      ?.focus();
  };
  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pick = async (href: string) => {
    if (href) {
      const result = await onPick(href);
      if (result !== false) onClose();
    }
  };
  return (
    <ReaderSidePanel open={open} onClose={onClose} title="Contents">
      {index.fallback && (
        <p className="px-2 pb-3 text-sm text-fg-secondary">
          This book has no contents. Sections are listed in reading order.
        </p>
      )}
      <div ref={root} role="tree" aria-label="Contents" data-reader-widget>
        {visible.map((entry, at) => {
          const selected = entry.id === active?.id;
          const group = entry.item.subitems.length > 0;
          const page = index.pageAt(index.fraction(entry.item.href));
          const label = index.info.pageList.length
            ? (page?.label ?? "")
            : Math.round(index.fraction(entry.item.href) * 100) + "%";
          return (
            <div
              key={entry.id}
              role="treeitem"
              aria-level={entry.depth + 1}
              aria-current={selected ? "location" : undefined}
              aria-expanded={group ? expanded.has(entry.id) : undefined}
              tabIndex={focused === entry.id ? 0 : -1}
              data-toc-id={entry.id}
              onFocus={() => setFocused(entry.id)}
              onKeyDown={(event) => {
                if (event.metaKey || event.ctrlKey || event.altKey) return;
                if (
                  [
                    "ArrowUp",
                    "ArrowDown",
                    "ArrowLeft",
                    "ArrowRight",
                    "Home",
                    "End",
                    "Enter",
                    " ",
                  ].includes(event.key)
                )
                  event.preventDefault();
                if (event.key === "ArrowDown") focus(visible[at + 1]);
                if (event.key === "ArrowUp") focus(visible[at - 1]);
                if (event.key === "Home") focus(visible[0]);
                if (event.key === "End") focus(visible.at(-1));
                if (event.key === "ArrowRight" && group) {
                  if (!expanded.has(entry.id)) toggle(entry.id);
                  else focus(visible[at + 1]);
                }
                if (event.key === "ArrowLeft") {
                  if (group && expanded.has(entry.id)) toggle(entry.id);
                  else focus(byId.get(entry.parent ?? ""));
                }
                if (event.key === "Enter" || event.key === " ")
                  void pick(entry.item.href);
              }}
              className={
                "relative flex min-h-9 items-center gap-2 rounded-sm py-1 pr-2 text-sm outline-none hover:bg-bg-tertiary/50 focus-visible:bg-bg-tertiary pointer-coarse:min-h-11 " +
                (selected ? "text-fg-primary" : "text-fg-secondary")
              }
              style={{
                paddingLeft: 8 + entry.depth * 16,
                contentVisibility: "auto",
                containIntrinsicSize: "auto 44px",
              }}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-0 w-0.5 bg-accent-primary"
                />
              )}
              {group ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={
                    (expanded.has(entry.id) ? "Collapse " : "Expand ") +
                    entry.item.label
                  }
                  aria-expanded={expanded.has(entry.id)}
                  data-tooltip={expanded.has(entry.id) ? "Collapse" : "Expand"}
                  onClick={() => toggle(entry.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm pointer-coarse:h-11 pointer-coarse:w-11"
                >
                  <ChevronRight
                    className={
                      "h-3.5 w-3.5 " +
                      (expanded.has(entry.id) ? "rotate-90" : "")
                    }
                    strokeWidth={1.5}
                  />
                </button>
              ) : (
                <span
                  aria-hidden
                  className="w-6 shrink-0 pointer-coarse:w-11"
                />
              )}
              <button
                type="button"
                tabIndex={-1}
                disabled={!entry.item.href}
                onClick={() => void pick(entry.item.href)}
                className="min-w-0 flex-1 text-left pointer-coarse:min-h-11"
              >
                <span className="lines-2">{entry.item.label}</span>
              </button>
              <span className="shrink-0 text-xs tabular-nums">{label}</span>
            </div>
          );
        })}
      </div>
    </ReaderSidePanel>
  );
}
