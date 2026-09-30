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
