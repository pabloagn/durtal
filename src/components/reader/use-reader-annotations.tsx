"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnnotationConflicts } from "./annotation-conflicts";
import { BookMarked, Highlighter, NotebookPen } from "lucide-react";
import { useReaderFeatureShortcut } from "./bridge";
import { ReaderBarItem } from "./reader-bar-item";
import { BookmarkButton } from "./bookmark-button";
import { AnnotationSwatches } from "./annotation-swatches";
import { AnnotationsPanel } from "./annotations-panel";
import { HighlightMenu } from "./highlight-menu";
import { NoteDialog } from "./note-dialog";
import { createAnnotationController, type AnnotationController, type AnnotationControllerSnapshot } from "@/lib/reader/annotation-controller";
import type { ReaderBridgeController } from "@/lib/reader/bridge-state";
import type { DurtalLocator, EngineEvents, ReaderEngine } from "@/lib/reader/engine";
import type { AnnotationColor, ReaderAnnotation } from "@/lib/reader/annotations";
import type { AnnotationExportBook } from "@/lib/reader/export";
import { getReaderRuntime } from "@/lib/reader/offline/runtime";
import { sharedAnnotationTransport } from "@/lib/reader/sync/annotation-codec";
import { subscribeAnnotationServerChanges } from "@/lib/reader/annotation-server-changes";
import type { ReaderSelection } from "@/lib/reader/events";
import { markOnPassage } from "@/lib/reader/same-mark";
import { MARK_ACTION } from "./selection-toolbar";

/** A selection taken for a mark, with the reader generation it belongs to */
interface Captured {
  controller: AnnotationController;
  engine: ReaderEngine;
  binding: { controller: AnnotationController; engine: ReaderEngine; fileId: string; deviceId: string };
  selected: ReaderSelection;
}

const EMPTY: AnnotationControllerSnapshot = { annotations: [], pending: [], conflicts: [], cursor: null, loaded: false, error: null };
const sameAnchor = (a: DurtalLocator, b: DurtalLocator) => a.fileHash === b.fileHash &&
  (a.pdf || b.pdf ? a.pdf?.page === b.pdf?.page : !!a.cfi && a.cfi === b.cfi);

/** One committed reader generation over the origin's existing shared replayer. */
export function useReaderAnnotations(input: {
  book: AnnotationExportBook;
  fileId: string | null;
  deviceId: string | null;
  engine: ReaderEngine | null;
  painted: boolean;
  bridge: ReaderBridgeController;
  selection: EngineEvents["selection"];
  locator: DurtalLocator | null;
  palette: { fills: Record<AnnotationColor, string>; quote: string };
  onJump(locator: DurtalLocator): Promise<boolean>;
  onNotice(message: string): void;
  /** A mark to jump to once, after the book is painted and its marks load (`?at=`) */
  openAt?: string | null;
  /** Pages are pictures (a comic): only bookmarks apply (SLN-682) */
  imagesOnly?: boolean;
}) {
  const { engine, painted, fileId, deviceId, bridge } = input;
  const ebookId = input.book.id;
  const owner = useRef<AnnotationController | null>(null);
  const ownerBinding = useRef<{ controller: AnnotationController; engine: ReaderEngine; fileId: string; deviceId: string } | null>(null);
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<EngineEvents["annotation-activated"] | null>(null);
  const [editedNote, setEditedNote] = useState<ReaderAnnotation | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [draft, setDraft] = useState<Captured | null>(null);
  useEffect(() => {
    if (!engine || !painted || !fileId || !deviceId) return;
    let cancelled = false;
    let controller: AnnotationController | null = null;
    let unsubscribe = () => {};
    let unsubscribeServerChanges = () => {};
    const offActivation = engine.on("annotation-activated", event => {
      if (!cancelled && event.group === "annotations") setActive(event);
    });
    void getReaderRuntime().then(runtime => {
      if (cancelled) return;
      controller = createAnnotationController({ ebookId, fileId, deviceId, engine,
        transport: sharedAnnotationTransport(runtime), deletion: bridge.annotationDeletes,
        palette: () => latest.current.palette,
        onError: () => { if (!cancelled) latest.current.onNotice("Your mark could not be saved. Keep this tab open and try again."); },
      });
      owner.current = controller;
      ownerBinding.current = { controller, engine, fileId, deviceId };
      const committedOwner = controller;
      unsubscribeServerChanges = subscribeAnnotationServerChanges(ebookId, async () => {
        if (!cancelled && owner.current === committedOwner) await committedOwner.serverChanged();
      });
      const update = () => { if (!cancelled && controller) setSnapshot(controller.getSnapshot()); };
      unsubscribe = controller.subscribe(update);
      update();
      controller.firstPaint();
    }).catch(() => {
      if (!cancelled) latest.current.onNotice("Highlights are unavailable because this device could not open its saved data.");
    });
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeServerChanges();
      offActivation();
      controller?.destroy();
      if (owner.current === controller) { owner.current = null; ownerBinding.current = null; }
    };
  }, [ebookId, fileId, deviceId, engine, painted, bridge]);
  useEffect(() => { owner.current?.repaint(); }, [input.palette]);
  const ready = !!engine && painted && snapshot.loaded && !!deviceId;
  const admitted = () => !!owner.current && bridge.getControllerReadinessSnapshot().ready;
  const controllersReady = useSyncExternalStore(bridge.subscribeControllerReadiness,
    () => bridge.getControllerReadinessSnapshot().ready, () => false);
  const openedAt = useRef<string | null>(null);
  useEffect(() => {
    const target = input.openAt;
    if (!target || openedAt.current === target || !ready || !controllersReady || !engine || !owner.current) return;
    const mark = snapshot.annotations.find(item => item.id === target && !item.deletedAt);
    // A fresh device has no local marks until the first server sync sets the cursor
    if (!mark && snapshot.cursor === null) return;
    openedAt.current = target;
    const unplaced = "That mark could not be placed in this file. It is still listed under Highlights and notes.";
    if (!mark) { latest.current.onNotice("That mark is no longer in this book."); return; }
    if (mark.anchorState === "orphaned") { latest.current.onNotice(unplaced); return; }
    void engine.resolveAnnotation(mark).then(async result => {
      if (latest.current.engine !== engine || !result.locator || !["exact", "healed"].includes(result.status)
        || !await latest.current.onJump(result.locator)) latest.current.onNotice(unplaced);
    }).catch(() => latest.current.onNotice(unplaced));
  }, [input.openAt, ready, controllersReady, engine, snapshot.annotations, snapshot.cursor]);
  const perform = (work: Promise<unknown>) => { void work.catch(error => input.onNotice(error instanceof Error ? error.message : "That mark could not be saved.")); };
  /** The selection, with the reader generation it was made in, or null when it cannot be marked */
  const capture = (origin?: Document): Captured | null => {
    const controller = owner.current;
    const capturedEngine = latest.current.engine;
    const binding = ownerBinding.current;
    const selected = bridge.captureSelection(origin);
    if (!admitted() || !controller || !capturedEngine || !selected || selected.fileId !== latest.current.fileId ||
      binding?.controller !== controller || binding.engine !== capturedEngine || binding.fileId !== selected.fileId ||
      binding.deviceId !== latest.current.deviceId) return null;
    return { controller, engine: capturedEngine, binding, selected };
  };
  const stillCurrent = (captured: Captured) => owner.current === captured.controller &&
    ownerBinding.current === captured.binding && latest.current.engine === captured.engine;
  /** The mark already on the selected words: a second mark there changes it instead (SLN-682) */
  const marked = (captured: Captured) =>
    markOnPassage(captured.controller.getSnapshot().annotations, captured.selected.fileId, captured.selected.locator);
  /** No `color` (Underline) keeps the colour of a mark already on the words */
  const create = async (color?: AnnotationColor, style: "highlight" | "underline" = "highlight", origin?: Document) => {
    const captured = capture(origin);
    if (!captured) return;
    const { controller, selected } = captured;
    const existing = marked(captured);
    if (existing) {
      bridge.clearCapturedSelection(selected);
      if (existing.style === "quote") input.onNotice("These words are already a quote.");
      else if ((color && existing.color !== color) || existing.style !== style) await controller.edit(existing.id, color ? { color, style } : { style });
      return;
    }
    await controller.createHighlight({ text: selected.text, locator: selected.locator,
      chapter: selected.locator.tocLabel ?? null, color: color ?? "ochre", style });
    if (!stillCurrent(captured) || !bridge.isSelectionCaptureCurrent(selected)) return;
    bridge.clearCapturedSelection(selected);
  };
  /** Note on a selection: the mark is made only when the note is saved */
  const startNote = (origin?: Document) => {
    const captured = capture(origin);
    if (!captured) return;
    const existing = marked(captured);
    if (existing) {
      bridge.clearCapturedSelection(captured.selected);
      setEditedNote(existing);
    } else setDraft(captured);
  };
  const saveDraft = async (captured: Captured, note: string | null) => {
    if (!note?.trim()) return;
    if (!admitted() || !stillCurrent(captured)) throw new Error("This reader is no longer ready to save the note.");
    const { controller, selected } = captured;
    // Saved once already (the page was hidden, then shown again): the note goes on that mark
    const existing = marked(captured);
    if (existing) await controller.edit(existing.id, { note });
    else await controller.createHighlight({ text: selected.text, locator: selected.locator,
      chapter: selected.locator.tocLabel ?? null, color: "ochre", note });
    bridge.clearCapturedSelection(selected);
  };
  const remove = async (annotation: ReaderAnnotation) => {
    const controller = owner.current;
    if (!admitted() || !controller) return;
    const operationId = await controller.delete(annotation.id);
    if (owner.current !== controller || !operationId) return;
    setActive(null);
    setUndo(operationId);
  };
  const bookmark = snapshot.annotations.find(item => item.kind === "bookmark" && !item.deletedAt &&
    item.fileId === fileId && !!input.locator && sameAnchor(item.locator, input.locator));
  const toggleBookmark = async () => {
    const controller = owner.current;
    const locator = latest.current.locator;
    if (!admitted() || !controller || !locator) return;
    if (bookmark) await remove(bookmark);
    else await controller.createBookmark({ locator, chapter: locator.tocLabel ?? null });
  };
  const showPanel = () => setOpen(true);
  useReaderFeatureShortcut("b", 11, () => perform(toggleBookmark()), ready);
  useReaderFeatureShortcut("h", 11, showPanel, ready);
  const origin = (event: KeyboardEvent) => event.currentTarget === document ? undefined : event.currentTarget as Document;
  useReaderFeatureShortcut("1", 11, event => perform(create("ochre", "highlight", origin(event))), ready);
  useReaderFeatureShortcut("2", 11, event => perform(create("sage", "highlight", origin(event))), ready);
  useReaderFeatureShortcut("3", 11, event => perform(create("slate", "highlight", origin(event))), ready);
  useReaderFeatureShortcut("4", 11, event => perform(create("rose", "highlight", origin(event))), ready);
  useReaderFeatureShortcut("5", 11, event => perform(create("violet", "highlight", origin(event))), ready);
  useReaderFeatureShortcut("n", 11, event => startNote(origin(event)), ready);
  const activated = snapshot.annotations.find(item => item.id === active?.decorationId && !item.deletedAt);
  const edit = (item: ReaderAnnotation, patch: { color?: AnnotationColor; style?: "highlight" | "underline" }) => {
    if (admitted() && owner.current) perform(owner.current.edit(item.id, patch));
  };
  const panelName = input.imagesOnly ? "Bookmarks" : "Highlights and notes";
  return {
    held: open || !!active || !!editedNote || !!draft,
    bookmark: <BookmarkButton active={!!bookmark} disabled={!ready} onToggle={() => perform(toggleBookmark())} />,
    // A comic's panel holds only bookmarks, so its button says so (SLN-682)
    toolbar: <ReaderBarItem
      label={`${panelName}${snapshot.conflicts.length || snapshot.problems?.length ? ": changes need attention" : ""}`}
      tooltip={panelName} keys="h" disabled={!ready} onSelect={showPanel}
      icon={input.imagesOnly ? <BookMarked className="h-4 w-4" strokeWidth={1.5} /> : <Highlighter className="h-4 w-4" strokeWidth={1.5} />} />,
    markingActions: ready ? <>
      <AnnotationSwatches onPick={color => perform(create(color))} />
      {/* On touch the one-row toolbar has room only for icons: Underline waits behind More (SLN-678) */}
      <button type="button" data-tooltip="Underline" onClick={() => perform(create(undefined, "underline"))}
        className={`${MARK_ACTION} pointer-coarse:hidden`}>
        Underline
      </button>
      <button type="button" aria-label="Add a note" data-tooltip="Add a note" data-tooltip-keys="n" onClick={() => startNote()}
        className={`${MARK_ACTION} pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:px-0`}>
        <span className="pointer-coarse:hidden">Note</span>
        <NotebookPen aria-hidden className="hidden h-4 w-4 pointer-coarse:block" strokeWidth={1.5} />
      </button>
    </> : undefined,
    /** Behind More on touch */
    markingMore: ready ? <button type="button" data-tooltip="Underline" onClick={() => perform(create(undefined, "underline"))}
      className={MARK_ACTION}>Underline</button> : undefined,
    overlays: <>
      {open && <AnnotationsPanel open onClose={() => setOpen(false)} book={input.book} annotations={snapshot.annotations} imagesOnly={input.imagesOnly}
        conflictContent={<AnnotationConflicts snapshot={snapshot} onRefresh={async () => { if (admitted()) await owner.current?.pull(); }} onRetry={async (id,revision) => admitted() ? await owner.current?.retryBlocked(id,revision) ?? false : false} />}
        onPick={async item => {
          if (!admitted() || !engine || item.anchorState === "orphaned") return false;
          const result = await engine.resolveAnnotation(item);
          if (!admitted() || latest.current.engine !== engine || !result.locator || !["exact", "healed"].includes(result.status)) return false;
          return input.onJump(result.locator);
        }} onNote={item => setEditedNote(item)} onEdit={edit} onDelete={item => perform(remove(item))} />}
      {active && activated && <HighlightMenu annotation={activated} rect={active.rect} onClose={() => setActive(null)}
        onEdit={patch => edit(activated, patch)} onNote={() => { setActive(null); setEditedNote(activated); }} onDelete={() => perform(remove(activated))} />}
      {draft && <NoteDialog draft note={null} passage={draft.selected.text} onClose={() => setDraft(null)}
        onSave={note => saveDraft(draft, note)} />}
      {editedNote && <NoteDialog key={editedNote.id} note={editedNote.note} passage={editedNote.text} onClose={() => setEditedNote(null)}
        onSave={async note => {
          if (!admitted() || !owner.current) throw new Error("This reader is no longer ready to save the note.");
          await owner.current.edit(editedNote.id, { note });
        }} />}
      {undo && snapshot.pending.some(item => item.operationId === undo) && <div role="status" data-reader-chrome
        className="glass fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-3 py-2 text-sm">
        <span>Mark deleted</span><button type="button" className="rounded-sm px-2 py-1 hover:bg-bg-tertiary" onClick={() => {
          if (admitted() && owner.current) perform(owner.current.undo(undo).then(undone => { if (!undone) input.onNotice("This deletion has already been sent and cannot be undone here."); setUndo(null); }));
        }}>Undo</button>
      </div>}
    </>,
  };
}
