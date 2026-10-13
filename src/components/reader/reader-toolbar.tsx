"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Check,
  ListTree,
  Maximize,
  Minimize,
  MoreHorizontal,
  Type,
  CircleHelp,
  Search,
  SunMoon,
  Moon,
  Sun,
  Sunset,
} from "lucide-react";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import { OutsideTapBackdrop } from "./outside-tap-backdrop";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  READER_BAR_BUTTON,
  ReaderBarItem,
  ReaderBarMenuItems,
  watchReaderPointer,
} from "./reader-bar-item";
import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

type ReaderThemeId = ReaderPresentation["theme"];
const READER_THEME_CHOICES = [
  { id: "durtal-dark", label: "Dark page", icon: Moon },
  { id: "paper", label: "Light page", icon: Sun },
  { id: "sepia", label: "Sepia page", icon: Sunset },
] as const satisfies readonly { id: ReaderThemeId; label: string; icon: unknown }[];

/** Below this width the bar keeps its main controls and moves the rest into More */
const COMPACT_QUERY = "(max-width: 639.98px)";
const subscribeCompact = (change: () => void) => {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const compactNow = () => window.matchMedia(COMPACT_QUERY).matches;

/** Dark, light and sepia pages, one tap away in the bar */
function ThemeMenu({
  theme,
  onTheme,
  open,
  onOpenChange,
}: {
  theme: ReaderThemeId;
  onTheme(theme: ReaderThemeId): void;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <CapAlignedControls height={32} coarseHeight={44}>
      <DropdownMenu
        label="Page colour"
        open={open}
        onOpenChange={onOpenChange}
        trigger={
          <button type="button" data-tooltip-side="bottom" className={READER_BAR_BUTTON}>
            <SunMoon className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      >
        <ThemeItems theme={theme} onTheme={onTheme} />
      </DropdownMenu>
    </CapAlignedControls>
  );
}

function ThemeItems({
  theme,
  onTheme,
}: {
  theme: ReaderThemeId;
  onTheme(theme: ReaderThemeId): void;
}) {
  return (
    <>
      {READER_THEME_CHOICES.map((choice) => (
        <DropdownMenuItem
          key={choice.id}
          checked={choice.id === theme}
          icon={<choice.icon className="h-4 w-4" strokeWidth={1.5} />}
          shortcut={choice.id === theme ? <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : undefined}
          onClick={() => onTheme(choice.id)}
        >
          {choice.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * The reader's top bar (eBooks sub-issue 3): Back, the title and the
 * current chapter, Contents, Settings and, where the browser has it, Full
 * screen. Hidden with the bottom bar while reading; hidden, it is inert.
 * At phone width it keeps Back, the title, Contents, the bookmark and
 * Settings, and moves every other control into a More menu, so nothing runs
 * off the screen.
 */
export function ReaderToolbar({
  visible,
  title,
  chapter,
  backHref,
  onBack,
  onContents,
  onSettings,
  onSearch,
  fullscreen,
  onFullscreen,
  onShortcuts,
  offlineAction,
  speechControl,
  bookmarkAction,
  annotationActions,
  fixedControls,
  theme,
  onTheme,
  onMenuChange,
}: {
  visible: boolean;
  title: string;
  chapter: string | null;
  backHref: string;
  onBack: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onContents: () => void;
  onSettings: () => void;
  onSearch?: () => void;
  /** Null where the Fullscreen API is missing (iPhone) */
  fullscreen: boolean | null;
  onFullscreen: () => void;
  onShortcuts?: () => void;
  offlineAction?: React.ReactNode;
  speechControl?: React.ReactNode;
  /** Stays in the bar at every width */
  bookmarkAction?: React.ReactNode;
  annotationActions?: React.ReactNode;
  /** Zoom and fit for fixed-layout books; stays in the bar at every width */
  fixedControls?: React.ReactNode;
  theme?: ReaderThemeId;
  onTheme?(theme: ReaderThemeId): void;
  /** A menu of the bar is open: the bars stay while it is */
  onMenuChange?(open: boolean): void;
}) {
  const compact = useSyncExternalStore(subscribeCompact, compactNow, () => false);
  const [menu, setMenuState] = useState<"more" | "theme" | null>(null);
  const setMenu = (next: "more" | "theme" | null) => {
    setMenuState(next);
    onMenuChange?.(next !== null);
  };
  useEffect(watchReaderPointer, []);
  // A hidden bar, or a change of layout, closes its menu
  useEffect(() => {
    setMenuState(null);
    onMenuChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  const contents = (
    <ReaderBarItem
      label="Contents"
      keys="t"
      icon={<ListTree className="h-4 w-4" strokeWidth={1.5} />}
      onSelect={onContents}
    />
  );
  const settings = (
    <ReaderBarItem
      label="Settings"
      keys="s"
      icon={<Type className="h-4 w-4" strokeWidth={1.5} />}
      onSelect={onSettings}
    />
  );
  const search = onSearch && (
    <ReaderBarItem
      label="Search in book"
      keys="/"
      icon={<Search className="h-4 w-4" strokeWidth={1.5} />}
      onSelect={onSearch}
    />
  );
  const shortcuts = onShortcuts && (
    <ReaderBarItem
      label="Reader shortcuts"
      keys="?"
      icon={<CircleHelp className="h-4 w-4" strokeWidth={1.5} />}
      onSelect={onShortcuts}
    />
  );
  const full = fullscreen !== null && (
    <ReaderBarItem
      label={fullscreen ? "Leave full screen" : "Full screen"}
      keys="f"
      icon={
        fullscreen ? (
          <Minimize className="h-4 w-4" strokeWidth={1.5} />
        ) : (
          <Maximize className="h-4 w-4" strokeWidth={1.5} />
        )
      }
      onSelect={onFullscreen}
    />
  );

  return (
    <header
      data-reader-top-bar
      data-reader-chrome
      inert={!visible}
      className={`glass-bar fixed inset-x-0 top-0 z-30 border-b border-glass-border pt-[env(safe-area-inset-top)] transition-opacity duration-150 motion-reduce:transition-none ${
        visible ? "" : "pointer-events-none opacity-0"
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
              className={READER_BAR_BUTTON}
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
          {compact ? (
            <div className="flex shrink-0 gap-1">
              {fixedControls}
              {contents}
              {bookmarkAction}
              {settings}
              <CapAlignedControls height={32} coarseHeight={44}>
                <DropdownMenu
                  label="More"
                  open={menu === "more"}
                  onOpenChange={(open) => setMenu(open ? "more" : null)}
                  trigger={
                    <button type="button" data-tooltip-side="bottom" className={READER_BAR_BUTTON}>
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  }
                >
                  <ReaderBarMenuItems>
                    {speechControl}
                    {search}
                    {annotationActions}
                    {offlineAction}
                    {full}
                    {shortcuts}
                    {theme && onTheme && (
                      <>
                        <DropdownMenuSeparator />
                        <ThemeItems theme={theme} onTheme={onTheme} />
                      </>
                    )}
                  </ReaderBarMenuItems>
                </DropdownMenu>
              </CapAlignedControls>
            </div>
          ) : (
            <div className="flex shrink-0 gap-1">
              {offlineAction}
              {speechControl}
              {bookmarkAction}
              {annotationActions}
              {fixedControls}
              {contents}
              {search}
              {theme && onTheme && (
                <ThemeMenu
                  theme={theme}
                  onTheme={onTheme}
                  open={menu === "theme"}
                  onOpenChange={(open) => setMenu(open ? "theme" : null)}
                />
              )}
              {settings}
              {shortcuts}
              {full}
            </div>
          )}
        </div>
      </div>
      <OutsideTapBackdrop kind="menu" open={menu !== null} onClose={() => setMenu(null)} />
    </header>
  );
}
