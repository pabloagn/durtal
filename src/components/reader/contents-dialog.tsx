"use client";

import { Dialog } from "@/components/ui/dialog";
import type { TocItem } from "@/lib/reader/engine";

function TocList({ items, depth, onPick }: { items: TocItem[]; depth: number; onPick: (href: string) => void }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {items.map((item, at) => (
        <li key={`${item.href}-${at}`}>
          {item.href ? (
            <button
              type="button"
              onClick={() => onPick(item.href)}
              className="block w-full rounded-sm py-1.5 pr-2 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:min-h-11 pointer-coarse:py-3"
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              {item.label}
            </button>
          ) : (
            <p className="py-1.5 pr-2 text-sm text-fg-secondary" style={{ paddingLeft: 8 + depth * 16 }}>
              {item.label}
            </p>
          )}
          {item.subitems.length > 0 && <TocList items={item.subitems} depth={depth + 1} onPick={onPick} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * The book's table of contents, nested as the book gives it (eBooks
 * sub-issue 3); choosing an entry goes there and closes the dialog.
 */
export function ContentsDialog({
  open,
  onClose,
  toc,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  toc: TocItem[];
  onPick: (href: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Contents" className="max-w-lg" expandable={false}>
      {toc.length ? (
        <nav aria-label="Table of contents" className="-mx-2">
          <TocList items={toc} depth={0} onPick={onPick} />
        </nav>
      ) : (
        <p className="text-sm text-fg-secondary">This book has no table of contents.</p>
      )}
    </Dialog>
  );
}
