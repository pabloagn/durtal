"use client";

import { useState, useId } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { logProgress, stopTimer, undoProgress, undoStopTimer, updateEdition, updateReading } from "@/lib/actions/catalogue-client";
import { toast } from "@/lib/notifications/toast";
import { durationWords, stopTimes, TIMER_GONE } from "@/lib/reading/timer";
import { useOptionalTimer } from "../timer-provider";
import { formatOfCopy, type ReadingFormat } from "@/lib/reading/constants";
import { quickProgressUnit, quickProgressSteps, quickProgressStep } from "@/lib/reading/quick-progress";
import { parseProgressInput, percentOf, type ProgressInput } from "@/lib/reading/positions";
import { asksPageTotal, logPreview, moveBackText, type SessionEdition } from "@/lib/reading/log-preview";
import { browserZone, showError, todayReadingDay, undoToast, useCoarsePointer } from "../reading-client";
import { readingDateError, readingDateLimit } from "@/lib/reading/dates";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter } from "./fields";
import { readNumber } from "./start-reading-dialog";

export type Segment = "page" | "percent" | "time";

/** What was typed in Log progress, kept while "Add a quote" is open, to fill the dialog again on the way back */
export interface LogDraft {
  segment: Segment;
  fields: { page: string; percent: string; hours: string; minutes: string; chapter: string };
  readOn: string;
  minutesRead: string;
  otherId: string;
  pageTotal?: string;
}
const SEGMENTS = [
  { value: "page", label: "Page" },
  { value: "percent", label: "%" },
  { value: "time", label: "Time" },
] as const;

/** The coarse-pointer fields as one progress input */
export function segmentInput(
  segment: Segment,
  fields: { page: string; percent: string; hours: string; minutes: string; chapter: string },
): ProgressInput | null {
  if (segment === "page") {
    const n = readNumber(fields.page);
    if (n !== null && Number.isInteger(n)) return { kind: "page", page: n };
  } else if (segment === "percent") {
    const n = readNumber(fields.percent);
    if (n !== null && n <= 100) return { kind: "percent", percent: n };
  } else if (fields.hours.trim() || fields.minutes.trim()) {
    const h = readNumber(fields.hours || "0"),
      m = readNumber(fields.minutes || "0");
    if (h !== null && m !== null && Number.isInteger(h) && Number.isInteger(m) && m < 60) return { kind: "minutes", minutes: h * 60 + m };
  }
  const chapter = fields.chapter.trim();
  return chapter ? { kind: "chapter", chapter } : null;
}

/**
 * Log progress: one field, or keypad-friendly fields on a touch screen. In
 * stop mode (SLN-451) saving stops the running timer: no date (the timer's
 * day) and no minutes read (the timer's time); no position stops it where
 * it started, its time still counted.
 */
export function LogProgressDialog({ data, row, request, onClose, changed, open }: ReadingDialogProps) {
  const r = row!.reading;
  const stopping = request.timer ?? null;
  const timerContext = useOptionalTimer();
  // The footer sits outside the form, under the dialog's scrolling body
  const formId = useId();
  const [stopSeconds] = useState(() =>
    stopping ? stopTimes(stopping, stopping.endedAt ? new Date(stopping.endedAt) : null).durationSeconds : 0,
  );
  // What was typed in the palette ("+20") stays as typed, in the one field
  const coarse = useCoarsePointer() && !request.prefill;
  const [text, setText] = useState(request.prefill ?? "");
  // Back from "Add a quote": what was typed before it
  const draft = request.draft;
  const [segment, setSegment] = useState<Segment>(draft?.segment ?? (r.unit === "minutes" ? "time" : r.unit === "percent" ? "percent" : "page"));
  const [fields, setFields] = useState(draft?.fields ?? { page: "", percent: "", hours: "", minutes: "", chapter: "" });
  const [readOn, setReadOn] = useState(() => draft?.readOn ?? todayReadingDay(data.dayStartHour));
  const maxDate = readingDateLimit(browserZone());
  const dateError = stopping ? null : readingDateError(readOn, "day", maxDate);
  const [minutesRead, setMinutesRead] = useState(draft?.minutesRead ?? "");
  const [pageTotalText, setPageTotalText] = useState(draft?.pageTotal ?? "");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showOther, setShowOther] = useState(!!draft?.otherId);
  const [otherId, setOtherId] = useState(draft?.otherId ?? "");
  const [goingBack, setGoingBack] = useState<"fix_last_log" | "went_back">("fix_last_log");
  const [saving, setSaving] = useState(false);

  const others = data.editions.filter((e) => e.id !== r.editionId);
  const otherEdition = others.find((e) => e.id === otherId) ?? null;
  const otherFormat: ReadingFormat | null = otherEdition ? formatOfCopy(otherEdition.copies[0]?.format) : null;
  const session: SessionEdition | null = otherEdition
    ? {
        id: otherEdition.id,
        pageCount: otherEdition.pageCount,
        // The service uses this reading's audio length for every session.
        totalMinutes: r.totalMinutes,
        unit: otherFormat === "audio" ? "minutes" : otherEdition.pageCount ? "pages" : "percent",
      }
    : null;
  const unit = session?.unit ?? r.unit;
  const totals = session ? { totalPages: session.pageCount, totalMinutes: session.totalMinutes } : { totalPages: r.totalPages, totalMinutes: r.totalMinutes };
  const parsed = coarse ? null : text.trim() ? parseProgressInput(text, { unit, ...totals }) : null;
  const input: ProgressInput | null = coarse ? segmentInput(segment, fields) : parsed?.ok ? parsed.value : null;
  // No page total: a page logged counts no pages until the book has one, so the dialog asks for it (SLN-1095)
  const asksTotal = !stopping && asksPageTotal(r, input, session);
  const ownEdition = data.editions.find((e) => e.id === r.editionId) ?? null;
  const typedTotal = asksTotal && pageTotalText.trim() ? readNumber(pageTotalText) : null;
  const pageTotal = typedTotal !== null && Number.isInteger(typedTotal) && typedTotal > 0 ? typedTotal : null;
  const preview = logPreview(pageTotal ? { ...r, totalPages: pageTotal } : r, input, session);
  const pageTotalError = !asksTotal || !pageTotalText.trim() ? null
    : pageTotal === null ? "Enter the number of pages as a whole number above 0"
      : preview?.page != null && preview.page > pageTotal ? `Page ${preview.page} is past the last page, ${pageTotal}` : null;
  // A quote added from here: on this reading's edition at the page typed (else where the reading is), or on the session's
  // other edition (SLN-480) at its page, or as a percent of it for a session counted in percent or time
  const quotePlace: { editionId?: string; page?: number; percent?: number | null } = !session
    ? { page: input?.kind === "page" ? input.page : input?.kind === "addPages" ? (r.currentPage ?? 0) + input.pages : undefined }
    : session.unit === "pages"
      ? { editionId: session.id, page: input?.kind === "page" ? input.page : undefined }
      : {
          editionId: session.id,
          percent:
            input?.kind === "percent"
              ? input.percent
              : input?.kind === "minutes"
                ? percentOf({ minutes: input.minutes }, { totalPages: null, totalMinutes: session.totalMinutes })
                : null,
        };
  const error = !coarse && parsed && !parsed.ok ? parsed.error
    : preview?.sessionMinutes !== undefined
      ? stopping ? "The timer records your time; enter a page, a percent or a chapter"
        : preview.sessionMinutes < 1 || preview.sessionMinutes > 1440 ? "Enter a session time between 1 minute and 24 hours" : null
      : null;

  const quickUnit = quickProgressUnit(unit, coarse ? segment : null);
  const steps = quickProgressSteps(quickUnit);
  const stepLabel = (step: number) => quickProgressStep(quickUnit, step, r).label;
  function quick(step: number) {
    const { value, text } = quickProgressStep(quickUnit, step, r);
    if (!coarse) return setText(text);
    if (quickUnit === "pages") setFields((f) => ({ ...f, page: String(value) }));
    else if (quickUnit === "percent") setFields((f) => ({ ...f, percent: String(value) }));
    else setFields((f) => ({ ...f, hours: String(Math.floor(value / 60)), minutes: String(value % 60) }));
  }

  async function stop() {
    if (timerContext && timerContext.availability !== "ready") {
      toast.error("The timer is unavailable. Retry before changing it.");
      return;
    }
    setSaving(true);
    try {
      const write = () => stopTimer({
        sessionId: stopping!.sessionId,
        ...(stopping!.endedAt ? { endedAt: new Date(stopping!.endedAt) } : {}),
        ...(preview?.send ?? {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(preview?.behind ? { goingBack } : {}),
        ...(session ? { editionId: session.id, format: otherFormat ?? r.format } : {}),
      });
      const result = timerContext ? await timerContext.runMutation(write) : await write();
      if (!result.reachedEnd) onClose();
      changed();
      undoToast(`Saved ${durationWords(result.session.durationSeconds ?? stopSeconds)}${preview ? ` · ${preview.done}` : ""}`, async () => {
        try {
          const undo = () => undoStopTimer({ sessionId: stopping!.sessionId, fingerprint: result.reading.fingerprint, undo: result.undo });
          if (timerContext) await timerContext.runMutation(undo);
          else await undo();
          changed();
        } catch (err) {
          showError(err, changed);
          return false;
        }
      }, "Timer restored");
      // "Stop it and start this one"
      const next = timerContext?.pendingStart;
      if (next) {
        timerContext!.setPendingStart(null);
        await timerContext!.start(next);
      }
      if (result.reachedEnd) open({ kind: "finish", readingId: r.id, finishedOn: result.session.readOn, reachedEnd: true });
    } catch (err) {
      // Stopped or discarded on another device: said in words, since a production build hides the server's message
      try {
        const now = await timerContext?.refresh();
        if (timerContext && now?.sessionId !== stopping!.sessionId) {
          toast.error(TIMER_GONE);
          onClose();
        } else showError(err, changed);
      } catch {
        toast.error("The timer is unavailable. Retry before changing it.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (error) return;
    if (stopping) return stop();
    if (!preview || dateError || pageTotalError) return;
    setSaving(true);
    try {
      let fingerprint = row!.fingerprint;
      // "212/480" also gives the page count, as does "Pages in this edition"; an edition without one keeps it (SLN-1095)
      const totalPages = input?.kind === "page" && input.totalPages ? input.totalPages : pageTotal;
      if (pageTotal && ownEdition && !ownEdition.pageCount) await updateEdition(ownEdition.id, { pageCount: pageTotal });
      if (totalPages && totalPages !== r.totalPages && !session) {
        fingerprint = (await updateReading({ readingId: r.id, fingerprint, totalPages })).fingerprint;
      }
      const duration = readNumber(minutesRead);
      const result = await logProgress({
        readingId: r.id,
        fingerprint,
        ...preview.send,
        readOn,
        ...(preview.sessionMinutes === undefined && duration ? { durationSeconds: Math.round(duration * 60) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(preview.behind ? { goingBack } : {}),
        ...(session ? { editionId: session.id, format: otherFormat ?? r.format } : {}),
        timeZone: browserZone(),
      });
      if (!result.reachedEnd) onClose();
      changed();
      undoToast(preview.done, async () => {
        try {
          await undoProgress({ readingId: r.id, fingerprint: result.reading.fingerprint, undo: result.undo });
          changed();
        } catch (err) {
          showError(err, changed);
          return false;
        }
      }, "Progress restored");
      if (result.reachedEnd) open({ kind: "finish", readingId: r.id, finishedOn: readOn, reachedEnd: true });
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      draft
      open
      onClose={onClose}
      title={stopping ? "Stop the timer" : "Log progress"}
      description={stopping ? `You read ${durationWords(stopSeconds)}. Where are you now?` : data.workTitle}
      className="max-w-lg"
    >
      <form id={formId} onSubmit={save} className="space-y-4">
        {coarse ? (
          <div className="space-y-3">
            <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} ariaLabel="Log by" />
            {segment === "page" && (
              <Input label="Page" inputMode="numeric" value={fields.page} onChange={(e) => setFields((f) => ({ ...f, page: e.target.value }))} />
            )}
            {segment === "percent" && (
              <Input label="Percent" inputMode="decimal" value={fields.percent} onChange={(e) => setFields((f) => ({ ...f, percent: e.target.value }))} />
            )}
            {segment === "time" && (
              <div className="flex gap-2">
                <Input label="Hours" inputMode="numeric" value={fields.hours} onChange={(e) => setFields((f) => ({ ...f, hours: e.target.value }))} />
                <Input label="Minutes" inputMode="numeric" value={fields.minutes} onChange={(e) => setFields((f) => ({ ...f, minutes: e.target.value }))} />
              </div>
            )}
            <Input label="Chapter (optional)" value={fields.chapter} onChange={(e) => setFields((f) => ({ ...f, chapter: e.target.value }))} />
          </div>
        ) : (
          <Input
            label="Where are you?"
            placeholder="212, 44% or +20"
            hint="212, 44%, +20, 212/480, 3:12 or ch 7"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error ?? undefined}
          />
        )}
        <p className="min-h-4 text-xs text-fg-secondary" aria-live="polite" data-live-line>
          {preview?.line ?? ""}
        </p>
        {coarse && error && <p role="alert" className="text-xs text-accent-red-text">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {steps.map((n) => (
            <Button key={n} type="button" size="sm" variant="ghost" onClick={() => quick(n)} className="pointer-coarse:h-11">
              {stepLabel(n)}
            </Button>
          ))}
        </div>
        {asksTotal && (
          <Input
            label={ownEdition ? "Pages in this edition (optional)" : "Pages in this book (optional)"}
            inputMode="numeric"
            value={pageTotalText}
            onChange={(e) => setPageTotalText(e.target.value)}
            error={pageTotalError ?? undefined}
          />
        )}
        {preview?.behind && (
          <fieldset className="space-y-2 rounded-sm border border-glass-border p-3">
            <legend className="px-1 text-xs text-fg-primary">{moveBackText(r, preview)}</legend>
            {(
              [
                ["fix_last_log", "Fix my last log", "The last log's end is replaced; the mistyped pages are never counted"],
                ["went_back", "I went back", "A new session; pages read again count only past where you were"],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm text-fg-secondary pointer-coarse:min-h-11">
                <input type="radio" name="going-back" value={value} checked={goingBack === value} onChange={() => setGoingBack(value)} className="mt-1" />
                <span>
                  <span className="text-fg-primary">{label}</span>
                  <span className="block text-xs">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {!stopping && (
          <div className="grid grid-cols-2 gap-3">
            <DatePicker label="Date" value={readOn} onChange={(d) => d && setReadOn(d)} max={maxDate} error={dateError ?? undefined} />
            <Input label="Minutes read (optional)" inputMode="numeric" value={preview?.sessionMinutes === undefined ? minutesRead : String(preview.sessionMinutes)} readOnly={preview?.sessionMinutes !== undefined} onChange={(e) => setMinutesRead(e.target.value)} />
          </div>
        )}
        {showNote ? (
          <Textarea aria-label="Note" placeholder="A note on this sitting" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
        ) : (
          <div className="flex flex-wrap gap-x-4">
            <button type="button" onClick={() => setShowNote(true)} className="text-xs text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11">
              Add a note
            </button>
            {/* A quote from this sitting (SLN-453), at the page typed here; closing it comes back to this log */}
            <button
              type="button"
              onClick={() =>
                open({
                  kind: "note",
                  noteKind: "quote",
                  readingId: r.id,
                  ...quotePlace,
                  back: {
                    kind: "progress",
                    readingId: r.id,
                    prefill: !coarse && text.trim() ? text : undefined,
                    timer: request.timer,
                    draft: { segment, fields, readOn, minutesRead, otherId, ...(pageTotalText ? { pageTotal: pageTotalText } : {}) },
                  },
                })
              }
              className="text-xs text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11"
              data-log-quote=""
            >
              Add a quote
            </button>
          </div>
        )}
        {others.length > 0 &&
          (showOther ? (
            <Select
              label="Read in another edition or format"
              value={otherId}
              onChange={(e) => setOtherId(e.target.value)}
              options={[{ value: "", label: "This reading's edition" }, ...others.map((o) => ({ value: o.id, label: o.label }))]}
            />
          ) : (
            <button type="button" onClick={() => setShowOther(true)} className="block text-xs text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11">
              Read in another edition or format
            </button>
          ))}
        <DialogFooter form={formId} onCancel={onClose} saving={saving} saveLabel={stopping ? "Stop timer" : "Log"} disabled={stopping ? !!error : !preview || !!error || !!dateError || !!pageTotalError}
          hint={!stopping && !preview && !error && !dateError && !pageTotalError ? "Enter where you are" : null} />
      </form>
    </Dialog>
  );
}
