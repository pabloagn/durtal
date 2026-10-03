import {
  catalogueDateSchema,
  daysInMonth,
  type CatalogueDateInput,
} from "./dates";

/** What the date control asks for: nothing, explicitly unknown, or a precision */
export const DATE_DRAFT_KINDS = [
  "none",
  "unknown",
  "year",
  "month",
  "day",
  "range",
] as const;
export type DateDraftKind = (typeof DATE_DRAFT_KINDS)[number];

export const DATE_DRAFT_LABELS: Record<DateDraftKind, string> = {
  none: "Not recorded",
  unknown: "Unknown",
  year: "Year",
  month: "Month",
  day: "Day",
  range: "Between years",
};

/** The fields as typed: text, so a half-typed year is kept as it is */
export interface DateDraft {
  kind: DateDraftKind;
  year: string;
  month: string;
  day: string;
  endYear: string;
  approximate: boolean;
  /** Before year 1: the year counts back (BC) */
  bce: boolean;
  endBce: boolean;
  /** A stored label, kept until the date is edited */
  label: string | null;
}

/** The typed fields of a stored date (or of none). */
export function dateDraft(value: CatalogueDateInput | null | undefined): DateDraft {
  const empty: DateDraft = {
    kind: "none",
    year: "",
    month: "",
    day: "",
    endYear: "",
    approximate: false,
    bce: false,
    endBce: false,
    label: null,
  };
  const parsed = value ? catalogueDateSchema.safeParse(value) : null;
  if (!parsed?.success) return empty;
  const v = parsed.data;
  if (!v.start) return { ...empty, kind: "unknown", label: v.label };
  return {
    kind: v.precision,
    year: String(Math.abs(v.start.year)),
    month: v.start.month === null ? "" : String(v.start.month),
    day: v.start.day === null ? "" : String(v.start.day),
    endYear: v.end ? String(Math.abs(v.end.year)) : "",
    approximate: v.approximate,
    bce: v.start.year < 0,
    endBce: !!v.end && v.end.year < 0,
    label: v.label,
  };
}

function readYear(text: string, bce: boolean) {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n === 0 ? 0 : bce ? -n : n;
}

/**
 * The date the fields describe, or why they do not describe one. "Not
 * recorded" is `null`; every other kind gives a value the catalogue accepts.
 */
export function dateDraftValue(draft: DateDraft): {
  value: CatalogueDateInput | null;
  error: string | null;
} {
  if (draft.kind === "none") return { value: null, error: null };
  if (draft.kind === "unknown")
    return { value: { precision: "unknown", label: draft.label }, error: null };
  const year = readYear(draft.year, draft.bce);
  if (year === null) return { value: null, error: "Enter a year" };
  if (year === 0) return { value: null, error: "There is no year 0" };
  const approximate = draft.approximate;
  if (draft.kind === "range") {
    const end = readYear(draft.endYear, draft.endBce);
    if (end === null) return { value: null, error: "Enter the last year" };
    if (end === 0) return { value: null, error: "There is no year 0" };
    if (end < year)
      return { value: null, error: "The last year comes before the first" };
    return {
      value: {
        precision: "range",
        start: { year },
        end: { year: end },
        approximate,
        label: draft.label,
      },
      error: null,
    };
  }
  if (draft.kind === "year")
    return {
      value: { precision: "year", start: { year }, approximate, label: draft.label },
      error: null,
    };
  const month = Number(draft.month);
  if (!Number.isInteger(month) || month < 1 || month > 12)
    return { value: null, error: "Choose a month" };
  if (draft.kind === "month")
    return {
      value: {
        precision: "month",
        start: { year, month },
        approximate,
        label: draft.label,
      },
      error: null,
    };
  const day = Number(draft.day.trim());
  if (!/^\d{1,2}$/.test(draft.day.trim()) || day < 1 || day > daysInMonth(year, month))
    return { value: null, error: "Enter a day of that month" };
  return {
    value: {
      precision: "day",
      start: { year, month, day },
      approximate,
      label: draft.label,
    },
    error: null,
  };
}
