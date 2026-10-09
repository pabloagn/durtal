"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RatingInput } from "@/components/shared/rating";
import {
  TiptapEditor,
  type RichValue,
} from "@/components/shared/tiptap-editor";
import { updateReading } from "@/lib/actions/reading";
import {
  ABANDON_REASONS,
  ABANDON_REASON_LABELS,
  type AbandonReason,
  type ReadingDatePrecision,
  type ReadingFormat,
  type ReadingUnit,
} from "@/lib/reading/constants";
import { notesCountText } from "@/lib/reading/notes-text";
import {
  formatMinutes,
  percentOf,
  positionChanges,
  remapPosition,
} from "@/lib/reading/positions";
import { showError } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import {
  DialogFooter,
  parseLength,
  ReadingDateField,
  type ReadingDate,
} from "./fields";
import { finishDateError } from "./finish-reading-dialog";
import { readNumber, startPosition } from "./start-reading-dialog";

const UNITS = [
  { value: "pages", label: "Page" },
  { value: "percent", label: "Percent" },
  { value: "minutes", label: "Time (h:mm)" },
];

/** A position field always names its unit, including when the book has no total. */
export function editPositionText(
  r: { page: number | null; percent: number | null; minutes: number | null },
  unit: ReadingUnit,
) {
  return unit === "pages"
    ? String(r.page ?? 0)
    : unit === "percent"
      ? String(r.percent ?? 0)
      : formatMinutes(r.minutes ?? 0);
}

export function startingLine(
  value: { startPage?: number; startPercent?: number; startMinutes?: number },
  totals: { totalPages: number | null; totalMinutes: number | null },
) {
  const percent = percentOf(
    {
      page: value.startPage,
      percent: value.startPercent,
      minutes: value.startMinutes,
    },
    totals,
  );
  const at =
    value.startPage !== undefined
      ? `p. ${value.startPage}${totals.totalPages ? ` of ${totals.totalPages}` : ""}`
      : value.startMinutes !== undefined
        ? `${formatMinutes(value.startMinutes)}${totals.totalMinutes ? ` of ${formatMinutes(totals.totalMinutes)}` : ""}`
        : `${value.startPercent ?? 0}%`;
  return `Starting at ${at}${percent !== null && value.startPercent === undefined ? ` · ${percent}%` : ""}`;
}

const FORMATS = [
  { value: "print", label: "Print" },
  { value: "ebook", label: "eBook" },
  { value: "audio", label: "Audio" },
] as const;

/** What an edition switch does to the place: "p. 212 of 480 becomes p. 198 of 448" */
export function switchPreview(
  r: {
    currentPage: number | null;
    currentPercent: number | null;
    totalPages: number | null;
  },
  newPages: number | null,
) {
  if (!newPages)
    return `${Math.round(r.currentPercent ?? 0)}% · this edition has no page count; the reading counts in percent until you give one`;
  const mapped = remapPosition(r.currentPercent, { totalPages: newPages });
  return r.currentPage !== null && r.totalPages
    ? `p. ${r.currentPage} of ${r.totalPages} becomes p. ${mapped.page} of ${newPages}`
    : `${Math.round(r.currentPercent ?? 0)}% becomes p. ${mapped.page} of ${newPages}`;
}

/** Edit a reading: edition, copy, format, home, dates, totals, rating, review, reason */
export function EditReadingDialog({
  data,
  row,
  onClose,
  changed,
}: ReadingDialogProps) {
  const r = row!.reading;
  const done = r.status === "finished" || r.status === "abandoned";
  const [editionId, setEditionId] = useState(r.editionId ?? "");
  const [instanceId, setInstanceId] = useState(r.instanceId ?? "");
  const [format, setFormat] = useState<ReadingFormat>(
    r.format as ReadingFormat,
  );
  const [homeId, setHomeId] = useState(r.locationId ?? "");
  const [start, setStart] = useState<ReadingDate>({
    date: r.startedOn,
    precision: r.startedPrecision as ReadingDatePrecision,
  });
  const [finish, setFinish] = useState<ReadingDate>({
    date: r.finishedOn,
    precision: r.finishedPrecision as ReadingDatePrecision,
  });
  const [pages, setPages] = useState(r.totalPages ? String(r.totalPages) : "");
  const [length, setLength] = useState(
    r.totalMinutes ? formatMinutes(r.totalMinutes) : "",
  );
  const [rating, setRating] = useState<number | null>(
    r.rating != null ? Number(r.rating) : null,
  );
  const [review, setReview] = useState<RichValue | null>(
    r.reviewHtml ? { html: r.reviewHtml, json: r.reviewJson ?? null } : null,
  );
  const [reviewChanged, setReviewChanged] = useState(false);
  const [reason, setReason] = useState<AbandonReason>(
    (r.abandonReason as AbandonReason) ?? "lost_interest",
  );
  const [note, setNote] = useState(r.abandonNote ?? "");
  const [saving, setSaving] = useState(false);
  const [startUnit, setStartUnit] = useState<ReadingUnit>(
    r.unit as ReadingUnit,
  );
  const [currentUnit, setCurrentUnit] = useState<ReadingUnit>(
    r.unit as ReadingUnit,
  );
  const initialStart = editPositionText(
    { page: r.startPage, percent: r.startPercent, minutes: r.startMinutes },
    r.unit as ReadingUnit,
  );
  const initialCurrent = editPositionText(
    {
      page: r.currentPage,
      percent: r.currentPercent,
      minutes: r.currentMinutes,
    },
    r.unit as ReadingUnit,
  );
  const [startText, setStartText] = useState(initialStart);
  const [currentText, setCurrentText] = useState(initialCurrent);
  const [startTouched, setStartTouched] = useState(false);
  const [currentTouched, setCurrentTouched] = useState(false);
  const [chapter, setChapter] = useState(r.currentChapter ?? "");

  const edition = data.editions.find((e) => e.id === editionId) ?? null;
  const editionSwitched = (editionId || null) !== r.editionId;
  // Its notes on its own edition (or with none) can follow a new edition (SLN-480): unchecked by default, checked from none
  const ownNotes = row!.ownEditionQuoteCount + row!.ownEditionNoteCount;
  const [moveNotes, setMoveNotes] = useState(!r.editionId);
  const offerMove = editionSwitched && !!editionId && ownNotes > 0;
  const newTotal = readNumber(pages);
  const dateError = done
    ? finishDateError(
        { startedOn: start.date, startedPrecision: start.precision },
        finish,
      )
    : null;
  const totals = { totalPages: newTotal, totalMinutes: parseLength(length) };
  const startEdited = startTouched;
  const parsedStart = startPosition(startText, startUnit, totals);
  const parsedCurrent = startPosition(currentText, currentUnit, totals);
  const currentGiven = { page: parsedCurrent.value.startPage, percent: parsedCurrent.value.startPercent, minutes: parsedCurrent.value.startMinutes };
  const effectiveCurrent = editionSwitched ? remapPosition(r.currentPercent, totals)
    : { page: r.currentPage, minutes: r.currentMinutes,
      percent: percentOf({ page: r.currentPage, minutes: r.currentMinutes, percent: r.currentPercent }, totals) };
  const currentEdited = currentTouched && positionChanges(currentGiven, effectiveCurrent);
  const sessionlessStart = { page: parsedStart.value.startPage, percent: parsedStart.value.startPercent, minutes: parsedStart.value.startMinutes };
  const sessionlessCurrent = { ...remapPosition(percentOf(sessionlessStart, totals), totals),
    ...(sessionlessStart.page !== undefined ? { page: sessionlessStart.page } : {}),
    ...(sessionlessStart.minutes !== undefined ? { minutes: sessionlessStart.minutes } : {}) };
  const currentDisplay = !row!.sessionCount && !done ? editPositionText(sessionlessCurrent, currentUnit)
    : !currentTouched && currentUnit === "percent" ? editPositionText(effectiveCurrent, currentUnit) : currentText;

  // A page count that is not a whole number above 0 is an error, never a cleared count
  const totalError =
    pages.trim() &&
    (newTotal === null || !Number.isInteger(newTotal) || newTotal <= 0)
      ? "Enter the number of pages as a whole number above 0"
      : !editionSwitched &&
          (row!.sessionCount > 0 || done) &&
          !currentEdited &&
          newTotal !== null &&
          r.currentPage !== null &&
          newTotal < r.currentPage
        ? `You are on p. ${r.currentPage}; the book cannot have ${newTotal} pages`
        : null;
  const lengthError =
    format === "audio" && length.trim() && parseLength(length) === null
      ? "Enter a length such as 9:40"
      : null;
  const totalLine =
    !editionSwitched &&
    newTotal &&
    newTotal !== r.totalPages &&
    !currentEdited &&
    r.currentPage !== null &&
    (row!.sessionCount > 0 || done)
      ? `p. ${r.currentPage} of ${newTotal} · ${Math.round(percentOf({ page: r.currentPage }, { totalPages: newTotal }) ?? 0)}%`
      : null;

  const startError = startText.trim()
    ? parsedStart.error
    : "Enter a starting position (0 for the beginning)";
  const currentError =
    !row!.sessionCount && currentEdited
      ? "Log progress once before editing the current position"
      : !row!.sessionCount ? null : currentText.trim()
        ? parsedCurrent.error
        : "Enter a current position";
  const chapterError =
    chapter.trim().length > 300
      ? "Enter a chapter of 1 to 300 characters"
      : null;

  function changeUnit(kind: "start" | "current", unit: ReadingUnit) {
    const value = kind === "start" ? parsedStart.value : parsedCurrent.value;
    const percent = kind === "current" && !currentTouched ? effectiveCurrent.percent : percentOf(
      {
        page: value.startPage,
        percent: value.startPercent,
        minutes: value.startMinutes,
      },
      totals,
    );
    const mapped = remapPosition(percent, totals);
    if (kind === "start") {
      setStartTouched(true);
      setStartUnit(unit);
      setStartText(editPositionText(mapped, unit));
    } else {
      setCurrentUnit(unit);
      setCurrentText(editPositionText(mapped, unit));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (
      dateError ||
      totalError ||
      lengthError ||
      startError ||
      currentError ||
      chapterError
    )
      return;
    const patch: Parameters<typeof updateReading>[0] = {
      readingId: r.id,
      fingerprint: row!.fingerprint,
    };
    if (editionSwitched) patch.editionId = editionId || null;
    if (offerMove && moveNotes) patch.moveNotes = true;
    if ((instanceId || null) !== r.instanceId)
      patch.instanceId = instanceId || null;
    if (format !== r.format) patch.format = format;
    if ((homeId || null) !== r.locationId) patch.locationId = homeId || null;
    if (start.date !== r.startedOn || start.precision !== r.startedPrecision) {
      patch.startedOn = start.date;
      patch.startedPrecision = start.date ? start.precision : "unknown";
    }
    if (
      done &&
      (finish.date !== r.finishedOn || finish.precision !== r.finishedPrecision)
    ) {
      patch.finishedOn = finish.date;
      patch.finishedPrecision = finish.date ? finish.precision : "unknown";
    }
    if (!editionSwitched && newTotal !== r.totalPages)
      patch.totalPages = newTotal;
    const minutes = parseLength(length);
    if (format === "audio" && minutes !== r.totalMinutes)
      patch.totalMinutes = minutes;
    if (rating !== (r.rating != null ? Number(r.rating) : null))
      patch.rating = rating;
    if (reviewChanged) {
      patch.reviewHtml = review?.html ?? null;
      patch.reviewJson = review?.json ?? null;
    }
    if (r.status === "abandoned") {
      if (reason !== r.abandonReason) patch.abandonReason = reason;
      if ((note.trim() || null) !== r.abandonNote)
        patch.abandonNote = note.trim() || null;
    }
    if (startEdited) Object.assign(patch, parsedStart.value);
    if (currentEdited)
      patch.currentPosition = {
        ...(parsedCurrent.value.startPage !== undefined
          ? { page: parsedCurrent.value.startPage }
          : {}),
        ...(parsedCurrent.value.startPercent !== undefined
          ? { percent: parsedCurrent.value.startPercent }
          : {}),
        ...(parsedCurrent.value.startMinutes !== undefined
          ? { minutes: parsedCurrent.value.startMinutes }
          : {}),
      };
    if ((chapter.trim() || null) !== r.currentChapter)
      patch.currentChapter = chapter.trim() || null;
    setSaving(true);
    try {
      await updateReading(patch);
      toast.success("Reading saved");
      onClose();
      changed();
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit reading"
      description={data.workTitle}
      className="max-w-lg"
    >
      <form onSubmit={save} className="space-y-4">
        {data.editions.length > 0 && (
          <div className="space-y-1">
            <Select
              label="Edition"
              value={editionId}
              onChange={(e) => {
                setEditionId(e.target.value);
                setInstanceId("");
                const next = data.editions.find(
                  (ed) => ed.id === e.target.value,
                );
                setPages(next?.pageCount ? String(next.pageCount) : "");
                const nextTotals = {
                  ...totals,
                  totalPages: next?.pageCount ?? null,
                };
                const startPercent = percentOf(
                  {
                    page: parsedStart.value.startPage,
                    percent: parsedStart.value.startPercent,
                    minutes: parsedStart.value.startMinutes,
                  },
                  totals,
                );
                const currentPercent = percentOf(
                  {
                    page: parsedCurrent.value.startPage,
                    percent: parsedCurrent.value.startPercent,
                    minutes: parsedCurrent.value.startMinutes,
                  },
                  totals,
                );
                setStartUnit(next?.pageCount ? startUnit : "percent");
                setCurrentUnit(next?.pageCount ? currentUnit : "percent");
                setStartText(
                  editPositionText(
                    remapPosition(startPercent, nextTotals),
                    next?.pageCount ? startUnit : "percent",
                  ),
                );
                setCurrentText(
                  editPositionText(
                    remapPosition(currentPercent, nextTotals),
                    next?.pageCount ? currentUnit : "percent",
                  ),
                );
              }}
              options={[
                { value: "", label: "No edition" },
                ...data.editions.map((ed) => ({
                  value: ed.id,
                  label: ed.label,
                })),
              ]}
            />
            {editionSwitched && (
              <p className="text-xs text-fg-secondary">
                {switchPreview(r, edition?.pageCount ?? null)}
              </p>
            )}
            {offerMove && (
              <label
                className="flex items-start gap-2 pt-1 text-xs text-fg-secondary pointer-coarse:min-h-11 pointer-coarse:items-center"
                data-edit-move-notes=""
              >
                <input
                  type="checkbox"
                  checked={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.checked)}
                  className="mt-0.5 rounded-sm pointer-coarse:mt-0"
                />
                {r.editionId
                  ? `Also file its ${notesCountText(row!.ownEditionQuoteCount, row!.ownEditionNoteCount)} under the new edition (pages stay as typed)`
                  : `Also file its ${notesCountText(row!.ownEditionQuoteCount, row!.ownEditionNoteCount)} with no edition under this edition`}
              </label>
            )}
          </div>
        )}
        {edition && edition.copies.length > 0 && (
          <Select
            label="Copy"
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            options={[
              { value: "", label: "No copy" },
              ...edition.copies.map((c) => ({ value: c.id, label: c.line })),
            ]}
          />
        )}
        <div className="space-y-1.5">
          <span className="type-label block">Format</span>
          <SegmentedControl
            options={FORMATS}
            value={format}
            onChange={setFormat}
            ariaLabel="Format"
          />
        </div>
        <Select
          label="Home"
          value={homeId}
          onChange={(e) => setHomeId(e.target.value)}
          options={[
            { value: "", label: "Not recorded" },
            ...data.homes.map((h) => ({ value: h.id, label: h.name })),
          ]}
        />
        <ReadingDateField label="Started" value={start} onChange={setStart} />
        {done && (
          <ReadingDateField
            label={r.status === "finished" ? "Finished" : "Stopped"}
            value={finish}
            onChange={setFinish}
          />
        )}
        {dateError && (
          <p className="text-xs text-accent-red-text" role="alert">
            {dateError}
          </p>
        )}
        <div className="flex flex-wrap items-start gap-3">
          {!editionSwitched && (
            <div className="space-y-1">
              <Input
                label="Pages to read"
                inputMode="numeric"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                error={totalError ?? undefined}
                className="w-32"
              />
              {totalLine && (
                <p className="text-xs text-fg-secondary">{totalLine}</p>
              )}
            </div>
          )}
          {format === "audio" && (
            <Input
              label="Audio length (h:mm)"
              placeholder="9:40"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              error={lengthError ?? undefined}
              className="w-32"
            />
          )}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Start unit"
              value={startUnit}
              onChange={(e) =>
                changeUnit("start", e.target.value as ReadingUnit)
              }
              options={UNITS}
            />
            <Input
              label="Starting position"
              value={startText}
              inputMode={startUnit === "minutes" ? "text" : "decimal"}
              onChange={(e) => {
                setStartTouched(true);
                setStartText(e.target.value);
              }}
              error={startError ?? undefined}
            />
          </div>
          {!startError && (
            <p
              className="text-xs text-fg-secondary"
              aria-live="polite"
              data-starting-line
            >
              {startingLine(parsedStart.value, totals)}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Current unit"
              disabled={!row!.sessionCount}
              value={currentUnit}
              onChange={(e) =>
                changeUnit("current", e.target.value as ReadingUnit)
              }
              options={UNITS}
            />
            <Input
              label="Current position"
              value={currentDisplay}
              inputMode={currentUnit === "minutes" ? "text" : "decimal"}
              onChange={(e) => {
                setCurrentTouched(true);
                setCurrentText(e.target.value);
              }}
              error={currentError ?? undefined}
              disabled={!row!.sessionCount}
            />
          </div>
          <p className="text-xs text-fg-secondary">
            {row!.sessionCount
              ? "Corrects the last log; its date and time read stay the same."
              : "Log progress once before editing the current position."}
          </p>
        </div>
        <Input
          label="Current chapter"
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          maxLength={300}
          error={chapterError ?? undefined}
        />
        <div className="space-y-1.5">
          <span className="type-label block">Rating</span>
          <div className="text-sm">
            <RatingInput value={rating} onChange={setRating} label="Rating" />
          </div>
        </div>
        {r.status === "abandoned" && (
          <>
            <Select
              label="Why"
              value={reason}
              onChange={(e) => setReason(e.target.value as AbandonReason)}
              options={ABANDON_REASONS.map((value) => ({
                value,
                label: ABANDON_REASON_LABELS[value],
              }))}
            />
            <Textarea
              aria-label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </>
        )}
        <TiptapEditor
          label="Review"
          value={review}
          onChange={(next) => {
            setReview(next);
            setReviewChanged(true);
          }}
        />
        <DialogFooter
          onCancel={onClose}
          saving={saving}
          disabled={
            !!dateError ||
            !!totalError ||
            !!lengthError ||
            !!startError ||
            !!currentError ||
            !!chapterError
          }
        />
      </form>
    </Dialog>
  );
}
