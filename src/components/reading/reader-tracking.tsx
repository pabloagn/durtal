"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ReaderSlotFill, useBeforeAnnotationDelete, useReaderContext, useReaderController, useReaderControllerFailure } from "@/components/reader/bridge";
import type { ReaderControllerFailureProps } from "@/lib/reader/bridge-state";
import type { PreparedAnnotationDelete } from "@/lib/reader/annotation-deletion";
import type { ReaderEvents, ReaderSelection } from "@/lib/reader/events";
import { registerReaderKey } from "@/lib/reader/input";
import { getReaderTracking, prepareReaderQuoteDelete, saveReaderQuote, startReaderReading } from "@/lib/actions/reader-tracking";
import { deleteReading, pauseReading, resumeReading } from "@/lib/actions/reading";
import { createReadingReaderController, READER_TRACKING_CONTROLLER_ID } from "@/lib/reading/reader-controller";
import { createReaderSittingQueue } from "@/lib/reading/reader-sitting-queue";
import { readerTrackingDataSchema, type ReaderTrackingData } from "@/lib/reading/reader-tracking-data";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useOptionalTimer } from "./timer-provider";
import { useReadingDialogs } from "./reading-dialogs-provider";
import { browserZone } from "./reading-client";
import { hoursWords } from "@/lib/reading/pace";

type Controller = ReturnType<typeof createReadingReaderController>;
type Queue = ReturnType<typeof createReaderSittingQueue>;
type QuoteChoice = { settle(value: "keep-quote" | "delete-quote" | null): void };

export function ReaderTrackingFailure({ id, code, onRetry }: ReaderControllerFailureProps) {
  const notice = useRef<HTMLElement>(null);
  useReaderControllerFailure(id, code, notice);
  return <aside ref={notice} role="alert" data-reader-chrome
    className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border-primary bg-bg-primary p-4 text-sm shadow-lg">
    <p>Reading tracking is unavailable. Your book is still available to read.</p>
    {onRetry && <Button onClick={onRetry}>Retry tracking</Button>}
  </aside>;
}

export function ReaderTracking({ data }: { data: unknown }) {
  const parsed = readerTrackingDataSchema.safeParse(data);
  const timer = useOptionalTimer();
  if (!parsed.success || (parsed.data.linked && (!timer || timer.availability !== "ready")))
    return <ReaderTrackingFailure id={READER_TRACKING_CONTROLLER_ID} code="reader_controller_unavailable" />;
  return <ActiveReaderTracking data={parsed.data} key={parsed.data.ebookId} />;
}

function ActiveReaderTracking({ data: initial }: { data: ReaderTrackingData }) {
  const context = useReaderContext();
  const dialogs = useReadingDialogs();
  const timer = useOptionalTimer();
  const [data, setData] = useState(initial);
  const [snapshot, setSnapshot] = useState<ReturnType<Controller["getSnapshot"]> | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(context.selection);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endPrompt, setEndPrompt] = useState(false);
  const [quoteChoice, setQuoteChoice] = useState<QuoteChoice | null>(null);
  const controller = useRef<Controller | null>(null);
  const queue = useRef<Queue | null>(null);
  const live = useRef(false);
  const generation = useRef(0);
  const manualStart = useRef(false);
  const selected = useRef(selection);
  const undo = useRef<{ timer: ReturnType<typeof setTimeout>; toast: string | number } | null>(null);
  const pendingChoice = useRef<QuoteChoice | null>(null);
  const latest = useRef({ data, timer, dialogs });
  latest.current = { data, timer, dialogs };
  selected.current = selection;
  const timerOwns = !!timer?.timer && timer.timer.workId === data.linked?.workId;

  function showFailure(error: unknown) {
    if (live.current) setNotice(error instanceof Error ? error.message : "Reading has not synced. Try again when connected.");
  }
  function endUndo() {
    if (undo.current) { clearTimeout(undo.current.timer); toast.dismiss(undo.current.toast); undo.current = null; }
  }

  // This layout effect precedes useReaderController's installation. Every handler
  // below therefore reaches the real controller before readiness can be acknowledged.
  useLayoutEffect(() => {
    live.current = true;
    const ownGeneration = ++generation.current;
    let ownQueue: Queue;
    try {
      ownQueue = createReaderSittingQueue({ ebookId: initial.ebookId, deviceId: initial.deviceId,
        timeZone: browserZone(), storage: window.localStorage,
        beacon: (url, payload) => navigator.sendBeacon(url, payload), failed: showFailure,
        acknowledged: (sitting) => {
          if (live.current && generation.current === ownGeneration) setData((current) =>
            current.linked?.reading?.id === sitting.readingId ? { ...current, linked: { ...current.linked,
              reading: { ...current.linked.reading, status: "reading" } } } : current);
        },
        retired: (sitting) => {
          if (!live.current || generation.current !== ownGeneration) return;
          if (controller.current?.getSnapshot().sittingId === sitting.sittingId) {
            controller.current.stopTracking();
            setNotice("This reading changed elsewhere. Reload tracking before continuing.");
          }
        } });
    } catch (error) { showFailure(error); setFatal(true); return () => { live.current = false; }; }
    queue.current = ownQueue;
    const ownController = createReadingReaderController({ now: Date.now, uuid: () => crypto.randomUUID(),
      timeZone: browserZone(), visible: document.visibilityState !== "hidden",
      readingId: initial.linked?.reading?.id ?? null,
      ...(context.percent === null ? {} : { initialPlace: { percent: context.percent, chapter: context.chapter } }),
      autoStart: !!initial.linked && initial.autoTrack && !initial.linked.hasClosedHistory,
      start: async (startPercent, sitting) => {
        const result = await startReaderReading({ ebookId: initial.ebookId, startPercent, sitting: sitting ?? undefined,
          timeZone: browserZone(), automatic: !manualStart.current });
        manualStart.current = false;
        if (!live.current || generation.current !== ownGeneration) return { readingId: result.reading.id };
        const fresh = await getReaderTracking(initial.ebookId);
        if (!live.current || generation.current !== ownGeneration) return { readingId: result.reading.id };
        setData(fresh);
        if (result.created) {
          ownController.holdWrites(true);
          const toastId = toast.success("Now tracking this book", { duration: 10_000, action: { label: "Undo", onClick: () => {
            if (!live.current || generation.current !== ownGeneration || !undo.current) return;
            endUndo();
            ownController.stopTracking();
            void deleteReading({ readingId: result.reading.id, fingerprint: result.reading.fingerprint })
              .then(() => getReaderTracking(initial.ebookId)).then((next) => {
                if (live.current && generation.current === ownGeneration) setData(next);
              }).catch(showFailure);
          } } });
          undo.current = { toast: toastId, timer: setTimeout(() => {
            undo.current = null;
            ownController.holdWrites(false);
            ownController.flush();
          }, 10_000) };
        }
        return { readingId: result.reading.id };
      },
      save: (sitting, beacon) => { ownQueue.push(sitting, beacon); },
      reachedEnd: () => { if (live.current) setEndPrompt(true); },
      selection: (next) => { if (live.current) setSelection(next); },
      changed: () => { if (live.current) setSnapshot(ownController.getSnapshot()); },
      failed: showFailure,
    });
    controller.current = ownController;
    ownController.suspend(!!latest.current.timer?.timer && latest.current.timer.timer.workId === initial.linked?.workId);
    setSnapshot(ownController.getSnapshot());
    const visibility = () => { ownController.visibility(document.visibilityState !== "hidden"); if (document.visibilityState !== "hidden") void ownQueue.flush(); };
    const close = () => ownController.flush(true);
    const online = () => void ownQueue.flush();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", close);
    window.addEventListener("beforeunload", close);
    window.addEventListener("online", online);
    void ownQueue.flush();
    return () => {
      live.current = false;
      generation.current++;
      endUndo();
      pendingChoice.current?.settle(null);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("beforeunload", close);
      window.removeEventListener("online", online);
      void ownController.dispose().finally(() => ownQueue.dispose());
      if (controller.current === ownController) controller.current = null;
      if (queue.current === ownQueue) queue.current = null;
    };
    // A bridge generation owns this immutable loader payload and file binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.ebookId, initial.deviceId, context.fileId]);

  useLayoutEffect(() => { controller.current?.suspend(timerOwns); }, [timerOwns]);

  const handle = <K extends keyof ReaderEvents>(name: K, event: ReaderEvents[K]) => {
    const active = controller.current;
    if (!active) throw new Error("Reading controller is not initialized");
    active.handlers[name](event);
  };
  useReaderController(READER_TRACKING_CONTROLLER_ID, {
    activity: (event) => handle("activity", event), location: (event) => handle("location", event),
    end: (event) => handle("end", event), selection: (event) => handle("selection", event),
  });

  async function quote() {
    const value = selected.current;
    if (!value || busy || !latest.current.data.linked) return;
    const expected = generation.current;
    setBusy(true);
    try {
      const saved = await saveReaderQuote({ ebookId: initial.ebookId, ...value });
      if (!live.current || expected !== generation.current) return;
      await latest.current.dialogs.open({ kind: "note", workId: latest.current.data.linked!.workId, note: saved.note });
    } catch (error) { showFailure(error); }
    finally { if (live.current && expected === generation.current) setBusy(false); }
  }
  const quoteAction = useRef(quote);
  quoteAction.current = quote;
  useLayoutEffect(() => registerReaderKey("q", () => { void quoteAction.current(); }, { when: "selection", label: "Save quote" }), []);

  useBeforeAnnotationDelete(async (annotation, signal): Promise<PreparedAnnotationDelete> => {
    if (annotation.style !== "quote") return { status: "proceed", effect: { action: "none" } };
    const expected = generation.current;
    const versions = await prepareReaderQuoteDelete({ ebookId: initial.ebookId, annotationId: annotation.id });
    if (signal.aborted || !live.current || expected !== generation.current) return { status: "cancel" };
    pendingChoice.current?.settle(null);
    const choice = await new Promise<"keep-quote" | "delete-quote" | null>((resolve) => {
      let settled = false;
      const item: QuoteChoice = { settle(value) {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        if (pendingChoice.current === item) pendingChoice.current = null;
        if (live.current) setQuoteChoice(null);
        resolve(value);
      } };
      const abort = () => item.settle(null);
      pendingChoice.current = item;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) item.settle(null);
      else setQuoteChoice(item);
    });
    return choice && !signal.aborted && live.current && expected === generation.current
      ? { status: "proceed", effect: { action: choice, ...versions } } : { status: "cancel" };
  });

  async function synchronize() {
    endUndo();
    controller.current?.holdWrites(false);
    controller.current?.flush();
    for (let attempt = 0; attempt < 3 && queue.current?.pending; attempt++) await queue.current.flush();
    if (queue.current?.pending) throw new Error("Wait for this sitting to sync before changing the reading.");
    const fresh = await getReaderTracking(initial.ebookId);
    if (live.current) setData(fresh);
    return fresh;
  }
  async function readingAction(kind: "progress" | "finish" | "edit" | "pause") {
    if (busy) return;
    const expected = generation.current;
    setBusy(true);
    try {
      const fresh = await synchronize();
      if (!live.current || expected !== generation.current) return;
      const reading = fresh.linked?.reading;
      if (!reading || !fresh.linked) throw new Error("This reading is no longer open.");
      if (kind === "pause") {
        controller.current?.suspend(true);
        const input = { readingId: reading.id, fingerprint: reading.fingerprint };
        if (reading.status === "paused") await resumeReading(input); else await pauseReading(input);
        const next = await getReaderTracking(initial.ebookId);
        if (live.current && expected === generation.current) {
          setData(next);
          controller.current?.setReading(next.linked?.reading?.id ?? null);
        }
      } else await dialogs.open({ kind, readingId: reading.id, workId: fresh.linked.workId, fingerprint: reading.fingerprint });
    } catch (error) { showFailure(error); }
    finally {
      if (live.current && expected === generation.current) {
        controller.current?.suspend(!!latest.current.timer?.timer && latest.current.timer.timer.workId === latest.current.data.linked?.workId);
        setBusy(false);
      }
    }
  }

  if (fatal) return <ReaderTrackingFailure id={READER_TRACKING_CONTROLLER_ID} code="reader_controller_failed" />;
  if (!data.linked) return null;
  const reading = data.linked.reading;
  const percent = snapshot?.counted?.percent ?? reading?.percent;
  const status = timerOwns ? "Manual timer active" : snapshot?.held ? "Starting tracking" : reading?.status === "paused" ? "Paused" : "Tracking";
  return <>
    <ReaderSlotFill slot="toolbar-status">
      {reading ? <DropdownMenu label="Reading actions" trigger={<Button disabled={busy} variant="ghost">{status}{percent == null ? "" : ` · ${percent.toFixed(1)}%`}</Button>}>
        <DropdownMenuItem disabled={busy} onClick={() => void readingAction("progress")}>Log progress</DropdownMenuItem>
        <DropdownMenuItem disabled={busy || timerOwns} onClick={() => void readingAction("pause")}>{reading.status === "paused" ? "Resume reading" : "Pause reading"}</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => void readingAction("edit")}>Edit reading</DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={() => void readingAction("finish")}>Finish reading</DropdownMenuItem>
      </DropdownMenu> : <Button disabled={busy || timerOwns} variant="ghost" onClick={() => {
        manualStart.current = true;
        void controller.current?.startTracking();
      }}>{data.linked.hasClosedHistory ? "Start a re-read" : "Track this book"}</Button>}
    </ReaderSlotFill>
    {reading && data.estimate && percent != null && <ReaderSlotFill slot="top-bar"><span className="text-xs text-fg-secondary" title={data.estimate.explanation}>
      About {hoursWords((100 - percent) * data.estimate.minutesPerPercent)} left
    </span></ReaderSlotFill>}
    <ReaderSlotFill slot="selection-actions"><Button disabled={busy || !selection} variant="ghost" onClick={() => void quote()}>Save quote</Button></ReaderSlotFill>
    {notice && <aside role="status" data-reader-chrome className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl bg-bg-primary p-4 text-sm shadow-lg">
      <p className="flex-1">{notice}</p><Button onClick={() => { setNotice(null); void queue.current?.flush(); }}>Retry sync</Button>
    </aside>}
    <Dialog open={endPrompt} onClose={() => setEndPrompt(false)} title="Finished this book?" expandable={false} className="max-w-md">
      <p className="mb-4 text-sm text-fg-secondary">You have reached the end. Mark it finished when you are ready.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button onClick={() => setEndPrompt(false)}>Keep reading</Button>
        <Button variant="primary" disabled={busy} onClick={() => { setEndPrompt(false); void readingAction("finish"); }}>Finish reading</Button></div>
    </Dialog>
    <Dialog open={!!quoteChoice} onClose={() => quoteChoice?.settle(null)} title="Remove this highlight?" expandable={false} className="max-w-md">
      <p className="mb-4 text-sm text-fg-secondary">Keep the saved quote in your reading notes, or remove the quote and highlight together.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button onClick={() => quoteChoice?.settle(null)}>Cancel</Button>
        <Button onClick={() => quoteChoice?.settle("keep-quote")}>Keep quote</Button>
        <Button variant="danger" onClick={() => quoteChoice?.settle("delete-quote")}>Remove both</Button></div>
    </Dialog>
  </>;
}
