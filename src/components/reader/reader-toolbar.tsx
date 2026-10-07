"use client";

import { ArrowLeft, ListTree, Maximize, Minimize, Type } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

/** A 16px icon in a 32px button, 44px on touch */
const ICON_BUTTON =
  "block rounded-sm p-2 text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:p-3.5";

function BarButton({
  label,
  keys,
  onClick,
  children,
}: {
  label: string;
  keys: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <CapAligned height={32} coarseHeight={44}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        data-tooltip={label}
        data-tooltip-keys={keys}
        data-tooltip-side="bottom"
        className={ICON_BUTTON}
      >
        {children}
      </button>
    </CapAligned>
  );
}

/**
 * The reader's top bar (eBooks sub-issue 3): Back, the title and the
 * current chapter, Contents, Settings and, where the browser has it, Full
 * screen. Hidden with the bottom bar while reading; hidden, it is inert.
 */
export function ReaderToolbar({
  visible,
  title,
  chapter,
  backHref,
  onBack,
  onContents,
  onSettings,
  fullscreen,
  onFullscreen,
}: {
  visible: boolean;
  title: string;
  chapter: string | null;
  backHref: string;
  onBack: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onContents: () => void;
  onSettings: () => void;
  /** Null where the Fullscreen API is missing (iPhone) */
  fullscreen: boolean | null;
  onFullscreen: () => void;
}) {
  return (
    <header
      data-reader-chrome
      inert={!visible}
      className={`glass-bar fixed inset-x-0 top-0 z-30 border-b border-glass-border pt-[env(safe-area-inset-top)] transition-[opacity,translate] duration-200 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none -translate-y-full opacity-0"
      }`}
    >
      {/* The row carries the title's type: the buttons sit on its cap-height center. On
          touch it is taller, so the 44px buttons stay inside the bar, which clips */}
      <div className="type-item-title flex h-12 items-center px-2 pointer-coarse:h-14">
        <div className="flex w-full min-w-0 items-start gap-1">
          <CapAligned height={32} coarseHeight={44}>
            <a
              href={backHref}
              onClick={onBack}
              aria-label="Back"
              data-tooltip="Back"
              data-tooltip-side="bottom"
              className={ICON_BUTTON}
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            </a>
          </CapAligned>
          <div className="flex min-w-0 flex-1 items-baseline gap-3 px-1">
            <h1 className="min-w-0 truncate">{title}</h1>
            {chapter && (
              <p className="hidden min-w-0 flex-1 basis-0 truncate font-sans text-sm text-fg-secondary md:block">
                {chapter}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-1">
            <BarButton label="Contents" keys="t" onClick={onContents}>
              <ListTree className="h-4 w-4" strokeWidth={1.5} />
            </BarButton>
            <BarButton label="Settings" keys="s" onClick={onSettings}>
              <Type className="h-4 w-4" strokeWidth={1.5} />
            </BarButton>
            {fullscreen !== null && (
              <BarButton label={fullscreen ? "Leave full screen" : "Full screen"} keys="f" onClick={onFullscreen}>
                {fullscreen ? (
                  <Minimize className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <Maximize className="h-4 w-4" strokeWidth={1.5} />
                )}
              </BarButton>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
