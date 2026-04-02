"use client";

import type { NavItem } from "epubjs";

interface ReaderTocProps {
  toc: NavItem[];
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
}

export function ReaderToc({ toc, open, onClose, onNavigate }: ReaderTocProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-bg-primary/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed left-0 top-0 z-50 flex h-dvh w-80 flex-col border-r border-glass-border bg-bg-secondary">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-glass-border px-4">
          <h2 className="font-serif text-sm text-fg-primary">
            Table of Contents
          </h2>
          <button
            onClick={onClose}
            className="text-micro text-fg-muted transition-colors hover:text-fg-primary"
          >
            ESC
          </button>
        </div>

        {/* TOC tree */}
        <nav className="flex-1 overflow-y-auto p-3">
          <TocTree items={toc} onNavigate={onNavigate} depth={0} />
        </nav>
      </div>
    </>
  );
}

function TocTree({
  items,
  onNavigate,
  depth,
}: {
  items: NavItem[];
  onNavigate: (href: string) => void;
  depth: number;
}) {
  return (
    <ul className={depth > 0 ? "ml-3 border-l border-glass-border pl-2" : ""}>
      {items.map((item, i) => (
        <li key={`${item.href}-${i}`}>
          <button
            onClick={() => item.href && onNavigate(item.href)}
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-accent-plum/40 hover:text-fg-primary"
          >
            {item.label?.trim()}
          </button>
          {item.subitems && item.subitems.length > 0 && (
            <TocTree
              items={item.subitems}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
