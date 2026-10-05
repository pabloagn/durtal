"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { addSession, deleteSession, getReadingSessions, updateSession, type SessionRow } from "@/lib/actions/reading";
import { formatOfCopy, type ReadingFormat } from "@/lib/reading/constants";
import { formatMinutes, parseProgressInput, type ProgressInput } from "@/lib/reading/positions";
import { atText } from "../session-list";
import { atWallTime, durationWords, wallTime } from "@/lib/reading/timer";
import { browserZone, showError, todayReadingDay, undoToast, useCoarsePointer } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter } from "./fields";
import { segmentInput } from "./log-progress-dialog";
import { readNumber } from "./start-reading-dialog";

/*
 * Add a session, or edit one (SLN-451). The start is never asked for: a
 * session starts where the one before it in the session order ended, so the
 * form shows it as text. Saving shows a 10-second Undo.
 */

type Segment = "page" | "percent" | "time";
const SEGMENTS = [
  { value: "page", label: "Page" },
  { value: "percent", label: "%" },
  { value: "time", label: "Time" },
] as const;

interface At {
  page: number | null;
  percent: number | null;
  minutes: number | null;
}

const endAt = (s: SessionRow): At => ({ page: s.endPage, percent: s.endPercent, minutes: s.endMinutes });
const startAt = (s: SessionRow): At => ({ page: s.startPage, percent: s.startPercent, minutes: s.startMinutes });
const orderKey = (readOn: string, at: Date | string | null) => `${readOn}|${at ? new Date(at).toISOString() : "~"}`;

/** Where a new session on this day starts: the end of the session before it, else where the reading started */
export function startOfNew(sessions: SessionRow[], readOn: string, at: Date | null, readingStart: At): { at: At; before: SessionRow | null } {
  const key = orderKey(readOn, at);
  const before = sessions
    .filter((s) => orderKey(s.readOn, s.endedAt ?? s.startedAt ?? s.createdAt) <= key)
    .sort((a, b) => (orderKey(a.readOn, a.endedAt ?? a.startedAt ?? a.createdAt) < orderKey(b.readOn, b.endedAt ?? b.startedAt ?? b.createdAt) ? -1 : 1))
    .at(-1);
  return before ? { at: endAt(before), before } : { at: readingStart, before: null };
}

/** True when a position is below another, in the unit both have */
function below(a: ProgressInput, b: At): boolean {
  if (a.kind === "page" && b.page != null) return a.page < b.page;
  if (a.kind === "percent" && b.percent != null) return a.percent < b.percent;
  if (a.kind === "minutes" && b.minutes != null) return a.minutes < b.minutes;
  return false;
}

/** A session's end as updateSession takes it, in the reading's unit */
function endOf(s: SessionRow, unit: string) {
  const chapter = { chapter: s.endChapter };
  if (unit === "minutes" && s.endMinutes != null) return { minutes: s.endMinutes, ...chapter };
  if (unit === "pages" && s.endPage != null) return { page: s.endPage, ...chapter };
  if (s.endPercent != null) return { percent: s.endPercent, ...chapter };
  if (s.endPage != null) return { page: s.endPage, ...chapter };
  return { minutes: s.endMinutes, ...chapter };
}

/** The fields shown for a session's end, from its stored end */
function endText(s: SessionRow, unit: string) {
  const end = endOf(s, unit);
  if ("page" in end && end.page != null) return String(end.page);
  if ("percent" in end && end.percent != null) return `${end.percent}%`;
  return "minutes" in end && end.minutes != null ? formatMinutes(end.minutes) : "";
}

export function SessionDialog({ data, row, request, onClose, changed }: ReadingDialogProps) {
  const r = row!.reading;
  const editing = request.session ?? null;
  const coarse = useCoarsePointer();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [readOn, setReadOn] = useState(() => editing?.readOn ?? todayReadingDay(data.dayStartHour));
  // An edited session's time is in its own zone; a new one is in the browser's
  const zone = editing?.timeZone ?? browserZone();
  const [initialTime] = useState(() => (editing?.startedAt ? wallTime(editing.startedAt, zone) : ""));
  const [time, setTime] = useState(initialTime);
  const read = editing?.durationSeconds ? Math.round(editing.durationSeconds / 60) : null;
  const [hours, setHours] = useState(read ? String(Math.floor(read / 60)) : "");
  const [minutes, setMinutes] = useState(read ? String(read % 60) : "");
  const [text, setText] = useState(() => (editing ? endText(editing, r.unit) : ""));
  const [segment, setSegment] = useState<Segment>(r.unit === "minutes" ? "time" : r.unit === "percent" ? "percent" : "page");
  const [fields, setFields] = useState(() => {
    const end = editing ? endOf(editing, r.unit) : null;
    const m = end && "minutes" in end ? end.minutes : null;
    return {
      page: end && "page" in end && end.page != null ? String(end.page) : "",
      percent: end && "percent" in end && end.percent != null ? String(end.percent) : "",
      hours: m != null ? String(Math.floor(m / 60)) : "",
      minutes: m != null ? String(m % 60) : "",
      chapter: editing?.endChapter ?? "",
    };
  });
  const [note, setNote] = useState(editing?.note ?? "");
  const [otherId, setOtherId] = useState("");
  const [saving, setSaving] = useState(false);

  // The sessions, for where a new one starts
  useEffect(() => {
    if (editing) return;
    let live = true;
    getReadingSessions(r.id).then(
      (list) => live && setSessions(list.sessions),
      () => live && setSessions([]),
    );
    return () => {
      live = false;
    };
  }, [editing, r.id]);

  const others = data.editions.filter((e) => e.id !== r.editionId);
  const other = others.find((e) => e.id === otherId) ?? null;
  const otherFormat: ReadingFormat | null = other ? formatOfCopy(other.copies[0]?.format) : null;
  const unit = other ? (otherFormat === "audio" ? "minutes" : other.pageCount ? "pages" : "percent") : r.unit;
  const totals = other ? { totalPages: other.pageCount, totalMinutes: null } : { totalPages: r.totalPages, totalMinutes: r.totalMinutes };

  const startedAt = time ? atWallTime(readOn, time, zone, data.dayStartHour) : null;
  const h = readNumber(hours || "0"),
    m = readNumber(minutes || "0");
  const durationMinutes = h !== null && m !== null && Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
  const durationError = hours.trim() || minutes.trim() ? (durationMinutes === null || (m ?? 0) >= 60 ? "Enter whole hours and minutes under 60" : null) : null;
  const durationSeconds = durationMinutes ? durationMinutes * 60 : null;
  const sessionEnd = startedAt && durationSeconds ? new Date(startedAt.getTime() + durationSeconds * 1000) : startedAt;

  const readingStart: At = { page: r.startPage ?? (r.unit === "pages" ? 0 : null), percent: r.startPercent ?? 0, minutes: r.startMinutes ?? (r.unit === "minutes" ? 0 : null) };
  const start = editing ? { at: startAt(editing), before: null } : sessions ? startOfNew(sessions, readOn, sessionEnd ?? new Date(), readingStart) : null;

  const parsed = coarse ? null : text.trim() ? parseProgressInput(text, { unit, ...totals }) : null;
  let input: ProgressInput | null = coarse ? segmentInput(segment, fields) : parsed?.ok ? parsed.value : null;
  // "+20" is twenty past the start
  if (input?.kind === "addPages") input = start?.at.page != null ? { kind: "page", page: start.at.page + input.pages } : null;
  if (input?.kind === "addMinutes") input = start?.at.minutes != null ? { kind: "minutes", minutes: start.at.minutes + input.minutes } : null;
  const to = input?.kind === "page" ? { page: input.page } : input?.kind === "percent" ? { percent: input.percent } : input?.kind === "minutes" ? { minutes: input.minutes } : null;
  const chapter = coarse ? fields.chapter.trim() || null : editing?.endChapter ?? null;
  const textError = !coarse && parsed && !parsed.ok ? parsed.error : !coarse && text.trim() && !to ? "Give where the session ended: a page, a percent or a time" : null;
  const endsBefore = !editing && start && input && below(input, start.at);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!to) return;
    setSaving(true);
    try {
      if (editing) {
        const updated = await updateSession({
          sessionId: editing.id,
          fingerprint: row!.fingerprint,
          readOn,
          startedAt,
          // A new start or length moves the end; a timer's own end, with its pauses, stays otherwise
          ...(startedAt && durationSeconds && (time !== initialTime || durationMinutes !== read) ? { endedAt: sessionEnd } : {}),
          durationSeconds,
          end: { ...to, chapter },
          note: note.trim() || null,
        });
        onClose();
        changed();
        undoToast("Saved the session", async () => {
          try {
            await updateSession({
              sessionId: editing.id,
              fingerprint: updated.fingerprint,
              readOn: editing.readOn,
              startedAt: editing.startedAt,
              endedAt: editing.endedAt,
              durationSeconds: editing.durationSeconds,
              end: endOf(editing, r.unit),
              note: editing.note,
            });
            changed();
          } catch (err) {
            showError(err, changed);
          }
        });
      } else {
        const result = await addSession({
          readingId: r.id,
          fingerprint: row!.fingerprint,
          readOn,
          ...(startedAt ? { startedAt } : {}),
          ...(durationSeconds ? { durationSeconds } : {}),
          to,
          ...(chapter ? { chapter } : {}),
          ...(other ? { editionId: other.id, format: otherFormat ?? r.format } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          timeZone: zone,
        });
        onClose();
        changed();
        undoToast(`Added a session${durationSeconds ? ` of ${durationWords(durationSeconds)}` : ""}`, async () => {
          try {
            await deleteSession({ sessionId: result.session.id, fingerprint: result.reading.fingerprint });
            changed();
          } catch (err) {
            showError(err, changed);
          }
        });
      }
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  const fromLine = !start
    ? ""
    : editing
      ? `From ${atText(start.at, r.unit)}`
      : start.before
        ? `From ${atText(start.at, unit)}, where the session before ended`
        : `From ${atText(start.at, unit)}, where the reading started`;

  return (
    <Dialog open onClose={onClose} title={editing ? "Edit session" : "Add a session"} description={data.workTitle} className="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label="Date" value={readOn} onChange={(d) => d && setReadOn(d)} />
          <Input label="Start time (optional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-fg-secondary">Time read (optional)</legend>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Hours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
            <Input label="Minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} error={durationError ?? undefined} />
          </div>
        </fieldset>
        <p className="min-h-4 text-xs text-fg-secondary" data-session-from>
          {fromLine}
        </p>
        {coarse ? (
          <div className="space-y-3">
            <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} ariaLabel="Ended at" />
            {segment === "page" && (
              <Input label="Page" inputMode="numeric" value={fields.page} onChange={(e) => setFields((f) => ({ ...f, page: e.target.value }))} />
            )}
            {segment === "percent" && (
              <Input label="Percent" inputMode="decimal" value={fields.percent} onChange={(e) => setFields((f) => ({ ...f, percent: e.target.value }))} />
            )}
            {segment === "time" && (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Hours" inputMode="numeric" value={fields.hours} onChange={(e) => setFields((f) => ({ ...f, hours: e.target.value }))} />
                <Input label="Minutes" inputMode="numeric" value={fields.minutes} onChange={(e) => setFields((f) => ({ ...f, minutes: e.target.value }))} />
              </div>
            )}
            <Input label="Chapter (optional)" value={fields.chapter} onChange={(e) => setFields((f) => ({ ...f, chapter: e.target.value }))} />
          </div>
        ) : (
          <Input
            label="Where did it end?"
            placeholder={unit === "minutes" ? "3:12, 44%" : "212, 44%, +20"}
            autoFocus={!editing}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={textError ?? undefined}
          />
        )}
        {endsBefore && start?.before && (
          <p className="text-xs text-fg-secondary" data-session-before>
            This session ends before the one before it ({atText(start.at, unit)}); it adds no pages
          </p>
        )}
        {!editing && others.length > 0 && (
          <Select
            label="Edition or format (optional)"
            value={otherId}
            onChange={(e) => setOtherId(e.target.value)}
            options={[{ value: "", label: "This reading's edition" }, ...others.map((o) => ({ value: o.id, label: o.label }))]}
          />
        )}
        <Textarea aria-label="Note" placeholder="A note on this sitting (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
        <DialogFooter onCancel={onClose} saving={saving} saveLabel={editing ? "Save" : "Add session"} disabled={!to || !!durationError || !!textError} />
      </form>
    </Dialog>
  );
}
