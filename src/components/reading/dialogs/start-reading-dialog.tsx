"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { findPageCount, startReading } from "@/lib/actions/reading";
import { formatOfCopy, type ReadingFormat } from "@/lib/reading/constants";
import { isAtHand } from "@/lib/reading/at-hand";
import { pickDefaultEdition } from "@/lib/reading/defaults";
import { formatMinutes, percentOf } from "@/lib/reading/positions";
import { browserZone, showError, todayReadingDay } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter, parseLength, ReadingDateField, type ReadingDate } from "./fields";

const FORMATS = [
  { value: "print", label: "Print" },
  { value: "ebook", label: "E-book" },
  { value: "audio", label: "Audio" },
] as const;

const NOT_HOME = "none";

/** "25" or "25,5" as a number; null when not one */
export function readNumber(text: string) {
  const s = text.trim().replace(",", ".");
  return s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/**
 * The start position a dialog sends: exactly one of a page, a percent or
 * minutes, in the reading's unit, or why it cannot be one.
 */
export function startPosition(
  text: string,
  unit: "pages" | "percent" | "minutes",
  totals: { totalPages: number | null; totalMinutes: number | null },
): { value: { startPage?: number; startPercent?: number; startMinutes?: number }; error: string | null } {
  if (!text.trim()) return { value: {}, error: null };
  if (unit === "minutes") {
    const minutes = parseLength(text);
    if (minutes === null) return { value: {}, error: "Enter a time such as 3:12" };
    if (totals.totalMinutes && minutes > totals.totalMinutes) return { value: {}, error: `${formatMinutes(minutes)} is past the end, ${formatMinutes(totals.totalMinutes)}` };
    return { value: { startMinutes: minutes }, error: null };
  }
  const n = readNumber(text);
  if (unit === "percent") {
    if (n === null || n > 100) return { value: {}, error: "Enter 0 to 100%" };
    return { value: { startPercent: n }, error: null };
  }
  if (n === null || !Number.isInteger(n)) return { value: {}, error: "Enter a whole page number" };
  if (totals.totalPages && n > totals.totalPages) return { value: {}, error: `Page ${n} is past the last page, ${totals.totalPages}` };
  return { value: { startPage: n }, error: null };
}

/** Start a reading: where, which edition and copy, the format, the pages, when and from where */
export function StartReadingDialog({ data, home: storedHome, setHome, onClose, changed }: ReadingDialogProps) {
  const lastEditionId = data.rows.find((r) => r.reading.editionId)?.reading.editionId ?? null;
  const [home, setHomeState] = useState<string>(storedHome ?? data.homes[0]?.id ?? NOT_HOME);
  const homeId = home === NOT_HOME ? null : home;
  const initial = useMemo(
    () => pickDefaultEdition(data.editions, { homeId, lastReadingEditionId: lastEditionId }),
    // The default is chosen when the dialog opens and when the home changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home],
  );
  const [touched, setTouched] = useState(false);
  const [editionId, setEditionId] = useState(initial.editionId ?? "");
  const [instanceId, setInstanceId] = useState(initial.instanceId ?? "");
  const edition = data.editions.find((e) => e.id === editionId) ?? null;
  const copy = edition?.copies.find((c) => c.id === instanceId) ?? null;
  const [format, setFormat] = useState<ReadingFormat>(formatOfCopy(copy?.format));
  const [pages, setPages] = useState(edition?.pageCount ? String(edition.pageCount) : "");
  const lastLength = (id: string) =>
    data.rows.find((r) => r.reading.editionId === id && r.reading.totalMinutes)?.reading.totalMinutes ?? null;
  const [length, setLength] = useState(() => {
    const m = initial.editionId ? lastLength(initial.editionId) : null;
    return m ? formatMinutes(m) : "";
  });
  const [start, setStart] = useState<ReadingDate>(() => ({ date: todayReadingDay(data.dayStartHour), precision: "day" }));
  const [already, setAlready] = useState("");
  const [saving, setSaving] = useState(false);
  const [finding, setFinding] = useState(false);

  function chooseEdition(id: string, copyId?: string) {
    setEditionId(id);
    const next = data.editions.find((e) => e.id === id);
    const nextCopy = copyId !== undefined ? copyId : (next?.copies[0]?.id ?? "");
    setInstanceId(nextCopy);
    setFormat(formatOfCopy(next?.copies.find((c) => c.id === nextCopy)?.format));
    setPages(next?.pageCount ? String(next.pageCount) : "");
    const m = lastLength(id);
    setLength(m ? formatMinutes(m) : "");
  }

  function chooseHome(next: string) {
    setHomeState(next);
    setHome(next);
    if (touched) return;
    const pick = pickDefaultEdition(data.editions, { homeId: next === NOT_HOME ? null : next, lastReadingEditionId: lastEditionId });
    if (pick.editionId) chooseEdition(pick.editionId, pick.instanceId ?? "");
  }

  const totalPages = readNumber(pages);
  const totalMinutes = format === "audio" ? parseLength(length) : null;
  const unit = format === "audio" ? "minutes" : totalPages ? "pages" : "percent";
  const position = startPosition(already, unit, { totalPages, totalMinutes });
  const share = percentOf(
    { page: position.value.startPage, minutes: position.value.startMinutes, percent: position.value.startPercent },
    { totalPages, totalMinutes },
  );
  const live = position.error
    ? position.error
    : already.trim()
      ? `Starting at ${
          position.value.startPage !== undefined
            ? `p. ${position.value.startPage}${totalPages ? ` of ${totalPages}` : ""}`
            : position.value.startMinutes !== undefined
              ? formatMinutes(position.value.startMinutes)
              : ""
        }${share !== null ? `${position.value.startPercent === undefined ? " · " : ""}${Math.round(share * 100) / 100}%` : ""}`
      : null;
  // The reading's home: the copy's place when it is physical, else "I'm at"
  const readingHome = copy && copy.locationType === "physical" ? { id: copy.locationId, name: copy.locationName } : homeId ? { id: homeId, name: data.homes.find((h) => h.id === homeId)?.name ?? null } : null;
  const copies = edition ? [...edition.copies].sort((a, b) => Number(isAtHand(b, homeId)) - Number(isAtHand(a, homeId))) : [];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (position.error) return;
    setSaving(true);
    try {
      await startReading({
        workId: data.workId,
        editionId: editionId || null,
        instanceId: instanceId || null,
        locationId: readingHome?.id ?? null,
        format,
        unit,
        totalPages: format === "audio" ? (edition?.pageCount ?? null) : totalPages,
        totalMinutes,
        startedOn: start.date,
        startedPrecision: start.date ? start.precision : "unknown",
        ...position.value,
        timeZone: browserZone(),
      });
      toast.success(`Started ${data.workTitle}`);
      onClose();
      changed();
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  async function lookUpPages() {
    if (!editionId) return;
    setFinding(true);
    try {
      const found = await findPageCount(editionId);
      if (found) setPages(String(found.pageCount));
      else toast.error("No source has a page count for this edition");
    } catch (err) {
      showError(err, changed);
    } finally {
      setFinding(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Start reading" description={data.workTitle} className="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        <Select
          label="I'm at"
          value={home}
          onChange={(e) => chooseHome(e.target.value)}
          options={[...data.homes.map((h) => ({ value: h.id, label: h.name })), { value: NOT_HOME, label: "Not at home" }]}
        />
        {data.editions.length > 0 && (
          <Select
            label="Edition"
            value={editionId}
            onChange={(e) => {
              setTouched(true);
              chooseEdition(e.target.value);
            }}
            options={data.editions.map((ed) => ({ value: ed.id, label: ed.label }))}
          />
        )}
        {edition && (
          <div className="space-y-1">
            <Select
              label="Copy"
              value={instanceId}
              onChange={(e) => {
                setTouched(true);
                setInstanceId(e.target.value);
                setFormat(formatOfCopy(edition.copies.find((c) => c.id === e.target.value)?.format));
              }}
              options={[...copies.map((c) => ({ value: c.id, label: c.line })), { value: "", label: "No copy (borrowed, library)" }]}
            />
            <p className="text-xs text-fg-secondary">{readingHome?.name ? `Reading in ${readingHome.name}` : "No home for this reading"}</p>
          </div>
        )}
        <div className="space-y-1.5">
          <span className="type-label block">Format</span>
          <SegmentedControl options={FORMATS} value={format} onChange={setFormat} ariaLabel="Format" />
        </div>
        {format !== "audio" ? (
          <div className="flex items-end gap-2">
            <Input label="Pages to read" inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} className="w-32" />
            {edition && !edition.pageCount && (
              <Button type="button" variant="ghost" size="sm" onClick={lookUpPages} disabled={finding} className="pointer-coarse:h-11">
                {finding ? "Looking..." : "Find page count"}
              </Button>
            )}
          </div>
        ) : (
          <Input label="Audio length (h:mm)" placeholder="9:40" value={length} onChange={(e) => setLength(e.target.value)} className="w-32" />
        )}
        <ReadingDateField label="Start date" value={start} onChange={setStart} partialLabel="Earlier, date not exact" />
        <div className="space-y-1">
          <Input
            label={`Already at (optional, ${unit === "pages" ? "page" : unit === "minutes" ? "h:mm" : "%"})`}
            inputMode={unit === "minutes" ? "text" : "decimal"}
            value={already}
            onChange={(e) => setAlready(e.target.value)}
            className="w-40"
          />
          {live && <p className={`text-xs ${position.error ? "text-accent-red-text" : "text-fg-secondary"}`}>{live}</p>}
        </div>
        <DialogFooter onCancel={onClose} saving={saving} saveLabel="Start reading" disabled={!!position.error} />
      </form>
    </Dialog>
  );
}
