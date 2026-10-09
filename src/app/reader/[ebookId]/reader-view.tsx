"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  ReaderBridgeProvider,
  useReaderSlotFilled,
} from "@/components/reader/bridge";
import {
  ReaderNotice,
  resumeNoticeText,
} from "@/components/reader/reader-notice";
import { SelectionToolbar } from "@/components/reader/selection-toolbar";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import { readerPercent } from "@/lib/reader/events";
import { positionUrl } from "@/lib/reader/device";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { createPlaceSync } from "@/lib/reader/sync/session";
import { ReturnChip } from "@/components/reader/return-chip";
import { PositionIndex, flattenContents } from "@/lib/reader/position-index";
import {
  readIndexCache,
  writeIndexCache,
} from "@/lib/reader/position-index-cache";
import {
  createReaderNavigation,
  type ReaderNavigation,
  type JumpSource,
} from "@/lib/reader/navigation";
import { createHistoryInput } from "@/lib/reader/history-input";
import type { GoToMode } from "@/lib/reader/goto";
import { PaceModel } from "@/lib/reader/pace";
import {
  mutedInk,
  renderRunningLines,
  runningPositions,
  saveRunningPositions,
  type RunningPositions,
} from "@/lib/reader/running-lines";
import { lazy, Suspense } from "react";
import { OpenError } from "@/components/reader/open-error";
import { ReaderBottomBar } from "@/components/reader/reader-bottom-bar";
import { ReaderShell, useReaderBars } from "@/components/reader/reader-shell";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { SettingsDialog } from "@/components/reader/settings-dialog";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { READER_PAGE_RE } from "@/lib/reader/csp";
import type {
  BookSource,
  DurtalLocator,
  EngineEvents,
  Prefetched,
  ReaderEngine,
  ReaderFormat,
} from "@/lib/reader/engine";
import { readerFontFaces } from "@/lib/reader/fonts";
import { PREFETCH_GLOBAL } from "@/lib/reader/first-range";
import {
  createReaderInput,
  registerCoreReaderShortcuts,
  type ReaderActions,
} from "@/lib/reader/input";
import { createPositionQueue } from "@/lib/reader/position-queue";
import { preloadFoliate } from "@/lib/reader/engines/foliate/preload";
import {
  presentationFrom,
  resolveThemeColors,
} from "@/lib/reader/presentation";
const GoToDialog = lazy(() =>
  import("@/components/reader/goto-dialog").then((module) => ({
    default: module.GoToDialog,
  })),
);
const ContentsPanel = lazy(() =>
  import("@/components/reader/contents-panel").then((module) => ({
    default: module.ContentsPanel,
  })),
);
const ShortcutSheet = lazy(() =>
  import("@/components/reader/shortcut-sheet").then((module) => ({
    default: module.ShortcutSheet,
  })),
);
const RunningLinesPopover = lazy(() =>
  import("@/components/reader/running-lines-popover").then((module) => ({
    default: module.RunningLinesPopover,
  })),
);
const localStorageOrNull = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

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
  charCount?: number | null;
}

/** A book that has not opened by then shows the error, never an endless wait */
const OPEN_TIMEOUT_MS = 30_000;

type Status =
  | { kind: "opening" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/** The first range the page's inline script started for this file, taken once */
function takePrefetch(fileId: string): Promise<Prefetched[]> | undefined {
  const store = (
    window as unknown as Record<
      string,
      Record<string, Promise<Prefetched[]>> | undefined
    >
  )[PREFETCH_GLOBAL];
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
  return (
    a.sectionIndex === b.sectionIndex &&
    Math.abs(a.totalProgression - b.totalProgression) < 1e-6
  );
}

const isBlocked = () =>
  !!document.querySelector(
    'dialog[open]:not([data-reader-side-panel]), dialog[open][data-reader-modal], [data-reader-running-lines][data-open="true"], [cmdk-root]',
  );

/**
 * The reading view (eBooks sub-issue 3): the engine in the page, the input
 * layer on every document, the bars, Contents and Settings, and this
 * device's place saved as the reader goes.
 */
type ReaderViewProps = {
  ebook: {
    id: string;
    title: string;
    authors: string[];
    language?: string | null;
  };
  file: ReaderViewFile | null;
  alternatives: { id: string; label: string }[];
  place: ReaderPlace | null;
  devicePlace: ReaderPlace | null;
  otherPlace: ReaderPlace | null;
  deviceId: string | null;
  backHref: string;
  plugins: { id: string; node: ReactNode }[];
};
export function ReaderView(props: ReaderViewProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ReaderBridgeProvider
      key={`${props.ebook.id}:${props.file?.id}:${attempt}`}
      plugins={props.plugins}
      context={{
        ebookId: props.ebook.id,
        fileId: props.file?.id ?? "",
        format: props.file?.format ?? "epub",
        locator: null,
        percent: null,
        chapter: null,
        selection: null,
      }}
    >
      {(bridge) => (
        <ReaderSession
          {...props}
          bridge={bridge}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
    </ReaderBridgeProvider>
  );
}
function ReaderSession({
  ebook,
  file,
  alternatives,
  place: ownPlace,
  devicePlace,
  otherPlace,
  deviceId,
  backHref,
  bridge,
  onRetry,
}: ReaderViewProps & { bridge: ReaderBridgeController; onRetry(): void }) {
  const openingPlace = ownPlace ?? devicePlace ?? otherPlace;
  const place = openingPlace?.locator ?? null;
  // The engine's code starts downloading as the view first renders, not after it mounts
  if (typeof window !== "undefined" && file) void preloadFoliate(file.format);
  const { settings, setSettings, resetSettings } = useReaderSettings();
  const bookRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const [status, setStatus] = useState<Status>(
    file
      ? { kind: "opening" }
      : {
          kind: "error",
          message: "This eBook has no file the reader can open.",
        },
  );
  const [index, setIndex] = useState<PositionIndex | null>(null);
  const indexRef = useRef<PositionIndex | null>(null);
  const navigationRef = useRef<ReaderNavigation | null>(null);
  const [relocation, setRelocation] = useState<EngineEvents["relocate"] | null>(
    null,
  );
  const [, historyChanged] = useState(0);
  const [returnTurns, setReturnTurns] = useState(0);
  const paceRef = useRef<PaceModel | null>(null);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoMode, setGotoMode] = useState<GoToMode | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [positions, setPositions] = useState<RunningPositions>(() =>
    runningPositions(null),
  );
  const [clock, setClock] = useState("");
  const statusFilled = useReaderSlotFilled("toolbar-status");
  const [chapter, setChapter] = useState<string | null>(
    place?.tocLabel ?? null,
  );
  const [percent, setPercent] = useState<number | null>(null);
  const [offer, setOffer] = useState<ReaderPlace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selection, setSelection] = useState<EngineEvents["selection"]>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<ReturnType<typeof createPlaceSync> | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState<boolean | null>(null);
  const bars = useReaderBars({
    held:
      contentsOpen ||
      settingsOpen ||
      gotoOpen ||
      shortcutsOpen ||
      runningOpen ||
      peeking ||
      status.kind !== "ready",
  });

  // The book's look: the settings, the theme's colours and the reader's own fonts
  const presentation = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : presentationFrom(
            settings,
            resolveThemeColors(),
            readerFontFaces(window.location.origin),
          ),
    [settings],
  );
  const presentationRef = useRef(presentation);
  useEffect(() => {
    presentationRef.current = presentation;
    paceRef.current?.interrupt();
    if (presentation) engineRef.current?.setPresentation(presentation);
  }, [presentation]);

  useEffect(() => {
    setPositions(runningPositions(localStorageOrNull()));
    paceRef.current = new PaceModel(localStorageOrNull());
  }, []);
  useEffect(() => {
    if (positions.clock === "off") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alignment: ReturnType<typeof setTimeout> | null = null;
    const update = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    const visible = () => {
      if (timer) clearInterval(timer);
      if (alignment) clearTimeout(alignment);
      timer = null;
      alignment = null;
      if (document.visibilityState !== "hidden") {
        update();
        const untilMinute = 60_000 - (Date.now() % 60_000);
        // Align to a minute without introducing a sub-30-second idle timer.
        alignment = setTimeout(
          () => {
            alignment = null;
            update();
            timer = setInterval(update, 60_000);
          },
          untilMinute < 30_000 ? untilMinute + 60_000 : untilMinute,
        );
      }
    };
    visible();
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (timer) clearInterval(timer);
      if (alignment) clearTimeout(alignment);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [positions.clock]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !index || !relocation || !presentation) return;
    if (!relocation.paginated) {
      engine.setMarginalia(null);
      return;
    }
    const fraction = relocation.locator.totalProgression;
    const characters =
      file?.charCount ?? index.info.linearSize * index.textRatio;
    const language = ebook.language ?? index.info.language;
    engine.setMarginalia(
      renderRunningLines({
        positions,
        index,
        locator: relocation.locator,
        chapter,
        timeLeftChapter:
          paceRef.current?.remaining(
            language,
            Math.max(0, index.chapterEnd(fraction) - fraction) * characters,
            "chapter",
          ) ?? "Learning your pace",
        timeLeftBook:
          paceRef.current?.remaining(
            language,
            (1 - fraction) * characters,
            "book",
          ) ?? "Learning your pace",
        clock,
        linear: relocation.linear,
        statusFilled,
        color: mutedInk(presentation.colors),
      }),
    );
  }, [
    index,
    relocation,
    presentation,
    positions,
    clock,
    chapter,
    statusFilled,
    file?.charCount,
    ebook.language,
  ]);
  const navigate = useCallback(
    async (
      target: import("@/lib/reader/engine").GoToTarget,
      source: JumpSource,
      originMark?: string,
    ) => {
      try {
        await navigationRef.current?.navigate(target, { source, originMark });
        return true;
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "That place could not be opened.",
        );
        return false;
      }
    },
    [],
  );
  const historyStep = useCallback((direction: -1 | 1) => {
    void navigationRef.current
      ?.historyStep(direction)
      .catch(() => setNotice("That place could not be opened."));
  }, []);
  const chapterStep = useCallback(
    (direction: -1 | 1) => {
      const current = navigationRef.current?.history.current?.locator;
      const positions = indexRef.current;
      if (!current || !positions) return;
      const fraction = current.totalProgression;
      if (positions.fallback) {
        if (direction < 0 && current.progression > 0.000001)
          void navigate({ href: current.href }, "chapter");
        else
          void navigationRef.current
            ?.chapterStep(direction)
            .catch(() => setNotice("That chapter could not be opened."));
        return;
      }
      const active =
        positions.chapters.find(
          (item) => item.href === navigationRef.current?.current?.tocItem?.href,
        ) ?? positions.chapterAt(fraction);
      const previous = positions.chapters
        .filter((item) => item.fraction < (active?.fraction ?? fraction) - 1e-9)
        .at(-1);
      const target =
        direction > 0
          ? positions.nextChapter(active?.fraction ?? fraction)
          : active && !navigationRef.current?.current?.atChapterStart
            ? active
            : previous;
      void navigate(
        target ? { href: target.href } : { fraction: direction > 0 ? 1 : 0 },
        "chapter",
      );
    },
    [navigate],
  );

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
      next: () =>
        void navigationRef.current
          ?.turn("next")
          .catch(() => setNotice("The next page could not be opened.")),
      prev: () =>
        void navigationRef.current
          ?.turn("prev")
          .catch(() => setNotice("The previous page could not be opened.")),
      left: () =>
        void navigationRef.current
          ?.turn("goLeft")
          .catch(() => setNotice("That page could not be opened.")),
      right: () =>
        void navigationRef.current
          ?.turn("goRight")
          .catch(() => setNotice("That page could not be opened.")),
      first: () => void navigate({ fraction: 0 }, "edge"),
      last: () => void navigate({ fraction: 1 }, "edge"),
      toggleBars: bars.toggle,
      contents: () => {
        paceRef.current?.interrupt();
        setContentsOpen(true);
      },
      settings: () => {
        paceRef.current?.interrupt();
        setSettingsOpen(true);
      },
      fullscreen: toggleFullscreen,
      goto: () => {
        paceRef.current?.interrupt();
        setGotoOpen(true);
      },
      shortcuts: () => {
        paceRef.current?.interrupt();
        setShortcutsOpen(true);
      },
      chapter: chapterStep,
      escape: () => {
        if (document.fullscreenElement)
          void document.exitFullscreen().catch(() => {});
      },
      activity: (kind) => {
        if (kind === "turn") {
          bars.hide();
          syncRef.current?.dismiss();
        }
        bridge.bus.activity(kind);
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

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

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
    let postponeIndex = () => {};
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
        goto: () => actions.current?.goto?.(),
        chapter: (direction) => actions.current?.chapter?.(direction),
        shortcuts: () => actions.current?.shortcuts?.(),
        escape: () => actions.current?.escape(),
        activity: (kind) => {
          postponeIndex();
          actions.current?.activity?.(kind);
        },
        pointer: (x, y) => actions.current?.pointer?.(x, y),
      },
      isBlocked,
      hasSelection: () => !!engine?.locatorFromSelection(),
      selectionEscape: () => {
        if (!engine?.locatorFromSelection()) return false;
        engine.clearSelection();
        return true;
      },
      selectionTab: (event) => {
        // Only take focus when entering from the book document. Once in the
        // host toolbar, native Tab must reach plugin actions and leave it.
        if (
          event.currentTarget === document ||
          !selectionRef.current?.keyboard ||
          event.shiftKey
        )
          return;
        const button =
          selectionToolbarRef.current?.querySelector<HTMLButtonElement>(
            "button",
          );
        if (button) {
          event.preventDefault();
          button.focus();
        }
      },
    });
    input.attach(document);
    const historyInput = createHistoryInput({
      blocked: isBlocked,
      available: (direction) =>
        !!(direction < 0
          ? navigationRef.current?.history.back
          : navigationRef.current?.history.forward),
      step: historyStep,
    });
    historyInput.attach(document);
    let unregisterShortcuts = () => {};
    const indexAbort = new AbortController();
    let indexTimer: ReturnType<typeof setTimeout> | null = null;

    const url = positionUrl(ebook.id, navigator);
    const queue = createPositionQueue({ url });
    const declineKey = `durtal-reader-declined:${ebook.id}:${deviceId ?? "new"}`;
    let declinedAt = 0;
    try {
      declinedAt = Number(localStorage.getItem(declineKey)) || 0;
    } catch {
      /* Storage can be disabled. */
    }
    const sync = createPlaceSync({
      own: ownPlace ?? devicePlace,
      other: devicePlace ? otherPlace : null,
      declinedAt,
      flush: () => queue.flush(),
      read: async () => {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Places unavailable");
        return (await res.json()).positions as ReaderPlace[];
      },
      offer: setOffer,
      remember: (at) => {
        try {
          localStorage.setItem(declineKey, String(at));
        } catch {
          /* Stay still works in this open. */
        }
      },
    });
    syncRef.current = sync;
    let hiddenAt: number | null =
      document.visibilityState === "hidden" ? Date.now() : null;
    const visibility = () => {
      paceRef.current?.interrupt();
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= 60_000)
          void sync.refresh();
        hiddenAt = null;
      }
    };
    const online = () => {
      if (document.visibilityState !== "hidden") void sync.refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    let saved: DurtalLocator | null = ownPlace?.locator ?? null;
    const save = (locator: DurtalLocator, chapterLabel: string | null) => {
      if (samePlace(locator, saved)) return;
      saved = locator;
      queue.push({
        fileId: file.id,
        locator,
        chapter: chapterLabel,
        clientUpdatedAt: new Date().toISOString(),
      });
    };

    const timeout = setTimeout(() => {
      if (opened || cancelled) return;
      cancelled = true;
      engine?.destroy();
      setStatus({
        kind: "error",
        message: "The file took too long to download. Check the connection.",
      });
    }, OPEN_TIMEOUT_MS);

    void (async () => {
      try {
        const { createFoliateEngine } =
          await import("@/lib/reader/engines/foliate/engine");
        if (cancelled) return;
        engine = createFoliateEngine();
        engineRef.current = engine;
        let latest: EngineEvents["relocate"] | null = null;
        engine.on("error", ({ message }) => {
          reported = true;
          setStatus({ kind: "error", message });
        });
        engine.on("ready", (info) => {
          const positions = new PositionIndex(
            info,
            readIndexCache(localStorageOrNull(), file.sha256),
          );
          indexRef.current = positions;
          setIndex(positions);
        });
        engine.on("document", ({ doc }) => {
          input.attach(doc);
          historyInput.attach(doc);
        });
        engine.on("link", ({ href, external, originMark }) => {
          if (!external) void navigate({ href }, "link", originMark);
        });
        engine.on("selection", (selected) => {
          setSelection(selected);
          const value = selected
            ? {
                text: selected.text,
                locator: selected.locator,
                fileId: file.id,
                chapter: selected.locator.tocLabel ?? null,
                percent: readerPercent(selected.locator),
              }
            : null;
          bridge.update({ selection: value });
          bridge.bus.emit("selection", value);
        });
        const publish = (relocation: EngineEvents["relocate"]) => {
          const { locator, chapter: label, reason, atEnd } = relocation;
          setRelocation(relocation);
          setChapter(label);
          setPercent(Math.round(locator.totalProgression * 100));
          paceRef.current?.arrive(
            relocation,
            ebook.language ?? indexRef.current?.info.language ?? null,
            document.visibilityState !== "hidden",
          );
          setReturnTurns((turns) => (reason === "jump" ? 0 : turns + 1));
          // The landing on open is not a new place; every move after it is
          if (opened) {
            const local: ReaderPlace = {
              deviceId: deviceId ?? "",
              deviceLabel: "Browser",
              thisDevice: true,
              fileId: file.id,
              locator,
              progression: locator.totalProgression,
              furthestProgression: locator.totalProgression,
              chapter: label,
              clientUpdatedAt: new Date().toISOString(),
            };
            if (reason === "turn") {
              sync.localTurn(local);
              setNotice(null);
            } else sync.localPlace(local);
            save(locator, label);
            bridge.update({
              locator,
              percent: readerPercent(locator),
              chapter: label,
            });
            bridge.bus.location({
              locator,
              kind: reason,
              chapter: label,
              fileId: file.id,
              atEnd,
            });
            if (reason === "turn")
              bridge.bus.activity(relocation.activity ?? "turn");
          }
        };
        const navigation = createReaderNavigation({
          engine,
          commit: publish,
          changed: () => historyChanged((value) => value + 1),
          interrupt: () => paceRef.current?.interrupt(),
          fatal: () =>
            setStatus({
              kind: "error",
              message:
                "The original page could not be restored. Reopen the book to continue.",
            }),
        });
        navigationRef.current = navigation;
        engine.on("relocate", (relocation) => {
          if (cancelled) return;
          latest = relocation;
          if (opened) navigation.relocate(relocation);
          else {
            setChapter(relocation.chapter);
            setPercent(Math.round(relocation.locator.totalProgression * 100));
          }
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
            const res = await fetch(`/api/ebooks/files/${file.id}/url`, {
              cache: "no-store",
            });
            if (!res.ok)
              throw new Error(
                `The file's URL could not be renewed (${res.status})`,
              );
            return ((await res.json()) as { url: string }).url;
          },
        };
        const { resolved } = await engine.open(source, {
          container,
          presentation: presentationRef.current!,
          at:
            openingPlace && openingPlace.fileId !== file.id
              ? { fraction: openingPlace.locator.totalProgression }
              : (place ?? undefined),
        });
        if (cancelled) return;
        opened = true;
        clearTimeout(timeout);
        setStatus({ kind: "ready" });
        const failedPlace =
          place &&
          openingPlace?.fileId === file.id &&
          (!resolved || resolved.status === "failed");
        if (failedPlace) {
          setNotice(
            "Your saved place could not be found. Opened at the start.",
          );
        }
        // A first open, or a place found again another way: save where the book opened
        const landing = latest as EngineEvents["relocate"] | null;
        if (!failedPlace && !devicePlace && otherPlace) {
          setNotice(
            `Opened where you left off on ${otherPlace.deviceLabel.split(" · ")[0]}`,
          );
          noticeTimer = setTimeout(() => setNotice(null), 4000);
        }
        if (landing) {
          navigation.start(landing);
          setRelocation(landing);
          paceRef.current?.arrive(
            landing,
            ebook.language ?? indexRef.current?.info.language ?? null,
            document.visibilityState !== "hidden",
          );
          sync.localPlace({
            deviceId: deviceId ?? "",
            deviceLabel: "Browser",
            thisDevice: true,
            fileId: file.id,
            locator: landing.locator,
            progression: landing.locator.totalProgression,
            furthestProgression: landing.locator.totalProgression,
            chapter: landing.chapter,
            clientUpdatedAt:
              ownPlace && resolved?.status === "exact"
                ? ownPlace.clientUpdatedAt
                : new Date().toISOString(),
          });
          bridge.update({
            locator: landing.locator,
            percent: readerPercent(landing.locator),
            chapter: landing.chapter,
          });
          bridge.bus.location({ ...landing, fileId: file.id, kind: "jump" });
        }
        if (landing && (!ownPlace || resolved?.status !== "exact"))
          save(landing.locator, landing.chapter);
        unregisterShortcuts = registerCoreReaderShortcuts([
          "arrowleft",
          "arrowright",
          "space",
          "shift space",
          "pageup",
          "pagedown",
          "home",
          "end",
          "t",
          "s",
          "escape",
          "g",
          "[",
          "]",
          "alt arrowleft",
          "alt arrowright",
          "?",
          ...(document.fullscreenEnabled ? ["f"] : []),
        ]);
        let indexing = false;
        postponeIndex = () => {
          if (indexing || cancelled) return;
          if (indexTimer) clearTimeout(indexTimer);
          indexTimer = setTimeout(() => {
            indexing = true;
            void (async () => {
              const currentIndex = indexRef.current;
              if (!engine || !currentIndex || cancelled) return;
              const hrefs = [
                ...new Set(
                  [
                    ...flattenContents(currentIndex.contents),
                    ...flattenContents(currentIndex.info.pageList),
                  ]
                    .map((item) => item.href)
                    .filter(Boolean),
                ),
              ];
              for await (const entry of engine.indexAnchors({
                hrefs,
                signal: indexAbort.signal,
              })) {
                if (cancelled) return;
                currentIndex.set(
                  entry.href,
                  entry.fraction,
                  entry.sectionLabel,
                  entry.textRatio,
                );
              }
              if (cancelled) return;
              currentIndex.rebuild();
              writeIndexCache(
                localStorageOrNull(),
                file.sha256,
                currentIndex.fractions,
              );
              const updated = new PositionIndex(
                currentIndex.info,
                currentIndex.fractions,
              );
              updated.textRatio = currentIndex.textRatio;
              indexRef.current = updated;
              setIndex(updated);
            })().catch(() => {
              /* Immediate section positions remain usable if indexing fails. */
            });
          }, 2000);
        };
        postponeIndex();
      } catch {
        if (cancelled) return;
        clearTimeout(timeout);
        // The engine says what kind of failure it was; this is for the rest
        if (!reported)
          setStatus({
            kind: "error",
            message: "The file is damaged or not a valid eBook.",
          });
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (noticeTimer) clearTimeout(noticeTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      sync.destroy();
      syncRef.current = null;
      queue.destroy();
      indexAbort.abort();
      if (indexTimer) clearTimeout(indexTimer);
      unregisterShortcuts();
      historyInput.destroy();
      navigationRef.current?.destroy();
      navigationRef.current = null;
      paceRef.current?.interrupt();
      input.destroy();
      engine?.destroy();
      engineRef.current = null;
    };
    // A new file or a retry opens the book again; the place is read once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  const pick = useCallback(
    (href: string) => navigate({ href }, "contents"),
    [navigate],
  );

  const onBack = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    // Back to the page this one was opened from, when it is in this app
    let from: URL | null = null;
    try {
      from = document.referrer ? new URL(document.referrer) : null;
    } catch {
      from = null;
    }
    if (
      from &&
      from.origin === window.location.origin &&
      !READER_PAGE_RE.test(from.pathname) &&
      window.history.length > 1
    ) {
      event.preventDefault();
      window.history.back();
    }
  }, []);

  const overlay =
    status.kind === "error" ? (
      <OpenError
        title={file ? undefined : "This eBook cannot be read here"}
        message={status.message}
        onRetry={file ? onRetry : undefined}
        alternatives={alternatives}
        ebookId={ebook.id}
        backHref={backHref}
      />
    ) : status.kind === "opening" ? (
      <p
        role="status"
        className="absolute inset-0 flex items-center justify-center text-sm text-fg-secondary"
      >
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
            onContents={() => {
              paceRef.current?.interrupt();
              setContentsOpen(true);
            }}
            onSettings={() => {
              paceRef.current?.interrupt();
              setSettingsOpen(true);
            }}
            fullscreen={fullscreen}
            onFullscreen={toggleFullscreen}
            onShortcuts={() => {
              paceRef.current?.interrupt();
              setShortcutsOpen(true);
            }}
          />
          <ReaderBottomBar
            visible={bars.visible}
            chapter={chapter}
            percent={percent}
            bridge={bridge}
            index={index}
            locator={relocation?.locator}
            linear={relocation?.linear}
            timeLeftChapter={
              index && relocation
                ? paceRef.current?.remaining(
                    ebook.language ?? index.info.language,
                    Math.max(
                      0,
                      index.chapterEnd(relocation.locator.totalProgression) -
                        relocation.locator.totalProgression,
                    ) *
                      (file?.charCount ??
                        index.info.linearSize * index.textRatio),
                    "chapter",
                  )
                : undefined
            }
            onGoTo={() => {
              paceRef.current?.interrupt();
              setGotoOpen(true);
            }}
            onRunningLines={() => {
              paceRef.current?.interrupt();
              setRunningOpen(true);
            }}
            onScrub={(fraction) => void navigate({ fraction }, "scrubber")}
            onPeek={(active) => {
              setPeeking(active);
              if (active) paceRef.current?.interrupt();
            }}
          />
        </>
      }
    >
      <ReaderNotice bridge={bridge}>
        {notice ??
          (offer && file ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1">
                {resumeNoticeText(offer, file.id)}
              </p>
              <button
                type="button"
                aria-label="Go to the newer place"
                data-tooltip="Go to the newer place"
                className="h-8 rounded-sm px-2 hover:bg-bg-tertiary [@media(pointer:coarse)]:min-h-11"
                onClick={() => {
                  const target = offer;
                  syncRef.current?.dismiss();
                  void navigate(
                    target.fileId === file.id
                      ? target.locator
                      : { fraction: target.locator.totalProgression },
                    "resume",
                  );
                }}
              >
                Go there
              </button>
              <button
                type="button"
                aria-label="Stay at this place"
                data-tooltip="Stay at this place"
                className="h-8 rounded-sm px-2 hover:bg-bg-tertiary [@media(pointer:coarse)]:min-h-11"
                onClick={() => syncRef.current?.dismiss()}
              >
                Stay
              </button>
            </div>
          ) : null)}
      </ReaderNotice>
      <SelectionToolbar
        ref={selectionToolbarRef}
        selection={selection}
        bridge={bridge}
        onClear={() => engineRef.current?.clearSelection()}
      />
      <Suspense fallback={null}>
        {index && contentsOpen && (
          <ContentsPanel
            open={contentsOpen}
            onClose={() => setContentsOpen(false)}
            index={index}
            current={
              relocation?.tocItem ??
              (relocation
                ? index.chapterAt(relocation.locator.totalProgression)
                : null)
            }
            onPick={pick}
          />
        )}
      </Suspense>
      {index && navigationRef.current && (
        <ReturnChip
          navigation={navigationRef.current}
          index={index}
          visible={bars.visible || returnTurns < 3}
          onStep={historyStep}
        />
      )}
      <Suspense fallback={null}>
        {index && gotoOpen && (
          <GoToDialog
            open
            onClose={() => setGotoOpen(false)}
            index={index}
            initialMode={gotoMode}
            onModeChange={setGotoMode}
            onGo={(target) => navigate(target, "goto")}
          />
        )}
        {shortcutsOpen && (
          <ShortcutSheet open onClose={() => setShortcutsOpen(false)} />
        )}
        {runningOpen && (
          <RunningLinesPopover
            open
            onClose={() => setRunningOpen(false)}
            value={positions}
            available={!!relocation?.paginated}
            onChange={(value) => {
              setPositions(value);
              saveRunningPositions(localStorageOrNull(), value);
            }}
          />
        )}
      </Suspense>
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
