"use client";
import type { ReaderSpeech, SpeechSnapshot } from "@/lib/reader/speech/session";
import { useReaderAnnotations } from "@/components/reader/use-reader-annotations";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { highlightColours, LIGHT_THEME_HIGHLIGHTS, markInk } from "@/lib/reader/presentation/themes";
import { SkipToBook } from "@/components/reader/skip-to-book";
import { ReaderAnnouncer } from "@/components/reader/reader-announcer";
import { LeavePrompt } from "@/components/reader/leave-prompt";
import { takeEarlyEscape } from "@/lib/reader/early-escape";
import { closeLatestReaderPanel, subscribeReaderPanelInset } from "@/components/reader/side-panel";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { besideBook, enterBook, entersBook, nextInBook, onBookScreen } from "@/lib/reader/book-tab";
import {
  ReaderBridgeProvider,
  useReaderSlotFilled,
  useReaderFeatureShortcut,
} from "@/components/reader/bridge";
import { hasOpenSurface } from "@/lib/ui/surface-state";
import {
  ReaderNotice,
  resumePlaceLabel,
  resumeNoticeText,
} from "@/components/reader/reader-notice";
import { SelectionToolbar } from "@/components/reader/selection-toolbar";
import { LookupLayer } from "@/components/reader/lookup/lookup-layer";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import { readerPercent } from "@/lib/reader/events";
import { positionUrl } from "@/lib/reader/device";
import type { ReaderPlace } from "@/lib/reader/sync/places";
import { createPlaceSync } from "@/lib/reader/sync/session";
import { openReaderForContinue, resolveContinueAnchor } from "@/lib/ebooks/continue-resolve";
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
import { createBrowserHistory, type BrowserHistory } from "@/lib/reader/browser-history";
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
import { QUIET_TOP_FADE_PX, quietChapter, ReaderBottomBar } from "@/components/reader/reader-bottom-bar";
import { ReaderShell, useReaderBars } from "@/components/reader/reader-shell";
import { PageEdges } from "@/components/reader/page-edges";
import { DownloadButton } from "@/components/reader/offline/download-button";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { FixedLayoutControls } from "@/components/reader/fixed-layout-controls";
import { PresentationSettingsDialog } from "@/components/reader/presentation-settings-dialog";
import { useReaderPreferences } from "@/hooks/use-reader-preferences";
import type { ReaderPreferencesRead } from "@/lib/ebooks/preferences";
import type { DeviceClass } from "@/lib/validations/reader-preferences";
import { effectivePresentation, presentationFieldScope, PRESENTATION_DEFAULTS, type PresentationRow } from "@/lib/reader/presentation/defaults";
import { deviceClass as classifyDevice } from "@/lib/reader/presentation/device-class";
import { READER_PAGE_RE } from "@/lib/reader/csp";
import type {
  BookSource,
  DurtalLocator,
  EngineEvents,
  Prefetched,
  ReaderEngine,
  ReaderFormat,
} from "@/lib/reader/engine";
import { PREFETCH_GLOBAL } from "@/lib/reader/first-range";
import {
  createReaderInput,
  registerCoreReaderShortcuts,
  type ReaderActions,
} from "@/lib/reader/input";
import { createDurablePositionQueue } from "@/lib/reader/offline/position-adapter";
import { getReaderRuntime } from "@/lib/reader/offline/runtime";
import { useSyncPaused } from "@/components/reader/use-sync-paused";
import { comparePositionTimes } from "@/lib/reader/offline/outbox-policy";
import type { PositionMutation } from "@/lib/reader/offline/mutations";
import { isExactLocalOpeningPosition } from "@/lib/reader/opening-position";
import { preloadFoliate } from "@/lib/reader/engines/foliate/preload";
import { indexDiagnosticEnabled, observeIndexDiagnostic } from "@/lib/reader/index-diagnostics";
import {
  presentationFromPreferences,
} from "@/lib/reader/presentation";
const SpeechControls = lazy(() =>
  import("@/components/reader/speech-player").then((module) => ({
    default: module.SpeechPlayer,
  })),
);
const SpeechStart = lazy(() =>
  import("@/components/reader/speech-player").then((module) => ({
    default: module.SpeechStartButton,
  })),
);
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
const ContentViewer = lazy(() =>
  import("@/components/reader/content-viewer").then((module) => ({
    default: module.ContentViewer,
  })),
);
const NotePopover = lazy(() =>
  import("@/components/reader/note-popover").then((module) => ({
    default: module.NotePopover,
  })),
);
const SearchPanel = lazy(() =>
  import("@/components/reader/search-panel").then((module) => ({
    default: module.SearchPanel,
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
  cdnBases?: string[];
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
  if (a.pdf || b.pdf) return a.pdf?.page === b.pdf?.page && JSON.stringify(a.pdf?.rects) === JSON.stringify(b.pdf?.rects);
  return (
    a.sectionIndex === b.sectionIndex &&
    Math.abs(a.totalProgression - b.totalProgression) < 1e-6
  );
}

const isBlocked = () =>
  hasOpenSurface() || !!document.querySelector(
    'dialog[open]:not([data-reader-side-panel]), dialog[open][data-reader-modal], [data-reader-running-lines][data-open="true"], [cmdk-root], [role="menu"]',
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
    editionLanguage?: string | null;
  };
  file: ReaderViewFile | null;
  alternatives: { id: string; label: string }[];
  place: ReaderPlace | null;
  devicePlace: ReaderPlace | null;
  otherPlace: ReaderPlace | null;
  /** Every other device's place, so the offer can name the furthest as well as the newest */
  otherPlaces?: readonly ReaderPlace[];
  deviceId: string | null;
  backHref: string;
  /** An annotation to jump to once the book is painted (`?at=`) */
  openAt?: string | null;
  /** A device's place chosen on the eBook page (`?from=`): the book opens there (SLN-665) */
  startPlace?: ReaderPlace | null;
  plugins: import("@/lib/reader/bridge-state").ReaderPluginView[];
  requiredControllerIds?: readonly string[];
  settingsCookie?: string | null;
  preferences?: ReaderPreferencesRead;
  localPreferenceAdmission?: boolean;
};
export function ReaderView(props: ReaderViewProps) {
  const [attempt, setAttempt] = useState(0);
  const [preferenceClass, setPreferenceClass] = useState<DeviceClass | null>(null);
  useEffect(() => {
    setPreferenceClass(classifyDevice({ width: window.screen.width, height: window.screen.height,
      coarse: window.matchMedia("(pointer: coarse)").matches }));
  }, []);
  const preferences: ReaderPreferencesRead = props.preferences ?? { ok: true, ebookId: props.ebook.id, rows: [] };
  return (
    <ReaderBridgeProvider
      key={`${props.ebook.id}:${props.file?.id}:${attempt}`}
      plugins={props.plugins}
      requiredControllerIds={props.requiredControllerIds}
      onRetry={() => setAttempt((n) => n + 1)}
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
        !preferences.ok ? <OpenError message={preferences.error} ebookId={props.ebook.id} backHref={props.backHref}
          alternatives={props.alternatives} onRetry={() => window.location.reload()} /> : preferenceClass ? <ReaderSession
          {...props}
          preferenceClass={preferenceClass}
          preferenceRows={preferences.rows}
          bridge={bridge}
          onRetry={() => setAttempt((n) => n + 1)}
        /> : <p role="status" className="p-6 text-sm text-fg-secondary">Opening the book</p>
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
  otherPlaces,
  deviceId,
  backHref,
  openAt,
  startPlace,
  bridge,
  onRetry,
  preferenceClass,
  preferenceRows,
  localPreferenceAdmission,
}: ReaderViewProps & { bridge: ReaderBridgeController; onRetry(): void; preferenceClass: DeviceClass; preferenceRows: readonly PresentationRow[] }) {
  const openingPlace = startPlace ?? devicePlace ?? ownPlace ?? otherPlace;
  // The engine's code starts downloading as the view first renders, not after it mounts
  if (typeof window !== "undefined" && file) void preloadFoliate(file.format);
  const preferences = useReaderPreferences({ deviceClass: preferenceClass, ebookId: ebook.id, initialRows: preferenceRows, localPreferenceAdmission });
  const settings = useMemo(() => effectivePresentation(preferenceClass, preferences.rows), [preferenceClass, preferences.rows]);
  // Read by the input layer at each tap, which outlives a render
  const edgeTapsRef = useRef(settings.edgeTaps);
  useEffect(() => { edgeTapsRef.current = settings.edgeTaps; }, [settings.edgeTaps]);
  const annotationPalette = useMemo(() => ({
    fills: highlightColours(settings, settings.theme === "durtal-dark" ? QUIET_GLASS_ANNOTATION_PALETTE.fills : LIGHT_THEME_HIGHLIGHTS[settings.theme], markInk(settings.theme).opacity),
    quote: highlightColours(settings, { quote: QUIET_GLASS_ANNOTATION_PALETTE.quote }).quote,
  }), [settings]);
  const [preferencesTimedOut, setPreferencesTimedOut] = useState(false);
  useEffect(() => {
    if (preferences.ready) return;
    const timer = setTimeout(() => setPreferencesTimedOut(true), OPEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [preferences.ready]);
  const adjustText = (direction: -1 | 0 | 1) => {
    if (!preferences.ready || !bridge.getControllerReadinessSnapshot().ready) return;
    if (engineRef.current?.fixedPages?.() != null) {
      const engine = engineRef.current;
      engine?.adjustFixedZoom?.(direction);
      return;
    }
    const field = settings.publisherStyles ? "publisherScale" : "fontSizePx";
    const value = direction === 0 ? PRESENTATION_DEFAULTS[preferenceClass][field]
      : Math.min(field === "fontSizePx" ? 40 : 250, Math.max(field === "fontSizePx" ? 12 : 60,
          settings[field] + direction * (field === "fontSizePx" ? 1 : 5)));
    try { preferences.update({ deviceClass: preferenceClass, ebookId: presentationFieldScope(field, preferenceClass, preferences.rows), presentation: { [field]: value } }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "That setting could not be changed."); }
  };
  useReaderFeatureShortcut("+", 12, () => adjustText(1), preferences.ready);
  useReaderFeatureShortcut("-", 12, () => adjustText(-1), preferences.ready);
  useReaderFeatureShortcut("0", 12, () => adjustText(0), preferences.ready);
  const bookRef = useRef<HTMLDivElement>(null);
  // What covers the text with the bars hidden while scrolling (SLN-674)
  const coveredRef = useRef<{ top: number; bottom: number } | null>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const resumeClock = useRef<string | null>(null);
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
  const browserHistoryRef = useRef<BrowserHistory | null>(null);
  const speechRef = useRef<ReaderSpeech | null>(null);
  const [speech, setSpeech] = useState<SpeechSnapshot | null>(null);
  const [speechHeight, setSpeechHeight] = useState(0);
  const [bottomHeight, setBottomHeight] = useState(0);
  // Search's results bar, while it stands in the bottom bar's place (SLN-727)
  const [searchBarHeight, setSearchBarHeight] = useState(0);
  const [topHeight, setTopHeight] = useState(0);
  // The text keeps clear of the bars; with the speech player open the book
  // already ends above it and the bottom bar (SLN-663)
  const insets = useMemo(
    () => ({ top: topHeight, bottom: speechHeight ? 0 : bottomHeight, pinned: settings.pinBars }),
    [topHeight, bottomHeight, speechHeight, settings.pinBars],
  );
  const insetsRef = useRef(insets);
  const [relocation, setRelocation] = useState<EngineEvents["relocate"] | null>(
    null,
  );
  const [, historyChanged] = useState(0);
  const [returnTurns, setReturnTurns] = useState(0);
  const paceRef = useRef<PaceModel | null>(null);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoMode, setGotoMode] = useState<GoToMode | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [positions, setPositions] = useState<RunningPositions>(() =>
    runningPositions(null),
  );
  const [clock, setClock] = useState("");
  const statusFilled = useReaderSlotFilled("toolbar-status");
  const controllerReadiness = useSyncExternalStore(
    bridge.subscribeControllerReadiness,
    bridge.getControllerReadinessSnapshot,
    bridge.getControllerReadinessSnapshot,
  );
  const [chapter, setChapter] = useState<string | null>(
    openingPlace?.locator.tocLabel ?? null,
  );
  const [percent, setPercent] = useState<number | null>(null);
  const [offer, setOffer] = useState<ReaderPlace | null>(null);
  const [furthest, setFurthest] = useState<ReaderPlace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** "Opening the book" stays until the text shows, then fades out as the
   * text fades in (SLN-733) */
  const [openingLine, setOpeningLine] = useState<"held" | "fading" | "gone">("held");
  /** The other device a first open took its place from, named in the bottom bar (SLN-729) */
  const [placeFrom, setPlaceFrom] = useState<string | null>(null);
  const sync = useSyncPaused();
  const [selection, setSelection] = useState<EngineEvents["selection"]>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const [lookupSheet, setLookupSheet] = useState(false);
  const syncRef = useRef<ReturnType<typeof createPlaceSync> | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  // Moving through Contents is not reading: it must not keep postponing the
  // index that gives Contents its page numbers (SLN-724 review)
  const contentsOpenRef = useRef(false);
  useEffect(() => { contentsOpenRef.current = contentsOpen; }, [contentsOpen]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  // The results bar's Esc, once the panel is closed (SLN-675)
  const searchEscapeRef = useRef<(() => boolean) | null>(null);
  const [searchMounted, setSearchMounted] = useState(false);
  const [canSearch, setCanSearch] = useState(false);
  const [note, setNote] = useState<EngineEvents["note"]>(null);
  const [media, setMedia] = useState<EngineEvents["media"] | null>(null);
  const openSearch = () => {
    paceRef.current?.interrupt();
    setSearchMounted(true);
    setSearchOpen(true);
  };
  useReaderFeatureShortcut("/", 14, openSearch, canSearch);
  useReaderFeatureShortcut("mod f", 14, openSearch, canSearch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fixedControlsOpen, setFixedControlsOpen] = useState(false);
  const [barMenuOpen, setBarMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState<boolean | null>(null);

  // The book's look: the settings, the theme's colours and the reader's own fonts
  const presentation = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : presentationFromPreferences(settings, window.location.origin),
    [settings],
  );
  const presentationRef = useRef(presentation);
  // Scrolled text names its chapter in a slim band while the bars are hidden
  const paginated = relocation ? relocation.paginated : true;
  const pageByPage = !!relocation && engineRef.current?.fixedPages?.() != null;
  const quiet = useMemo(() => quietChapter({
    policy: presentation?.policy, paginated, pageByPage, pinBars: settings.pinBars, format: file?.format,
  }), [paginated, pageByPage, settings.pinBars, presentation, file?.format]);
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
      if (!bridge.getControllerReadinessSnapshot().ready) return false;
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
    [bridge],
  );
  const historyStep = useCallback((direction: -1 | 1) => {
    if (!bridge.getControllerReadinessSnapshot().ready) return;
    // Through the browser while it holds the entry: its popstate makes the step
    if (browserHistoryRef.current?.step(direction)) return;
    void navigationRef.current
      ?.historyStep(direction)
      .catch(() => setNotice("That place could not be opened."));
  }, [bridge]);
  const chapterStep = useCallback(
    (direction: -1 | 1) => {
      if (!bridge.getControllerReadinessSnapshot().ready) return;
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
    [bridge, navigate],
  );

  const annotations = useReaderAnnotations({
    book: ebook, fileId: file?.id ?? null, deviceId,
    engine: status.kind === "ready" ? engineRef.current : null,
    painted: status.kind === "ready" && !!relocation,
    bridge, selection, locator: relocation?.locator ?? null,
    palette: annotationPalette,
    onJump: locator => navigate(locator, "annotation"), onNotice: setNotice,
    openAt: openAt ?? null,
    imagesOnly: file?.format === "cbz",
  });

  const bars = useReaderBars({
    held:
      settings.pinBars ||
      fixedControlsOpen || barMenuOpen || annotations.held ||
      contentsOpen ||
      searchOpen ||
      settingsOpen ||
      gotoOpen ||
      shortcutsOpen ||
      runningOpen ||
      peeking ||
      status.kind !== "ready" ||
      !controllerReadiness.ready,
  });

  const releaseBars = bars.release;

  useEffect(() => {
    engineRef.current?.setMarginaliaHidden(bars.visible);
  }, [bars.visible, relocation]);

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
    const turn = (
      direction: "next" | "prev" | "goLeft" | "goRight",
      failure: string,
    ) => {
      if (!bridge.getControllerReadinessSnapshot().ready) return;
      // Floating bars cover the text the reader sees at this press; the
      // turn hides them, so the line it keeps is read above and below them
      const covered = coveredRef.current, book = bookRef.current?.getBoundingClientRect();
      if (covered && book && bars.visibleRef.current) {
        const top = document.querySelector("[data-reader-top-bar]")?.getBoundingClientRect();
        const bottom = document.querySelector("[data-reader-bottom-bar]")?.getBoundingClientRect();
        engineRef.current?.setCovered?.(covered, {
          top: top ? top.bottom - book.top : covered.top,
          bottom: bottom ? book.bottom - bottom.top : covered.bottom,
        });
      }
      // Visual/resume intent is immediate; reading activity waits for painted movement.
      bars.release();
      bars.hide();
      syncRef.current?.dismiss();
      void navigationRef.current
        ?.turn(direction)
        .catch(() => setNotice(failure));
    };
    actions.current = {
      next: () => turn("next", "The next page could not be opened."),
      prev: () => turn("prev", "The previous page could not be opened."),
      left: () => turn("goLeft", "That page could not be opened."),
      right: () => turn("goRight", "That page could not be opened."),
      first: () => void navigate({ fraction: 0 }, "edge"),
      last: () => void navigate({ fraction: 1 }, "edge"),
      toggleBars: bars.toggle,
      showBars: bars.show,
      contents: () => {
        paceRef.current?.interrupt();
        setContentsOpen(true);
      },
      search: canSearch
        ? () => {
            paceRef.current?.interrupt();
            setSearchMounted(true);
            setSearchOpen(true);
          }
        : undefined,
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
      speech: () => speechRef.current?.toggle(),
      sentence: (direction) =>
        speechRef.current?.action({ kind: "skip", direction }),
      escape: () => {
        if (speechRef.current?.snapshot.open) {
          speechRef.current.action({ kind: "stop" });
          return;
        }
        // Search: the panel closes first and keeps its hits, then the search ends
        if (searchOpenRef.current) {
          setSearchOpen(false);
          return;
        }
        // A panel beside the book (Contents, Settings, Highlights at 1024px
        // and up) closes even when focus has left it
        if (closeLatestReaderPanel()) return;
        if (searchEscapeRef.current?.()) return;
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
          return;
        }
        // With nothing left to close, Esc asks before leaving the book
        // (SLN-744). It opens once this key is done: a modal dialog open
        // while the key's default action runs would take it as its cancel.
        paceRef.current?.interrupt();
        setTimeout(() => setLeaveOpen(true));
      },
      activity: (kind) => {
        if (bridge.getControllerReadinessSnapshot().ready) bridge.bus.activity(kind);
      },
      pointer: (x, y) => bars.pointerAt(x, y),
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

  // While the book opens, the input layer waits for the reader's features;
  // Escape still asks before leaving, so one press does it (SLN-811). A press
  // before this code ran was noted by the page's script.
  const inputListening = useRef(false);
  const opening = status.kind === "opening";
  useEffect(() => {
    if (!opening) return;
    if (takeEarlyEscape() && !isBlocked()) actions.current?.escape();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || inputListening.current || isBlocked()) return;
      actions.current?.escape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [opening]);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // The book: the engine, the input layer, the place
  useEffect(() => {
    const container = bookRef.current;
    if (!file || !container || !preferences.ready) return;
    // Arrived by a client-side navigation: load again, so the reader's content policy applies
    if (!loadedAsReaderPage()) {
      window.location.replace(window.location.href);
      return;
    }
    let cancelled = false;
    const startupAbort = new AbortController();
    let phase: "controllers" | "engine" = "controllers";
    let engine: ReaderEngine | null = null;
    let opened = false;
    let unregisterSelectionCapture = () => {};
    let reported = false;
    let postponeIndex = () => {};
    let speechSelectionTimer: ReturnType<typeof setTimeout> | null = null;
    setStatus({ kind: "opening" });
    setOpeningLine("held");
    let openingLineTimer: ReturnType<typeof setTimeout> | null = null;

    const input = createReaderInput({
      actions: {
        next: () => actions.current?.next(),
        prev: () => actions.current?.prev(),
        left: () => actions.current?.left(),
        right: () => actions.current?.right(),
        first: () => actions.current?.first(),
        last: () => actions.current?.last(),
        toggleBars: () => actions.current?.toggleBars(),
        showBars: () => actions.current?.showBars?.(),
        contents: () => actions.current?.contents(),
        settings: () => actions.current?.settings(),
        // The stable input instance reads capability changes at dispatch time.
        get search() {
          return actions.current?.search;
        },
        fullscreen: () => actions.current?.fullscreen(),
        speech: () => actions.current?.speech?.(),
        sentence: (direction) => actions.current?.sentence?.(direction),
        goto: () => actions.current?.goto?.(),
        chapter: (direction) => actions.current?.chapter?.(direction),
        shortcuts: () => actions.current?.shortcuts?.(),
        escape: () => actions.current?.escape(),
        activity: (kind) => {
          if (!contentsOpenRef.current) postponeIndex();
          actions.current?.activity?.(kind);
        },
        pointer: (x, y) => actions.current?.pointer?.(x, y),
        scroll: (direction) => engine?.scrollLines?.(direction),
        scrollBy: (px) => engine?.scrollBy?.(px),
      },
      scrolled: () => !!engine?.isScrolled?.(),
      pageImages: () => engine?.fixedPages?.() != null,
      turning: () => !!navigationRef.current?.busy,
      isBlocked: () => isBlocked() || !bridge.getControllerReadinessSnapshot().ready,
      hasSelection: () => !!engine?.locatorFromSelection(),
      edgeTaps: () => edgeTapsRef.current,
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
      bookTab: (event) => {
        // Tab visits the links on this screen, then leaves the book for the
        // bars, which it brings back first (SLN-810)
        const doc = event.currentTarget as Document;
        const book = bookRef.current;
        if (!doc.defaultView?.frameElement || !book) return;
        const next = nextInBook(doc, event.shiftKey, onBookScreen(book));
        event.preventDefault();
        if (next) return next.focus({ preventScroll: true });
        flushSync(() => actions.current?.showBars?.());
        const beside = besideBook(book, event.shiftKey);
        beside?.focus({ preventScroll: true });
        // Firefox can keep focus in the frame once Tab has been out to its
        // own toolbar: the page's window takes it first, then the control
        if (beside && document.activeElement !== beside) {
          window.focus();
          beside.focus({ preventScroll: true });
        }
      },
      intoBook: (event) => {
        // Tab from a bar into the book lands on this screen's first link, or
        // its last with Shift, or on the page itself: the browser's own order
        // would take a link in another chapter and move the book (SLN-826)
        const book = bookRef.current, engine = engineRef.current;
        const from = document.activeElement;
        if (!book || !engine?.bookDocuments || !from || !entersBook(book, from, event.shiftKey)) return;
        event.preventDefault();
        const next = enterBook(engine.bookDocuments(), event.shiftKey, onBookScreen(book));
        if (!next) return engine.focusBook?.();
        // Firefox moves focus into a frame only once the frame itself has it
        (next.ownerDocument.defaultView?.frameElement as HTMLElement | null)?.focus({ preventScroll: true });
        next.focus({ preventScroll: true });
      },
    });
    const historyInput = createHistoryInput({
      blocked: () => isBlocked() || !bridge.getControllerReadinessSnapshot().ready,
      available: (direction) =>
        !!(direction < 0
          ? navigationRef.current?.history.back
          : navigationRef.current?.history.forward),
      step: historyStep,
    });
    let recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeReadiness = bridge.subscribeControllerReadiness(() => {
      if (bridge.getControllerReadinessSnapshot().ready) {
        if (recoveryTimeout) clearTimeout(recoveryTimeout);
        recoveryTimeout = null;
      } else {
        navigationRef.current?.cancel();
        paceRef.current?.interrupt();
        if (opened && !recoveryTimeout) recoveryTimeout = setTimeout(() => {
          recoveryTimeout = null;
          if (!cancelled && !bridge.getControllerReadinessSnapshot().ready)
            setStatus({ kind: "error", message: "A reader feature could not start. Try opening the book again." });
        }, OPEN_TIMEOUT_MS);
      }
    });
    let unregisterShortcuts = () => {};
    const indexAbort = new AbortController();
    let indexTimer: ReturnType<typeof setTimeout> | null = null;

    const url = positionUrl(ebook.id, navigator);
    const queue = createDurablePositionQueue({ ebookId: ebook.id, deviceId,
      onError: () => { if (!cancelled) setNotice("Your place could not be saved on this device. Keep this tab open and try again."); },
    });
    // The book page shows this place on arrival, as it shows the sitting
    const unregisterLeave = bridge.registerLeave(() => queue.flush());
    const declineKey = `durtal-reader-declined:${ebook.id}:${deviceId ?? "new"}`;
    let declinedAt = 0;
    try {
      declinedAt = Number(localStorage.getItem(declineKey)) || 0;
    } catch {
      /* Storage can be disabled. */
    }
    // A place chosen on the eBook page is not followed by an offer of the places it was chosen over
    if (startPlace)
      for (const place of [otherPlace, ...(otherPlaces ?? [])])
        if (place) declinedAt = Math.max(declinedAt, Date.parse(place.clientUpdatedAt) || 0);
    const sync = createPlaceSync({
      own: devicePlace ?? ownPlace,
      other: devicePlace ? otherPlace : null,
      others: devicePlace ? otherPlaces : undefined,
      declinedAt,
      flush: () => queue.flush(),
      read: async () => {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Places unavailable");
        return (await res.json()).positions as ReaderPlace[];
      },
      offer: (place, further) => { setOffer(place); setFurthest(further ?? null); },
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
    const save = (
      locator: DurtalLocator,
      chapterLabel: string | null,
      clientUpdatedAt = resumeClock.current ?? new Date().toISOString(),
    ) => {
      if (samePlace(locator, saved)) return;
      saved = locator;
      queue.push({
        fileId: file.id,
        locator,
        chapter: chapterLabel,
        clientUpdatedAt,
      });
    };

    const timeout = setTimeout(() => {
      if (opened || cancelled) return;
      cancelled = true;
      startupAbort.abort();
      input.destroy();
      historyInput.destroy();
      engine?.destroy();
      setStatus({
        kind: "error",
        message: phase === "controllers"
          ? "A reader feature could not start. Try opening the book again."
          : "The file took too long to download. Check the connection.",
      });
    }, OPEN_TIMEOUT_MS);

    void (async () => {
      try {
        const engineModule = import("@/lib/reader/engines/foliate/engine");
        // Imports and the page's byte prefetch stay parallel with controller readiness.
        const [{ createFoliateEngine }, permit] = await Promise.all([
          engineModule, bridge.whenControllersReady(startupAbort.signal),
        ]);
        if (cancelled || startupAbort.signal.aborted) return;
        let admitted = permit;
        while (!bridge.isControllerPermitCurrent(admitted)) {
          admitted = await bridge.whenControllersReady(startupAbort.signal);
          if (cancelled || startupAbort.signal.aborted) return;
        }
        phase = "engine";
        input.attach(document);
        inputListening.current = true;
        historyInput.attach(document);
        const openingEngine = createFoliateEngine();
        openingEngine.setInsets?.(insetsRef.current);
        engine = openingEngine;
        engineRef.current = openingEngine;
        unregisterSelectionCapture = bridge.registerSelectionCapture((origin) => {
          if (cancelled || !opened || engineRef.current !== openingEngine) return null;
          const details = openingEngine.selectionDetails(origin);
          if (!details || details.locator.fileHash !== file.sha256) return null;
          const text = details.locator.text?.highlight ?? details.text.trim();
          if (!text) return null;
          return {
            selection: { text, locator: structuredClone(details.locator), fileId: file.id,
              chapter: details.locator.tocLabel ?? null, percent: readerPercent(details.locator) },
            clear: () => {
              if (!cancelled && opened && engineRef.current === openingEngine)
                openingEngine.clearSelection(details);
            },
          };
        });
        let latest: EngineEvents["relocate"] | null = null;
        engine.on("error", ({ message }) => {
          reported = true;
          setStatus({ kind: "error", message });
        });
        engine.on("capabilities", (capabilities) =>
          setCanSearch(capabilities.search),
        );
        engine.on("ready", (info) => {
          if (cancelled) return;
          setCanSearch(info.capabilities.search);
          const positions = new PositionIndex(
            info,
            readIndexCache(localStorageOrNull(), file.sha256),
          );
          indexRef.current = positions;
          setIndex(positions);
        });
        engine.on("document", ({ doc }) => {
          if (cancelled) return;
          input.attach(doc);
          historyInput.attach(doc);
        });
        engine.on("focus", ({ locator }) => {
          void navigationRef.current
            ?.focusTo(locator)
            .catch(() => setNotice("That focused text could not be shown."));
        });
        engine.on("link", ({ href, external, originMark }) => {
          if (!external) void navigate({ href }, "link", originMark);
        });
        engine.on("media", (value) => setMedia(value));
        engine.on("note", (value) => setNote(value));
        engine.on("selection", (selected) => {
          if (cancelled) return;
          // Preparing speech for a selection reads the whole section. Wait until
          // the selection stops changing: while handles are dragged it changes
          // every few frames, and the work made selecting on a phone stutter.
          if (speechSelectionTimer) clearTimeout(speechSelectionTimer);
          speechSelectionTimer = null;
          if (!selected) speechRef.current?.selection(null);
          else speechSelectionTimer = setTimeout(() => {
            speechSelectionTimer = null;
            if (!cancelled) speechRef.current?.selection(selected.locator);
          }, 500);
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
          speechRef.current?.relocate(relocation);
          setChapter(label);
          // Unrounded: the bar writes it with formatPercent, as every other view does (SLN-680)
          setPercent(locator.totalProgression * 100);
          bridge.update({
            locator,
            percent: readerPercent(locator),
            chapter: label,
          });
          if (
            reason === "layout" ||
            (relocation.origin && relocation.origin !== "human")
          ) {
            paceRef.current?.interrupt();
            if (opened && relocation.origin === "speech") {
              save(locator, label);
              sync.localPlace({
                deviceId: deviceId ?? "",
                deviceLabel: "Browser",
                thisDevice: true,
                fileId: file.id,
                locator,
                progression: locator.totalProgression,
                furthestProgression: locator.totalProgression,
                chapter: label,
                clientUpdatedAt: new Date().toISOString(),
              });
            }
            return;
          }
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
              clientUpdatedAt: resumeClock.current ?? new Date().toISOString(),
            };
            if (reason === "turn") {
              // A scroll lets the bars go too, as a turn does (above)
              if (relocation.activity === "scroll") releaseBars();
              sync.localTurn(local);
              setNotice(null);
              setPlaceFrom(null);
            } else sync.localPlace(local);
            save(locator, label);
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
          beforeHuman: () => speechRef.current?.beginNavigation(),
          afterHuman: () => speechRef.current?.navigationSettled(),
          changed: () => historyChanged((value) => value + 1),
          pushed: () => browserHistoryRef.current?.pushed(),
          interrupt: () => paceRef.current?.interrupt(),
          fatal: () =>
            setStatus({
              kind: "error",
              message:
                "The original page could not be restored. Reopen the book to continue.",
            }),
        });
        navigationRef.current = navigation;
        browserHistoryRef.current = createBrowserHistory({
          step: (direction) => {
            if (cancelled) return;
            void navigation
              .historyStep(direction)
              .catch(() => setNotice("That place could not be opened."));
          },
        });
        engine.on("relocate", (relocation) => {
          if (cancelled) return;
          latest = relocation;
          if (opened) navigation.relocate(relocation);
          else {
            setChapter(relocation.chapter);
            setPercent(relocation.locator.totalProgression * 100);
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
        let localPlace: DurtalLocator | null = null;
        let localMutation: PositionMutation | null = null;
        let localClientUpdatedAt: string | null = null;
        if (deviceId && !startPlace) {
          try {
            const local = await (await getReaderRuntime()).store.readPosition(
              [ebook.id, file.id, deviceId].map(id => id.toLowerCase()).join(":"));
            if (local?.latest.kind === "position" && local.latest.fileId === file.id &&
              local.latest.body.locator.fileHash === file.sha256 &&
              (!openingPlace || comparePositionTimes(local.latest.body.clientUpdatedAt, openingPlace.clientUpdatedAt) > 0))
              { localPlace = local.latest.body.locator; localClientUpdatedAt = local.latest.body.clientUpdatedAt; localMutation = local.latest; }
          } catch { /* Refused local storage leaves the online place available. */ }
        }
        if (cancelled || startupAbort.signal.aborted) return;
        const resumeAnchor = localPlace && localClientUpdatedAt && deviceId
          ? { deviceId, deviceLabel: openingPlace?.deviceLabel ?? "This device",
              fileId: file.id, locator: localPlace, chapter: localPlace.tocLabel ?? null,
              clientUpdatedAt: localClientUpdatedAt }
          : openingPlace;
        const resumeInput = { target: { id: file.id, sha256: file.sha256 }, anchor: resumeAnchor ?? null };
        while (!bridge.isControllerPermitCurrent(admitted)) {
          phase = "controllers";
          admitted = await bridge.whenControllersReady(startupAbort.signal);
          if (cancelled || startupAbort.signal.aborted) return;
        }
        phase = "engine";
        if (indexDiagnosticEnabled()) observeIndexDiagnostic("reader-engine-open-start");
        const initiallyOpened = await openReaderForContinue(resumeInput, engine, source, {
          container,
          presentation: presentationRef.current!,
        });
        if (indexDiagnosticEnabled()) observeIndexDiagnostic("reader-engine-open-return");
        if (cancelled || startupAbort.signal.aborted) return;
        while (!bridge.isControllerPermitCurrent(admitted)) {
          phase = "controllers";
          admitted = await bridge.whenControllersReady(startupAbort.signal);
          if (cancelled || startupAbort.signal.aborted) return;
        }
        if (resumeAnchor && indexDiagnosticEnabled()) observeIndexDiagnostic("reader-resume-start");
        const resumed = resumeAnchor
          ? await resolveContinueAnchor(
              resumeInput,
              {
                resolve: (locator) => openingEngine.resolve(locator),
                currentLocator: () => openingEngine.currentLocator(),
                goTo: async (target) => {
                  while (!bridge.isControllerPermitCurrent(admitted)) {
                    admitted = await bridge.whenControllersReady(startupAbort.signal);
                  }
                  if (cancelled || startupAbort.signal.aborted)
                    throw new DOMException("Reader startup cancelled", "AbortError");
                  await openingEngine.goTo(target);
                },
              },
              initiallyOpened,
            )
          : null;
        if (resumeAnchor && indexDiagnosticEnabled()) observeIndexDiagnostic("reader-resume-return");
        if (cancelled || startupAbort.signal.aborted) return;
        while (!bridge.isControllerPermitCurrent(admitted)) {
          admitted = await bridge.whenControllersReady(startupAbort.signal);
          if (cancelled || startupAbort.signal.aborted) return;
        }
        opened = true;
        clearTimeout(timeout);
        setStatus({ kind: "ready" });
        // A reopen lines up its spread with the text hidden: the opening line
        // stays over the empty page until the text shows, adding no wait
        const textShows = () => {
          if (cancelled) return;
          if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setOpeningLine("gone");
          setOpeningLine("fading");
          openingLineTimer = setTimeout(() => setOpeningLine("gone"), 150);
        };
        // Without motion, text already showing takes the line away in the
        // same render as ready; else it fades out with the text's fade in
        if (!engine.whenTextShows || (matchMedia("(prefers-reduced-motion: reduce)").matches && !engine.textHidden?.()))
          setOpeningLine("gone");
        else void engine.whenTextShows(startupAbort.signal).then(textShows);
        // A first open, or a place found again another way: save where the book opened
        const landing = latest as EngineEvents["relocate"] | null;
        // One short line, and none when a link opened the book at a mark (SLN-686)
        const fromOther = startPlace ? (startPlace.thisDevice ? null : startPlace) : !localPlace && !devicePlace ? otherPlace : null;
        if (fromOther && !openAt) {
          setPlaceFrom(fromOther.deviceLabel);
          noticeTimer = setTimeout(() => setPlaceFrom(null), 4000);
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
            clientUpdatedAt: resumeAnchor?.clientUpdatedAt ?? new Date().toISOString(),
          });
          bridge.update({
            locator: landing.locator,
            percent: readerPercent(landing.locator),
            chapter: landing.chapter,
          });
          bridge.bus.location({ ...landing, fileId: file.id, kind: "jump" });
        }
        if (landing && isExactLocalOpeningPosition(localMutation, {
          fileId: file.id, locator: landing.locator, chapter: landing.chapter,
          clientUpdatedAt: resumeAnchor?.clientUpdatedAt,
        }, { ebookId: ebook.id, fileId: file.id, fileHash: file.sha256, deviceId },
          resumed?.status === "exact")) {
          // The durable original already describes this landing. Seed only the
          // session's unchanged-place guard; keep its operation and replay intact.
          saved = landing.locator;
        } else if (
          landing &&
          (!resumeAnchor || resumeAnchor.deviceId === deviceId) &&
          (!ownPlace ||
            resumed?.status !== "exact" ||
            resumeAnchor?.fileId !== file.id)
        )
          // A book's first open with no place anywhere is saved now, under
          // this moment: it is a real open, and it marks the book opened
          // (SLN-683). This device's own place, found again in another or a
          // changed file, keeps its own clock
          save(landing.locator, landing.chapter, resumeAnchor?.clientUpdatedAt);
        // Opening at another device's place saves nothing for this device
        // until the reader moves: a row under that place's clock would show a
        // device that never read there (SLN-665)
        else if (landing) saved = landing.locator;
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
          ...(engine.speech() && engine.prepareSpeech ? ["a", ",", "."] : []),
          ...(document.fullscreenEnabled ? ["f"] : []),
        ]);
        // Wait for first paint, then load speech and prepare real text in a bounded idle task.
        if (engine.speech() && engine.prepareSpeech) {
          requestAnimationFrame(() => {
            if (cancelled) return;
            const load = () => {
              if (cancelled) return;
              void import("@/lib/reader/speech/session")
                .then(({ createReaderSpeech }) => {
                  if (
                    cancelled ||
                    !engine ||
                    !window.speechSynthesis ||
                    !window.SpeechSynthesisUtterance
                  )
                    return;
                  speechRef.current = createReaderSpeech({
                    engine,
                    navigation,
                    bookLanguage:
                      ebook.language ?? indexRef.current?.info.language ?? null,
                    synthesis: window.speechSynthesis,
                    Utterance: window.SpeechSynthesisUtterance,
                    document,
                    storage: localStorageOrNull(),
                    changed: setSpeech,
                    audio: new Audio(),
                    fetch: (...args) => window.fetch(...args),
                  });
                  if (selectionRef.current)
                    speechRef.current.selection(selectionRef.current.locator);
                  else speechRef.current.prepare();
                })
                .catch(() => {
                  /* Reader remains usable when the speech chunk fails. */
                });
            };
            if (window.requestIdleCallback)
              window.requestIdleCallback(load, { timeout: 1000 });
            else setTimeout(load, 0);
          });
        }
        const indexDiagnostics = indexDiagnosticEnabled();
        let indexing = false;
        postponeIndex = () => {
          if (indexing || cancelled) return;
          if (indexTimer) clearTimeout(indexTimer);
          if (indexDiagnostics) observeIndexDiagnostic("index-timer-scheduled");
          indexTimer = setTimeout(() => {
            if (indexDiagnostics) observeIndexDiagnostic("index-timer-fired");
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
              if (indexDiagnostics) observeIndexDiagnostic("index-generator-start", () => ({ hrefCount: hrefs.length }));
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
              if (indexDiagnostics) observeIndexDiagnostic("index-generator-complete");
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
              if (indexDiagnostics) observeIndexDiagnostic("index-publish-requested", () => ({ complete: updated.complete }));
            })().catch((error: unknown) => {
              if (indexDiagnostics) observeIndexDiagnostic("index-flow-error", () => ({ errorName: error instanceof Error ? error.name : "NonError", errorCode: "INDEX_FLOW_ERROR" }));
              /* Immediate section positions remain usable if indexing fails. */
            });
          }, 2000);
        };
        postponeIndex();
      } catch (error) {
        if (cancelled) return;
        cancelled = true;
        startupAbort.abort();
        input.destroy();
        historyInput.destroy();
        engine?.destroy();
        clearTimeout(timeout);
        // The engine says what kind of failure it was; this is for the rest
        if (!reported)
          setStatus({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "The file is damaged or not a valid eBook.",
          });
      }
    })();

    return () => {
      cancelled = true;
      startupAbort.abort();
      unregisterSelectionCapture();
      unsubscribeReadiness();
      if (recoveryTimeout) clearTimeout(recoveryTimeout);
      if (speechSelectionTimer) clearTimeout(speechSelectionTimer);
      clearTimeout(timeout);
      if (noticeTimer) clearTimeout(noticeTimer);
      if (openingLineTimer) clearTimeout(openingLineTimer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      sync.destroy();
      syncRef.current = null;
      unregisterLeave();
      queue.destroy();
      indexAbort.abort();
      if (indexTimer) clearTimeout(indexTimer);
      unregisterShortcuts();
      historyInput.destroy();
      navigationRef.current?.destroy();
      navigationRef.current = null;
      browserHistoryRef.current?.destroy();
      browserHistoryRef.current = null;
      paceRef.current?.interrupt();
      input.destroy();
      inputListening.current = false;
      speechRef.current?.destroy();
      speechRef.current = null;
      engine?.destroy();
      engineRef.current = null;
    };
    // A new file or a retry opens the book again; the place is read once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, preferences.ready]);

  // What stands at the foot of the screen under the speech player: the
  // bottom bar, or search's results bar in its place
  const bottomShown = bars.visible && !searchBarHeight;
  const footHeight = bottomShown ? bottomHeight : searchBarHeight;
  useEffect(() => {
    const frame = bookRef.current;
    if (frame)
      frame.style.bottom = `${speechHeight ? speechHeight + footHeight : 0}px`;
  }, [speechHeight, footHeight]);
  // On a wide screen the book stands beside an open drawer, never under it;
  // the book keeps its place as it reflows (SLN-728)
  useEffect(() => subscribeReaderPanelInset(({ left, right }) => {
    const frame = bookRef.current;
    if (!frame) return;
    frame.style.left = `${left}px`;
    frame.style.right = `${right}px`;
  }), []);
  useEffect(() => {
    insetsRef.current = insets;
    engineRef.current?.setInsets?.(insets);
  }, [insets]);
  // A page turn in the scroll flow keeps its line clear of what lies over
  // the text once the turn has hidden the bars: the chapter band and the
  // top fade (kept bars already stand outside the book)
  useEffect(() => {
    const band = document.querySelector<HTMLElement>("[data-reader-quiet-chapter]");
    coveredRef.current = quiet && {
      top: quiet.topFade ? QUIET_TOP_FADE_PX : 0,
      bottom: band?.offsetHeight ?? 0,
    };
    engineRef.current?.setCovered?.(coveredRef.current ?? { top: 0, bottom: 0 });
  }, [quiet, chapter, status.kind]);
  useEffect(() => {
    const bottom = document.querySelector<HTMLElement>(
      "[data-reader-bottom-bar]",
    );
    const top = document.querySelector<HTMLElement>("[data-reader-top-bar]");
    if (!bottom || !top) return;
    const measure = () => {
      setBottomHeight(bottom.getBoundingClientRect().height);
      setTopHeight(top.getBoundingClientRect().height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bottom);
    observer.observe(top);
    return () => observer.disconnect();
  }, []);

  const pick = useCallback(
    (href: string) => navigate({ href }, "contents"),
    [navigate],
  );

  useEffect(() => { if (annotations.held) bars.show(); }, [annotations.held, bars.show]);

  /** Leaves for `href` once the place and the open sitting are saved */
  const leave = useCallback((href: string) => {
    // Back through history only to the page the link names (SLN-683), so a
    // click goes where the link says; history keeps that page's scroll
    let from: URL | null = null;
    try {
      from = document.referrer ? new URL(document.referrer) : null;
    } catch {
      from = null;
    }
    const target = new URL(href);
    if (
      from &&
      from.origin === window.location.origin &&
      !READER_PAGE_RE.test(from.pathname) &&
      from.pathname === target.pathname &&
      from.search === target.search &&
      window.history.length > 1
    )
      // Past the in-book jumps the browser holds, to the page before the reader
      void bridge.leave().then(() => window.history.go(-1 - (browserHistoryRef.current?.depth ?? 0)));
    // The open sitting reaches the server first, so the book page is current (SLN-677)
    else void bridge.leave().then(() => window.location.assign(href));
  }, [bridge]);

  const onBack = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window keeps the link's own behaviour
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    leave(event.currentTarget.href);
  }, [leave]);

  // The other device's place, through the same resolve as opening (newest or furthest)
  const goToPlace = (target: ReaderPlace) => {
    if (!file) return;
    syncRef.current?.dismiss();
    const engine = engineRef.current;
    if (!engine) return;
    const before = engine.currentLocator();
    void resolveContinueAnchor(
      {
        target: { id: file.id, sha256: file.sha256 },
        anchor: target,
      },
      {
        resolve: (locator) => engine.resolve(locator),
        currentLocator: () => engine.currentLocator(),
        goTo: async (locator) => {
          if (engine.currentLocator() !== before)
            throw new Error(
              "Your place changed while locating the saved passage.",
            );
          resumeClock.current = target.clientUpdatedAt;
          try {
            if (!(await navigate(locator, "resume")))
              throw new Error(
                "Your saved place could not be opened.",
              );
          } finally {
            resumeClock.current = null;
          }
        },
      },
    ).catch((error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : "Your saved place could not be opened.",
      ),
    );
  };

  const overlay =
    !preferences.ready && (preferences.error || preferencesTimedOut) ? (
      <OpenError message={preferences.error ?? "Reading settings took too long to load. Try opening the book again."} ebookId={ebook.id} backHref={backHref} alternatives={alternatives}
        onRetry={() => { if (preferencesTimedOut) window.location.reload(); else void preferences.flush(); }} />
    ) : status.kind === "error" ? (
      <OpenError
        title={file ? undefined : "This eBook cannot be read here"}
        message={status.message}
        onRetry={file ? onRetry : undefined}
        alternatives={alternatives}
        ebookId={ebook.id}
        backHref={backHref}
      />
    ) : status.kind === "opening" || (status.kind === "ready" && openingLine !== "gone") ? (
      <p
        role={openingLine === "fading" ? undefined : "status"}
        aria-hidden={openingLine === "fading" || undefined}
        className={`absolute inset-0 flex items-center justify-center text-sm text-fg-secondary transition-opacity duration-150 ${status.kind === "ready" ? "pointer-events-none" : ""} ${openingLine === "fading" ? "opacity-0" : ""}`}
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
      topBar={
        <ReaderToolbar
          bookmarkAction={annotations.bookmark}
          theme={settings.theme}
          onTheme={(theme) => {
            if (!preferences.ready) return;
            try { preferences.update({ deviceClass: preferenceClass, ebookId: presentationFieldScope("theme", preferenceClass, preferences.rows), presentation: { theme } }); }
            catch (error) { setNotice(error instanceof Error ? error.message : "The page colour could not be changed."); }
          }}
          onMenuChange={setBarMenuOpen}
          annotationActions={annotations.toolbar}
          fixedControls={status.kind === "ready" && engineRef.current?.fixedPages?.() != null && <FixedLayoutControls
            engine={engineRef.current!} onHeldChange={setFixedControlsOpen} enabled={controllerReadiness.ready} isAdmitted={() => preferences.ready && bridge.getControllerReadinessSnapshot().ready} fit={settings.fixedFit} onPick={href => navigate({ href }, "goto")}
            onFit={fixedFit => { if (!preferences.ready || !bridge.getControllerReadinessSnapshot().ready) return; try { preferences.update({ deviceClass: preferenceClass, ebookId: presentationFieldScope("fixedFit", preferenceClass, preferences.rows), presentation: { fixedFit } }); } catch (error) { setNotice(error instanceof Error ? error.message : "Fit could not be changed."); } }} />}
          offlineAction={file ? <DownloadButton ebook={ebook} file={file} deviceId={deviceId} notice={setNotice} /> : undefined}
          onSearch={canSearch ? () => { paceRef.current?.interrupt(); setSearchMounted(true); setSearchOpen(true); } : undefined}
          speechControl={
            speech &&
            !speech.open && (
              <Suspense fallback={null}>
                <SpeechStart
                  ready
                  onStart={() => speechRef.current?.toggle()}
                />
              </Suspense>
            )
          }
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
      }
      edges={status.kind === "ready" && (
        <PageEdges
          visible={bars.visible}
          hovered={bars.edge}
          dir={index?.info.dir ?? "ltr"}
          onLeft={() => actions.current?.left()}
          onRight={() => actions.current?.right()}
        />
      )}
      bottomBar={
        <ReaderBottomBar
          visible={bottomShown}
          chapter={chapter}
          percent={percent}
          bridge={bridge}
          index={index}
          locator={relocation?.locator}
          linear={relocation?.linear}
          quiet={quiet}
          placeFrom={placeFrom}
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
      }
      player={
        speech && (
          <Suspense fallback={null}>
            <SpeechControls
              open={speech.open}
              state={speech.state}
              voices={speech.voices}
              preferences={speech.preferences}
              voiceNotice={speech.voiceNotice}
              bookLanguage={ebook.language ?? index?.info.language ?? null}
              bottomInset={footHeight}
              onAction={(action) => {
                speechRef.current?.action(action);
                if (action.kind === "stop") {
                  bars.show();
                  queueMicrotask(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        'button[aria-label="Read aloud"]',
                      )
                      ?.focus({ preventScroll: true }),
                  );
                }
              }}
              onPreferences={(next) => speechRef.current?.preferences(next)}
              onHeightChange={setSpeechHeight}
            />
          </Suspense>
        )
      }
      skipLink={
        status.kind === "ready" && (
          <SkipToBook
            onSkip={() => {
              bars.show();
              engineRef.current?.focusBook?.();
            }}
          />
        )
      }
    >
      {annotations.overlays}
      <ReaderAnnouncer
        location={relocation}
        speechPhase={speech?.state.phase ?? "stopped"}
      />
      <ReaderNotice bridge={bridge}>
        {notice ??
          (offer && file ? (
            <div className="flex flex-wrap items-start gap-2">
              {/* Padded to the buttons' height, so a wrapped line keeps its first line centred on them;
                  on a phone the buttons take a row of their own, on the right. */}
              <p className="min-w-0 flex-1 basis-64 py-1 [@media(pointer:coarse)]:py-2.5">
                {resumeNoticeText(offer, file.id, relocation?.locator ?? null, index)}
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  aria-label="Go to the newer place"
                  data-tooltip="Go to the newer place"
                  className="h-8 rounded-sm px-2 hover:bg-bg-tertiary [@media(pointer:coarse)]:min-h-11"
                  onClick={() => goToPlace(offer)}
                >
                  Go there
                </button>
                {furthest && <button
                  type="button"
                  aria-label={`Go to your furthest place, ${resumePlaceLabel(furthest, file.id, index)} on ${furthest.deviceLabel}`}
                  data-tooltip="Go to your furthest place"
                  className="h-8 rounded-sm px-2 hover:bg-bg-tertiary [@media(pointer:coarse)]:min-h-11"
                  onClick={() => goToPlace(furthest)}
                >
                  Furthest
                </button>}
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
            </div>
          ) : sync.paused ? (
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 basis-64 py-1 [@media(pointer:coarse)]:py-2.5">
                Sync paused. Your places and highlights are kept on this device until it resumes.
              </p>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  aria-label="Retry sync"
                  data-tooltip="Retry sync"
                  disabled={sync.retrying}
                  className="h-8 rounded-sm px-2 hover:bg-bg-tertiary disabled:text-fg-muted [@media(pointer:coarse)]:min-h-11"
                  onClick={() => void sync.retry()}
                >
                  {sync.retrying ? "Retrying" : "Retry"}
                </button>
              </div>
            </div>
          ) : null)}
      </ReaderNotice>
      <SelectionToolbar
        ref={selectionToolbarRef}
        selection={selection}
        bridge={bridge}
        onClear={() => engineRef.current?.clearSelection()}
        onReadAloud={
          speech ? () => {
            const selected = bridge.captureSelection();
            if (selected) speechRef.current?.startSelection(selected.locator);
          } : undefined
        }
        markingActions={annotations.markingActions}
        speechReady={speech?.selectionReady}
        bottomInset={speechHeight + footHeight}
        topInset={bars.visible ? topHeight : 0}
        covered={lookupSheet}
      />
      {status.kind === "ready" && engineRef.current && <LookupLayer
        engine={engineRef.current} ebook={ebook} toolbarRef={selectionToolbarRef}
        enabled={controllerReadiness.ready && preferences.ready}
        onSheet={setLookupSheet}
      />}
      <Suspense fallback={null}>
        {index && contentsOpen && (
          <ContentsPanel
            open={contentsOpen}
            onClose={() => setContentsOpen(false)}
            index={index}
            current={
              relocation?.tocItem ??
              (relocation
                ? index.chapterAt(index.startFraction(relocation.locator))
                : null)
            }
            onPick={pick}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {canSearch && searchMounted && engineRef.current && (
          <SearchPanel
            open={searchOpen}
            engine={engineRef.current}
            places={index}
            language={ebook.language ?? null}
            onClose={() => setSearchOpen(false)}
            onOpen={() => setSearchOpen(true)}
            escapeRef={searchEscapeRef}
            onDockHeight={setSearchBarHeight}
            onJump={async (locator, hit) => {
              if (hit.inNote) {
                const href = hit.noteHref ?? locator.cfi ?? locator.href;
                const reference = engineRef.current?.noteReference?.(href);
                if (reference) await navigate(reference, "search");
                if (
                  await engineRef.current?.showNote?.(href, {
                    force: true,
                    keyboard: true,
                  })
                )
                  return true;
              }
              return navigate(locator, "search");
            }}
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
        {leaveOpen && (
          <LeavePrompt
            onStay={() => setLeaveOpen(false)}
            onLeave={() => leave(new URL(backHref, window.location.href).href)}
          />
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
      <Suspense fallback={null}>
        {note && engineRef.current && (
          <NotePopover
            note={note}
            engine={engineRef.current}
            onNavigate={(href, source, originMark) =>
              navigate({ href }, source, originMark)
            }
            onClose={() => engineRef.current?.closeNote?.()}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {media && (
          <ContentViewer
            key={media.kind}
            media={media}
            onClose={() => setMedia(null)}
          />
        )}
      </Suspense>
      <PresentationSettingsDialog
        sheet
        kind={file?.format === "pdf" ? "pdf" : index?.info.layout === "pre-paginated" ? "fixed" : "reflowable"}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        presentation={settings}
        deviceClass={preferenceClass} error={preferences.error} saving={preferences.saving}
        pending={preferences.pending} recoveryError={preferences.recoveryError}
        onChange={(patch, scope) => {
          try { preferences.update({ deviceClass: preferenceClass, ebookId: scope === "book" ? ebook.id : null,
            presentation: patch, ...(scope === "defaults" ? { clearBookOverrideId: ebook.id } : {}) }); }
          catch (error) { setNotice(error instanceof Error ? error.message : "That setting could not be changed."); }
        }}
        onReset={scope => {
          try { preferences.reset({ deviceClass: preferenceClass, ebookId: scope === "book" ? ebook.id : null }); }
          catch (error) { setNotice(error instanceof Error ? error.message : "Settings could not be reset."); }
        }}
        onRetry={() => { void preferences.flush(); }}
      />
    </ReaderShell>
  );
}
