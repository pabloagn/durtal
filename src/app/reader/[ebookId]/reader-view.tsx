"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { ContentsDialog } from "@/components/reader/contents-dialog";
import { OpenError } from "@/components/reader/open-error";
import { ReaderBottomBar } from "@/components/reader/reader-bottom-bar";
import { ReaderShell, useReaderBars } from "@/components/reader/reader-shell";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SettingsDialog } from "@/components/reader/settings-dialog";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { READER_PAGE_RE } from "@/lib/reader/csp";
import type { BookSource, DurtalLocator, Prefetched, ReaderEngine, ReaderFormat, TocItem } from "@/lib/reader/engine";
import { readerFontFaces } from "@/lib/reader/fonts";
import { PREFETCH_GLOBAL } from "@/lib/reader/first-range";
import { createReaderInput, type ReaderActions } from "@/lib/reader/input";
import { createPositionQueue } from "@/lib/reader/position-queue";
import { preloadFoliate } from "@/lib/reader/engines/foliate/preload";
import { presentationFrom, resolveThemeColors } from "@/lib/reader/presentation";

export interface ReaderViewFile {
  id: string;
  format: ReaderFormat;
  size: number;
  sha256: string;
  /** A signed CDN URL, or the app route */
  url: string;
  expiresAt: string | null;
  fallbackUrl: string;
  cdOffset: number | null;
}

/** A book that has not opened by then shows the error, never an endless wait */
const OPEN_TIMEOUT_MS = 30_000;

type Status = { kind: "opening" } | { kind: "ready" } | { kind: "error"; message: string };

/** The first range the page's inline script started for this file, taken once */
function takePrefetch(fileId: string): Promise<Prefetched[]> | undefined {
  const store = (window as unknown as Record<string, Record<string, Promise<Prefetched[]>> | undefined>)[PREFETCH_GLOBAL];
  const prefetch = store?.[fileId];
  if (store) delete store[fileId];
  return prefetch;
}

/** Whether this document loaded as a reader page, with the reader's content policy */
function loadedAsReaderPage(): boolean {
  const entry = performance.getEntriesByType?.("navigation")[0];
  if (!entry) return true;
  try {
    return READER_PAGE_RE.test(new URL(entry.name).pathname);
  } catch {
    return true;
  }
}

/** Two places are the same when they point at the same spot of the same file */
function samePlace(a: DurtalLocator | null, b: DurtalLocator | null): boolean {
  if (!a || !b || a.fileHash !== b.fileHash) return false;
  if (a.cfi || b.cfi) return a.cfi === b.cfi;
  if (a.pdf || b.pdf) return a.pdf?.page === b.pdf?.page;
  return a.sectionIndex === b.sectionIndex && Math.abs(a.totalProgression - b.totalProgression) < 1e-6;
}

const isBlocked = () => !!document.querySelector("dialog[open], [cmdk-root]");

/**
 * The reading view (eBooks sub-issue 3): the engine in the page, the input
 * layer on every document, the bars, Contents and Settings, and this
 * device's place saved as the reader goes.
 */
export function ReaderView({
  ebook,
  file,
  alternatives,
  place,
  backHref,
}: {
  ebook: { id: string; title: string; authors: string[] };
  file: ReaderViewFile | null;
  alternatives: { id: string; label: string }[];
  place: DurtalLocator | null;
  backHref: string;
  /** Each reader plug-in's data, by id (none yet) */
  plugins: Record<string, unknown>;
}) {
  // The engine's code starts downloading as the view first renders, not after it mounts
  if (typeof window !== "undefined" && file) void preloadFoliate(file.format);
  const { settings, setSettings, resetSettings } = useReaderSettings();
  const bookRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const [status, setStatus] = useState<Status>(
    file ? { kind: "opening" } : { kind: "error", message: "This eBook has no file the reader can open." },
  );
  const [attempt, setAttempt] = useState(0);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [chapter, setChapter] = useState<string | null>(place?.tocLabel ?? null);
  const [percent, setPercent] = useState<number | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState<boolean | null>(null);
  const bars = useReaderBars({ held: contentsOpen || settingsOpen || status.kind !== "ready" });

  // The book's look: the settings, the theme's colours and the reader's own fonts
  const presentation = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : presentationFrom(settings, resolveThemeColors(), readerFontFaces(window.location.origin)),
    [settings],
  );
  const presentationRef = useRef(presentation);
  useEffect(() => {
    presentationRef.current = presentation;
    if (presentation) engineRef.current?.setPresentation(presentation);
  }, [presentation]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen({ navigationUI: "hide" });
    void request.catch(() => {});
  }, []);

  // What the input layer does, read at the moment of each input
  const actions = useRef<ReaderActions | null>(null);
  useEffect(() => {
    actions.current = {
      next: () => void engineRef.current?.next(),
      prev: () => void engineRef.current?.prev(),
      left: () => void engineRef.current?.goLeft(),
      right: () => void engineRef.current?.goRight(),
      first: () => void engineRef.current?.goTo({ fraction: 0 }),
      last: () => void engineRef.current?.goTo({ fraction: 1 }),
      toggleBars: bars.toggle,
      contents: () => setContentsOpen(true),
      settings: () => setSettingsOpen(true),
      fullscreen: toggleFullscreen,
      escape: () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      },
      activity: (kind) => {
        if (kind === "turn") bars.hide();
      },
      pointer: (_x, y) => bars.pointerAt(y),
    };
  });

  // Full screen only where the API exists (never on iPhone, where it throws)
  useEffect(() => {
    if (!document.fullscreenEnabled) return;
    const update = () => setFullscreen(!!document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  // Tab brings the hidden bars back before focus moves, so focus can go into them
  const visibleRef = bars.visibleRef;
  const showBars = bars.show;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab" && !visibleRef.current) flushSync(showBars);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [visibleRef, showBars]);

  // The book: the engine, the input layer, the place
  useEffect(() => {
    const container = bookRef.current;
    if (!file || !container) return;
    // Arrived by a client-side navigation: load again, so the reader's content policy applies
    if (!loadedAsReaderPage()) {
      window.location.replace(window.location.href);
      return;
    }
    let cancelled = false;
    let engine: ReaderEngine | null = null;
    let opened = false;
    let reported = false;
    setStatus({ kind: "opening" });

    const input = createReaderInput({
      actions: {
        next: () => actions.current?.next(),
        prev: () => actions.current?.prev(),
        left: () => actions.current?.left(),
        right: () => actions.current?.right(),
        first: () => actions.current?.first(),
        last: () => actions.current?.last(),
        toggleBars: () => actions.current?.toggleBars(),
        contents: () => actions.current?.contents(),
        settings: () => actions.current?.settings(),
        fullscreen: () => actions.current?.fullscreen(),
        escape: () => actions.current?.escape(),
        activity: (kind) => actions.current?.activity?.(kind),
        pointer: (x, y) => actions.current?.pointer?.(x, y),
      },
      isBlocked,
      hasSelection: () => !!engine?.locatorFromSelection(),
    });
    input.attach(document);

    const queue = createPositionQueue({ url: `/api/reader/${ebook.id}/position` });
    let saved: DurtalLocator | null = place;
    const save = (locator: DurtalLocator, chapterLabel: string | null) => {
      if (samePlace(locator, saved)) return;
      saved = locator;
      queue.push({ fileId: file.id, locator, chapter: chapterLabel, clientUpdatedAt: new Date().toISOString() });
    };

    const timeout = setTimeout(() => {
      if (opened || cancelled) return;
      cancelled = true;
      engine?.destroy();
      setStatus({ kind: "error", message: "The file took too long to download. Check the connection." });
    }, OPEN_TIMEOUT_MS);

    void (async () => {
      try {
        const { createFoliateEngine } = await import("@/lib/reader/engines/foliate/engine");
        if (cancelled) return;
        engine = createFoliateEngine();
        engineRef.current = engine;
        let latest: { locator: DurtalLocator; chapter: string | null } | null = null;
        engine.on("error", ({ message }) => {
          reported = true;
          setStatus({ kind: "error", message });
        });
        engine.on("ready", (info) => setToc(info.toc));
        engine.on("document", ({ doc }) => input.attach(doc));
        engine.on("relocate", ({ locator, chapter: label }) => {
          latest = { locator, chapter: label };
          setChapter(label);
          setPercent(Math.round(locator.totalProgression * 100));
          // The landing on open is not a new place; every move after it is
          if (opened) save(locator, label);
        });
        const source: BookSource = {
          ebookId: ebook.id,
          fileId: file.id,
          format: file.format,
          size: file.size,
          sha256: file.sha256,
          url: file.url,
          fallbackUrl: file.fallbackUrl,
          cdOffset: file.cdOffset,
          prefetch: takePrefetch(file.id),
          refreshUrl: async () => {
            const res = await fetch(`/api/ebooks/files/${file.id}/url`, { cache: "no-store" });
            if (!res.ok) throw new Error(`The file's URL could not be renewed (${res.status})`);
            return ((await res.json()) as { url: string }).url;
          },
        };
        const { resolved } = await engine.open(source, {
          container,
          presentation: presentationRef.current!,
          at: place ?? undefined,
        });
        if (cancelled) return;
        opened = true;
        clearTimeout(timeout);
        setStatus({ kind: "ready" });
        if (place && (!resolved || resolved.status === "failed")) {
          toast("Your place in this book could not be found, so it opens at the start.");
        }
        // A first open, or a place found again another way: save where the book opened
        const landing = latest as { locator: DurtalLocator; chapter: string | null } | null;
        if (landing && (!place || resolved?.status !== "exact")) save(landing.locator, landing.chapter);
      } catch {
        if (cancelled) return;
        clearTimeout(timeout);
        // The engine says what kind of failure it was; this is for the rest
        if (!reported) setStatus({ kind: "error", message: "The file is damaged or not a valid eBook." });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      queue.destroy();
      input.destroy();
      engine?.destroy();
      engineRef.current = null;
    };
    // A new file or a retry opens the book again; the place is read once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, attempt]);

  const pick = useCallback(
    (href: string) => {
      setContentsOpen(false);
      void engineRef.current?.goTo({ href });
    },
    [],
  );

  const onBack = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    // Back to the page this one was opened from, when it is in this app
    let from: URL | null = null;
    try {
      from = document.referrer ? new URL(document.referrer) : null;
    } catch {
      from = null;
    }
    if (from && from.origin === window.location.origin && !READER_PAGE_RE.test(from.pathname) && window.history.length > 1) {
      event.preventDefault();
      window.history.back();
    }
  }, []);

  const overlay =
    status.kind === "error" ? (
      <OpenError
        title={file ? undefined : "This eBook cannot be read here"}
        message={status.message}
        onRetry={file ? () => setAttempt((n) => n + 1) : undefined}
        alternatives={alternatives}
        ebookId={ebook.id}
        backHref={backHref}
      />
    ) : status.kind === "opening" ? (
      <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-fg-secondary">
        Opening the book
      </p>
    ) : null;

  return (
    <ReaderShell
      ref={bookRef}
      barEvents={bars.barEvents}
      state={status.kind}
      overlay={overlay}
      bars={
        <>
          <ReaderToolbar
            visible={bars.visible}
            title={ebook.title}
            chapter={chapter}
            backHref={backHref}
            onBack={onBack}
            onContents={() => setContentsOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            fullscreen={fullscreen}
            onFullscreen={toggleFullscreen}
          />
          <ReaderBottomBar visible={bars.visible} chapter={chapter} percent={percent} />
        </>
      }
    >
      <ContentsDialog open={contentsOpen} onClose={() => setContentsOpen(false)} toc={toc} onPick={pick} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        onReset={resetSettings}
      />
    </ReaderShell>
  );
}
