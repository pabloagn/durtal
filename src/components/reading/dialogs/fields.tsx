"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { catalogueDateOf, READING_DATE_KINDS, readingDateOf } from "@/lib/reading/dates";
import type { ReadingDatePrecision } from "@/lib/reading/constants";

/*
 * Fields the reading dialogs share (SLN-447): a reading date (a day, or a
 * partial date when not exact), the footer, and audio lengths as h:mm.
 */

export interface ReadingDate {
  date: string | null;
  precision: ReadingDatePrecision;
}

/** A date picker; "Date not exact" switches to a year, a month or unknown */
export function ReadingDateField({
  label,
  value,
  onChange,
  partialLabel = "Date not exact",
}: {
  label: string;
  value: ReadingDate;
  onChange: (value: ReadingDate) => void;
  partialLabel?: string;
}) {
  const [partial, setPartial] = useState(value.precision !== "day");
  return (
    <div className="space-y-1.5">
      {partial ? (
        <CatalogueDateField
          label={label}
          kinds={READING_DATE_KINDS}
          allowApproximate={false}
          value={catalogueDateOf(value.date, value.precision) as never}
          onChange={(next) => onChange(readingDateOf(next as never))}
        />
      ) : (
        <DatePicker label={label} value={value.date ?? ""} onChange={(day) => onChange({ date: day || null, precision: day ? "day" : "unknown" })} />
      )}
      <button
        type="button"
        onClick={() => setPartial((p) => !p)}
        className="text-xs text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline pointer-coarse:min-h-11"
      >
        {partial ? "Pick a day" : partialLabel}
      </button>
    </div>
  );
}

/** "9:40" or "9h40" as minutes, "45" or "45 min" as minutes; null when empty or not a time */
export function parseLength(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const hours = s.match(/^(\d+)\s*[:h]\s*([0-5]?\d)?\s*m?$/);
  if (hours) return Number(hours[1]) * 60 + Number(hours[2] ?? 0);
  const minutes = s.match(/^(\d+)\s*(m|min)?$/);
  return minutes ? Number(minutes[1]) : null;
}

export function DialogFooter({
  onCancel,
  saving,
  saveLabel = "Save",
  disabled = false,
}: {
  onCancel: () => void;
  saving: boolean;
  saveLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="ghost" onClick={onCancel} className="pointer-coarse:h-11">
        Cancel
      </Button>
      <Button type="submit" variant="primary" data-shortcut="save" disabled={saving || disabled} className="pointer-coarse:h-11">
        {saving ? "Saving..." : saveLabel}
      </Button>
    </div>
  );
}
