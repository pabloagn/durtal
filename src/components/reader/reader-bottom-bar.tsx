"use client";

/**
 * The reader's bottom bar (eBooks sub-issue 3): the chapter and how far
 * through the book. Shows and hides with the top bar; hidden, it is inert.
 */
export function ReaderBottomBar({
  visible,
  chapter,
  percent,
}: {
  visible: boolean;
  chapter: string | null;
  /** 0 to 100, or null before the book has opened */
  percent: number | null;
}) {
  return (
    <footer
      data-reader-chrome
      inert={!visible}
      className={`glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-glass-border pb-[env(safe-area-inset-bottom)] transition-[opacity,translate] duration-200 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="flex h-10 items-center gap-4 px-4 text-sm text-fg-secondary">
        <p className="min-w-0 flex-1 truncate">{chapter}</p>
        {percent !== null && <p className="shrink-0 tabular-nums">{percent}%</p>}
      </div>
    </footer>
  );
}
