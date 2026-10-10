"use client";

import { useEffect, useRef, useState } from "react";
import { AnnotationConflicts } from "./annotation-conflicts";
import { Highlighter } from "lucide-react";
import { useReaderFeatureShortcut } from "./bridge";
import { CapAligned } from "@/components/shared/cap-aligned";
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
}) {
  const { engine, painted, fileId, deviceId, bridge } = input;
  const ebookId = input.book.id;
  const owner = useRef<AnnotationController | null>(null);
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<EngineEvents["annotation-activated"] | null>(null);
  const [editedNote, setEditedNote] = useState<ReaderAnnotation | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  useEffect(() => {
    if (!engine || !painted || !fileId || !deviceId) return;
    let cancelled = false;
    let controller: AnnotationController | null = null;
    let unsubscribe = () => {};
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
      offActivation();
      controller?.destroy();
      if (owner.current === controller) owner.current = null;
    };
  }, [ebookId, fileId, deviceId, engine, painted, bridge]);
  useEffect(() => { owner.current?.repaint(); }, [input.palette]);
  const ready = !!engine && painted && snapshot.loaded && !!deviceId;
  const admitted = () => !!owner.current && bridge.getControllerReadinessSnapshot().ready;
  const perform = (work: Promise<unknown>) => { void work.catch(error => input.onNotice(error instanceof Error ? error.message : "That mark could not be saved.")); };
  const create = async (color: AnnotationColor = "ochre", withNote = false) => {
    const controller = owner.current;
    const selected = latest.current.selection;
    if (!admitted() || !controller || !selected) return;
    const id = await controller.createHighlight({ text: selected.text, locator: selected.locator,
      chapter: selected.locator.tocLabel ?? null, color });
    if (owner.current !== controller) return;
    latest.current.engine?.clearSelection();
    if (withNote) setEditedNote(controller.getSnapshot().annotations.find(item => item.id === id) ?? null);
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
  useReaderFeatureShortcut("1", 11, () => perform(create("ochre")), ready);
  useReaderFeatureShortcut("2", 11, () => perform(create("sage")), ready);
  useReaderFeatureShortcut("3", 11, () => perform(create("slate")), ready);
  useReaderFeatureShortcut("4", 11, () => perform(create("rose")), ready);
  useReaderFeatureShortcut("5", 11, () => perform(create("violet")), ready);
  useReaderFeatureShortcut("n", 11, () => perform(create("ochre", true)), ready);
  const activated = snapshot.annotations.find(item => item.id === active?.decorationId && !item.deletedAt);
  const edit = (item: ReaderAnnotation, patch: { color?: AnnotationColor; style?: "highlight" | "underline" }) => {
    if (admitted() && owner.current) perform(owner.current.edit(item.id, patch));
  };
  return {
    held: open || !!active || !!editedNote,
    toolbar: <>
      <BookmarkButton active={!!bookmark} disabled={!ready} onToggle={() => perform(toggleBookmark())} />
      <CapAligned height={32} coarseHeight={44}>
        <button type="button" aria-label={snapshot.conflicts.length || snapshot.problems?.length ? "Highlights and notes: changes need attention" : "Highlights and notes"} data-tooltip="Highlights and notes" data-tooltip-keys="h"
          disabled={!ready} onClick={showPanel}
          className="block rounded-sm p-2 text-fg-secondary hover:bg-bg-tertiary/50 hover:text-fg-primary disabled:opacity-40 pointer-coarse:p-3.5">
          <Highlighter className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </CapAligned>
    </>,
    markingActions: ready ? <>
      <AnnotationSwatches onPick={color => perform(create(color))} />
      <button type="button" onClick={() => perform(create("ochre", true))} className="h-8 rounded-sm px-2 hover:bg-bg-tertiary pointer-coarse:h-11">Note</button>
    </> : undefined,
    overlays: <>
      {open && <AnnotationsPanel open onClose={() => setOpen(false)} book={input.book} annotations={snapshot.annotations}
        conflictContent={<AnnotationConflicts snapshot={snapshot} onRefresh={async () => { if (admitted()) await owner.current?.pull(); }} onRetry={async (id,revision) => admitted() ? await owner.current?.retryBlocked(id,revision) ?? false : false} />}
        onPick={async item => {
          if (!admitted() || !engine || item.anchorState === "orphaned") return false;
          const result = await engine.resolveAnnotation(item);
          if (!admitted() || latest.current.engine !== engine || !result.locator || !["exact", "healed"].includes(result.status)) return false;
          return input.onJump(result.locator);
        }} onNote={item => setEditedNote(item)} onEdit={edit} onDelete={item => perform(remove(item))} />}
      {active && activated && <HighlightMenu annotation={activated} rect={active.rect} onClose={() => setActive(null)}
        onEdit={patch => edit(activated, patch)} onNote={() => { setActive(null); setEditedNote(activated); }} onDelete={() => perform(remove(activated))} />}
      {editedNote && <NoteDialog key={editedNote.id} note={editedNote.note} onClose={() => setEditedNote(null)}
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
