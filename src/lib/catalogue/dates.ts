import { z } from "zod";

export const DATE_PRECISIONS = [
  "unknown",
  "year",
  "month",
  "day",
  "range",
] as const;
const year = z
  .number()
  .int()
  .min(-999999)
  .max(999999)
  .refine((value) => value !== 0, "Civil dates have no year zero");
const endpoint = z.object({
  year,
  month: z.number().int().min(1).max(12).nullable().default(null),
  day: z.number().int().min(1).max(31).nullable().default(null),
});
export function daysInMonth(year: number, month: number) {
  // Astronomical year zero corresponds to civil 1 BCE.
  const astronomical = year < 0 ? year + 1 : year;
  const leap =
    astronomical % 4 === 0 &&
    (astronomical % 100 !== 0 || astronomical % 400 === 0);
  return month === 2
    ? leap
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;
}
type Endpoint = z.output<typeof endpoint>;
function lower(value: Endpoint) {
  return value.year * 10000 + (value.month ?? 1) * 100 + (value.day ?? 1);
}
function upper(value: Endpoint) {
  const month = value.month ?? 12;
  return (
    value.year * 10000 +
    month * 100 +
    (value.day ?? daysInMonth(value.year, month))
  );
}
export const catalogueDateSchema = z
  .object({
    precision: z.enum(DATE_PRECISIONS),
    start: endpoint.nullable().default(null),
    end: endpoint.nullable().default(null),
    approximate: z.boolean().default(false),
    label: z.string().trim().min(1).max(300).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    for (const key of ["start", "end"] as const) {
      const point = value[key];
      if (
        point &&
        ((point.day !== null && point.month === null) ||
          (point.month !== null &&
            point.day !== null &&
            point.day > daysInMonth(point.year, point.month)))
      )
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Invalid calendar date",
        });
    }
    const valid =
      value.precision === "unknown"
        ? !value.start && !value.end
        : value.precision === "range"
          ? !!value.start &&
            !!value.end &&
            lower(value.start) <= upper(value.end)
          : !!value.start &&
            !value.end &&
            (value.precision === "year"
              ? value.start.month === null && value.start.day === null
              : value.precision === "month"
                ? value.start.month !== null && value.start.day === null
                : value.start.month !== null && value.start.day !== null);
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message:
          "Date components must match the stated precision and range order",
      });
  });
export type CatalogueDateInput = z.input<typeof catalogueDateSchema>;
export type CatalogueDate = z.output<typeof catalogueDateSchema>;
export function normalizeCatalogueDate(input: CatalogueDateInput) {
  const value = catalogueDateSchema.parse(input);
  return {
    ...value,
    lowerBound: value.start ? lower(value.start) : null,
    upperBound: value.start ? upper(value.end ?? value.start) : null,
  };
}
export function dateColumns(input: CatalogueDateInput) {
  const value = catalogueDateSchema.parse(input);
  return {
    precision: value.precision,
    startYear: value.start?.year ?? null,
    startMonth: value.start?.month ?? null,
    startDay: value.start?.day ?? null,
    endYear: value.end?.year ?? null,
    endMonth: value.end?.month ?? null,
    endDay: value.end?.day ?? null,
    approximate: value.approximate,
    label: value.label,
  };
}
/** True unless the start definitely falls after the end; partial dates compare by their bounds. */
export function datesInOrder(
  start: CatalogueDateInput | null | undefined,
  end: CatalogueDateInput | null | undefined,
) {
  if (!start || !end) return true;
  const a = normalizeCatalogueDate(start),
    b = normalizeCatalogueDate(end);
  return a.lowerBound === null || b.upperBound === null
    ? true
    : a.lowerBound <= b.upperBound;
}

/** The stored columns of one date value, back in input form. */
export function dateFromColumns(row: {
  precision: (typeof DATE_PRECISIONS)[number];
  startYear: number | null;
  startMonth: number | null;
  startDay: number | null;
  endYear: number | null;
  endMonth: number | null;
  endDay: number | null;
  approximate: boolean;
  label: string | null;
}): CatalogueDate {
  return catalogueDateSchema.parse({
    precision: row.precision,
    start:
      row.startYear === null
        ? null
        : { year: row.startYear, month: row.startMonth, day: row.startDay },
    end:
      row.endYear === null
        ? null
        : { year: row.endYear, month: row.endMonth, day: row.endDay },
    approximate: row.approximate,
    label: row.label,
  });
}

/**
 * Every column that references a date value. Date values are immutable and
 * owned by one record, so a replaced or deleted value is removed only when none
 * of these still points at it. An integration test keeps this list equal to the
 * database's foreign keys.
 */
export const CATALOGUE_DATE_REFERENCES = [
  ["perfume_details", "release_date_id"],
  ["perfume_details", "discontinued_date_id"],
  ["perfume_variants", "release_date_id"],
  ["perfume_variants", "discontinued_date_id"],
  ["perfume_bottles", "acquisition_date_id"],
  ["perfume_bottles", "disposition_date_id"],
  ["film_details", "release_date_id"],
  ["film_releases", "release_date_id"],
  ["film_holdings", "acquisition_date_id"],
  ["film_holdings", "disposition_date_id"],
  ["painting_details", "creation_date_id"],
  ["art_objects", "creation_date_id"],
  ["art_objects", "acquisition_date_id"],
  ["art_objects", "disposition_date_id"],
  ["art_object_whereabouts", "starts_on_id"],
  ["art_object_whereabouts", "ends_on_id"],
] as const;

export function displayCatalogueDate(input: CatalogueDateInput) {
  const value = catalogueDateSchema.parse(input);
  if (value.label) return value.label;
  if (!value.start) return "Unknown";
  const label = (point: Endpoint) =>
    `${Math.abs(point.year)}${point.month !== null ? `-${String(point.month).padStart(2, "0")}` : ""}${point.day !== null ? `-${String(point.day).padStart(2, "0")}` : ""}${point.year < 0 ? " BCE" : ""}`;
  return `${value.approximate ? "c. " : ""}${label(value.start)}${value.end ? `–${label(value.end)}` : ""}`;
}

/** Existing books keep their original columns; missing precision stays missing. */
export function legacyYearDate(
  year: number | null | undefined,
  approximate = false,
): CatalogueDate {
  return catalogueDateSchema.parse(
    year === null || year === undefined
      ? { precision: "unknown" }
      : { precision: "year", start: { year }, approximate },
  );
}

function yearLabel(year: number) {
  return year < 0 ? `${-year} BC` : String(year);
}

/** "1888", "c. 1503–1519": a catalogue date to the year. */
export function catalogueDateYears(date: CatalogueDate | null) {
  if (!date?.start) return date?.label ?? null;
  const end =
    date.end && date.end.year !== date.start.year
      ? `–${yearLabel(date.end.year)}`
      : "";
  return `${date.approximate ? "c. " : ""}${yearLabel(date.start.year)}${end}`;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * "May 3, 2019", "May 2019", "c. 1925", "1920–1929" or the date's own
 * label, to the precision it was recorded with; "Unknown" when it is
 * explicitly unknown, null when no date was recorded.
 */
export function catalogueDateText(date: CatalogueDate | null) {
  if (!date) return null;
  if (date.label) return date.label;
  if (!date.start) return "Unknown";
  const point = (p: Endpoint) =>
    p.month === null
      ? yearLabel(p.year)
      : p.day === null
        ? `${MONTH_NAMES[p.month - 1]} ${yearLabel(p.year)}`
        : `${MONTH_NAMES[p.month - 1]} ${p.day}, ${yearLabel(p.year)}`;
  return `${date.approximate ? "c. " : ""}${point(date.start)}${date.end ? `–${point(date.end)}` : ""}`;
}
