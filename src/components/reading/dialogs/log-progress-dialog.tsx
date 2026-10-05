"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { logProgress, undoProgress, updateReading } from "@/lib/actions/reading";
import { formatOfCopy, type ReadingFormat } from "@/lib/reading/constants";
import { parseProgressInput, type ProgressInput } from "@/lib/reading/positions";
import { logPreview, moveBackText, type SessionEdition } from "@/lib/reading/log-preview";
import { browserZone, showError, todayReadingDay, undoToast, useCoarsePointer } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter } from "./fields";
import { readNumber } from "./start-reading-dialog";

type Segment = "page" | "percent" | "time";
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

/** Log progress: one field, or keypad-friendly fields on a touch screen */
export function LogProgressDialog({ data, row, onClose, changed, open }: ReadingDialogProps) {
  const r = row!.reading;
  const coarse = useCoarsePointer();
  const [text, setText] = useState("");
  const [segment, setSegment] = useState<Segment>(r.unit === "minutes" ? "time" : r.unit === "percent" ? "percent" : "page");
  const [fields, setFields] = useState({ page: "", percent: "", hours: "", minutes: "", chapter: "" });
  const [readOn, setReadOn] = useState(() => todayReadingDay(data.dayStartHour));
  const [minutesRead, setMinutesRead] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [goingBack, setGoingBack] = useState<"fix_last_log" | "went_back">("fix_last_log");
  const [saving, setSaving] = useState(false);

  const others = data.editions.filter((e) => e.id !== r.editionId);
  const otherEdition = others.find((e) => e.id === otherId) ?? null;
  const otherFormat: ReadingFormat | null = otherEdition ? formatOfCopy(otherEdition.copies[0]?.format) : null;
  const otherMinutes = otherEdition
    ? (data.rows.find((x) => x.reading.editionId === otherEdition.id && x.reading.totalMinutes)?.reading.totalMinutes ?? null)
    : null;
  const session: SessionEdition | null = otherEdition
    ? {
        id: otherEdition.id,
        pageCount: otherEdition.pageCount,
        totalMinutes: otherMinutes,
        unit: otherFormat === "audio" ? "minutes" : otherEdition.pageCount ? "pages" : "percent",
      }
    : null;
  const unit = session?.unit ?? r.unit;
  const totals = session ? { totalPages: session.pageCount, totalMinutes: session.totalMinutes } : { totalPages: r.totalPages, totalMinutes: r.totalMinutes };
  const parsed = coarse ? null : text.trim() ? parseProgressInput(text, { unit, ...totals }) : null;
  const input: ProgressInput | null = coarse ? segmentInput(segment, fields) : parsed?.ok ? parsed.value : null;
  const preview = logPreview(r, input, session);
  const error = !coarse && parsed && !parsed.ok ? parsed.error : null;

  /** +5 pages (or +5% or +15 min) from where the reading is */
  function quick(step: number) {
    if (!coarse) return setText(`+${step}`);
    if (segment === "page") setFields((f) => ({ ...f, page: String((r.currentPage ?? 0) + step) }));
    else if (segment === "percent") setFields((f) => ({ ...f, percent: String(Math.min(100, Math.round((r.currentPercent ?? 0) + step))) }));
    else {
      const total = (r.currentMinutes ?? 0) + step;
      setFields((f) => ({ ...f, hours: String(Math.floor(total / 60)), minutes: String(total % 60) }));
    }
  }
  const steps = unit === "minutes" || (coarse && segment === "time") ? [15, 30, 60] : unit === "percent" || (coarse && segment === "percent") ? [5, 10, 25] : [5, 10, 25];
  const stepLabel = (n: number) => (unit === "minutes" || (coarse && segment === "time") ? `+${n} min` : unit === "percent" || (coarse && segment === "percent") ? `+${n}%` : `+${n}`);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setSaving(true);
    try {
      let fingerprint = row!.fingerprint;
      // "212/480" also gives the page count
      if (input?.kind === "page" && input.totalPages && input.totalPages !== r.totalPages && !session) {
        fingerprint = (await updateReading({ readingId: r.id, fingerprint, totalPages: input.totalPages })).fingerprint;
      }
      const duration = readNumber(minutesRead);
      const result = await logProgress({
        readingId: r.id,
        fingerprint,
        ...preview.send,
        readOn,
        ...(duration ? { durationSeconds: Math.round(duration * 60) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(preview.behind ? { goingBack } : {}),
        ...(session ? { editionId: session.id, format: otherFormat ?? r.format } : {}),
        timeZone: browserZone(),
      });
      onClose();
      changed();
      undoToast(preview.done, async () => {
        try {
          await undoProgress({ readingId: r.id, fingerprint: result.reading.fingerprint, undo: result.undo });
          changed();
        } catch (err) {
          showError(err, changed);
        }
      });
      if (result.reachedEnd) open({ kind: "finish", readingId: r.id, finishedOn: readOn, reachedEnd: true });
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Log progress" description={data.workTitle} className="max-w-lg">
      <form onSubmit={save} className="space-y-4">
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
            placeholder="212, 44%, +20, 212/480, 3:12, ch 7"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error ?? undefined}
          />
        )}
        <p className="min-h-4 text-xs text-fg-secondary" aria-live="polite" data-live-line>
          {preview?.line ?? ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {steps.map((n) => (
            <Button key={n} type="button" size="sm" variant="ghost" onClick={() => quick(n)} className="pointer-coarse:h-11">
              {stepLabel(n)}
            </Button>
          ))}
        </div>
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
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label="Date" value={readOn} onChange={(d) => d && setReadOn(d)} />
          <Input label="Minutes read (optional)" inputMode="numeric" value={minutesRead} onChange={(e) => setMinutesRead(e.target.value)} />
        </div>
        {showNote ? (
          <Textarea aria-label="Note" placeholder="A note on this sitting" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
        ) : (
          <button type="button" onClick={() => setShowNote(true)} className="text-xs text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11">
            Add a note
          </button>
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
        <DialogFooter onCancel={onClose} saving={saving} saveLabel="Log" disabled={!preview || !!error} />
      </form>
    </Dialog>
  );
}
