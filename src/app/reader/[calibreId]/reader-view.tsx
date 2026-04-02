"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import type { NavItem } from "epubjs";
import type { EpubReaderHandle } from "@/components/reader/epub-reader";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { ReaderToc } from "@/components/reader/reader-toc";
import { ReaderSettings } from "@/components/reader/reader-settings";
import { ReaderProgressBar } from "@/components/reader/reader-progress-bar";
import { useReaderSettings } from "@/hooks/use-reader-settings";

// Dynamic import — epub.js must not run on the server
const EpubReader = dynamic(
  () =>
    import("@/components/reader/epub-reader").then((m) => ({
      default: m.EpubReader,
    })),
  { ssr: false },
);

interface ReaderViewProps {
  bookUrl: string;
  title: string;
  author: string;
  calibreId: number;
  initialCfi: string | null;
  initialProgress: number;
  initialChapter: string;
  format: string;
}

export function ReaderView({
  bookUrl,
  title,
  author,
  calibreId,
  initialCfi,
  initialProgress,
  initialChapter,
  format,
}: ReaderViewProps) {
  const epubHandle = useRef<EpubReaderHandle | null>(null);
  const { settings, setSettings, resetSettings } = useReaderSettings();

  const [toc, setToc] = useState<NavItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [progress, setProgress] = useState(initialProgress);
  const [chapter, setChapter] = useState(initialChapter);

  // Debounced progress save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ cfi: string; prog: number; ch: string } | null>(null);

  const flushProgressSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    navigator.sendBeacon(
      `/api/reader/${calibreId}/progress`,
      new Blob(
        [JSON.stringify({
          cfi: pending.cfi,
          progressPercent: pending.prog,
          currentChapter: pending.ch || undefined,
        })],
        { type: "application/json" },
      ),
    );
  }, [calibreId]);

  const handleLocationChange = useCallback(
    (cfi: string, prog: number, ch: string) => {
      setProgress(prog);
      if (ch) setChapter(ch);
      pendingSaveRef.current = { cfi, prog, ch };

      // Debounce save: 3 seconds
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        pendingSaveRef.current = null;
        fetch(`/api/reader/${calibreId}/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cfi,
            progressPercent: prog,
            currentChapter: ch || undefined,
          }),
        }).catch(() => {});
      }, 3000);
    },
    [calibreId],
  );

  // Flush pending save on unmount or page unload
  useEffect(() => {
    const handleBeforeUnload = () => flushProgressSave();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushProgressSave();
    };
  }, [flushProgressSave]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if a panel is open and it's not a panel-toggle key
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "ArrowRight":
        case " ":
          e.preventDefault();
          epubHandle.current?.nextPage();
          break;
        case "ArrowLeft":
          e.preventDefault();
          epubHandle.current?.prevPage();
          break;
        case "t":
          if (!settingsOpen) setTocOpen((prev) => !prev);
          break;
        case "s":
          if (!tocOpen) setSettingsOpen((prev) => !prev);
          break;
        case "f":
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
          break;
        case "Escape":
          if (tocOpen) setTocOpen(false);
          else if (settingsOpen) setSettingsOpen(false);
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [tocOpen, settingsOpen]);

  // Click zones for page navigation
  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      if (tocOpen || settingsOpen) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;

      if (x < 0.25) {
        epubHandle.current?.prevPage();
      } else if (x > 0.75) {
        epubHandle.current?.nextPage();
      } else {
        // Center click: toggle chrome
        setChromeVisible((prev) => !prev);
      }
    },
    [tocOpen, settingsOpen],
  );

  const handleTocNavigate = useCallback(
    (href: string) => {
      epubHandle.current?.goToChapter(href);
      setTocOpen(false);
    },
    [],
  );

  if (format !== "epub") {
    // PDF fallback — simple embed for now
    return (
      <div className="flex h-dvh flex-col bg-bg-primary">
        <ReaderToolbar
          title={title}
          author={author}
          chapter=""
          onToggleToc={() => {}}
          onToggleSettings={() => {}}
        />
        <div className="flex-1 pt-12">
          <iframe
            src={bookUrl}
            className="h-full w-full border-none"
            title={title}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg-primary">
      {/* Toolbar */}
      <ReaderToolbar
        title={title}
        author={author}
        chapter={chapter}
        onToggleToc={() => setTocOpen((prev) => !prev)}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
      />

      {/* Table of Contents */}
      <ReaderToc
        toc={toc}
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        onNavigate={handleTocNavigate}
      />

      {/* Settings */}
      <ReaderSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
        onReset={resetSettings}
      />

      {/* Reader content area — click zones for navigation */}
      <div
        className="h-full w-full cursor-default"
        style={{
          padding: `48px ${settings.margin}% 40px`,
        }}
        onClick={handleContentClick}
      >
        <EpubReader
          bookUrl={bookUrl}
          initialCfi={initialCfi}
          settings={settings}
          onLocationChange={handleLocationChange}
          onTocLoaded={setToc}
          handleRef={epubHandle}
        />
      </div>

      {/* Progress bar */}
      <ReaderProgressBar
        progress={progress}
        chapter={chapter}
        visible={chromeVisible}
      />
    </div>
  );
}
