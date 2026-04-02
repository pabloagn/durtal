"use client";

interface ReaderProgressBarProps {
  progress: number; // 0-1
  chapter: string;
  visible: boolean;
}

export function ReaderProgressBar({
  progress,
  chapter,
  visible,
}: ReaderProgressBarProps) {
  const percent = Math.round(progress * 100);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 transition-all duration-300 ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-3 bg-bg-primary/90 px-4 py-2 backdrop-blur-sm border-t border-glass-border">
        {/* Progress bar */}
        <div className="flex-1 h-0.5 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-rose transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Info */}
        <div className="flex items-center gap-2 shrink-0">
          {chapter && (
            <span className="text-micro text-fg-muted truncate max-w-40">
              {chapter}
            </span>
          )}
          <span className="font-mono text-micro text-fg-secondary">
            {percent}%
          </span>
        </div>
      </div>
    </div>
  );
}
