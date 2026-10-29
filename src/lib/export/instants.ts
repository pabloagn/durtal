import { catalogueDateSchema, daysInMonth, type CatalogueDate } from "@/lib/catalogue/dates";

const ZERO = BigInt(0), ONE = BigInt(1), DAY = BigInt(86400000000);
const floor = (a: bigint, b: bigint) => { const q = a / b; return a % b < ZERO ? q - ONE : q; };
const bi = BigInt;

/** PostgreSQL sends integer microseconds as text: never pass through Number or Date. */
export function instantMicros(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) throw new Error("Expected canonical integer microseconds");
  const n = bi(value);
  if (n < -(ONE << bi(63)) || n > (ONE << bi(63)) - ONE) throw new Error("Timestamp outside signed INT64");
  return n;
}
function civilFromDays(days: bigint) {
  const z = days + bi(719468), era = floor(z, bi(146097)), doe = z - era * bi(146097);
  const yoe = (doe - doe / bi(1460) + doe / bi(36524) - doe / bi(146096)) / bi(365);
  let y = yoe + era * bi(400);
  const doy = doe - (bi(365) * yoe + yoe / bi(4) - yoe / bi(100)), mp = (bi(5) * doy + bi(2)) / bi(153);
  const d = doy - (bi(153) * mp + bi(2)) / bi(5) + ONE, m = mp + (mp < bi(10) ? bi(3) : -bi(9));
  if (m <= bi(2)) y += ONE;
  return { y, m, d };
}
const pad = (n: bigint, width = 2) => n.toString().padStart(width, "0");
function dateString(days: bigint) {
  const { y, m, d } = civilFromDays(days);
  const year = y >= ZERO && y <= bi(9999) ? pad(y, 4) : `${y < ZERO ? "-" : "+"}${pad(y < ZERO ? -y : y, 6)}`;
  return `${year}-${pad(m)}-${pad(d)}`;
}
export function instantISO(value: unknown): string {
  const n = instantMicros(value), days = floor(n, DAY), time = n - days * DAY;
  const seconds = time / bi(1000000), fraction = time % bi(1000000);
  return `${dateString(days)}T${pad(seconds / bi(3600))}:${pad(seconds / bi(60) % bi(60))}:${pad(seconds % bi(60))}.${pad(fraction, 6)}Z`;
}
export function dateISO(days: number): string { return dateString(bi(days)); }

/** SQL date text is not a formatted catalogue label. */
function sqlCivil(value: unknown) {
  if (typeof value !== "string") throw new Error("Expected SQL date text");
  const m = /^(\d+)-(\d{2})-(\d{2})( BC)?$/.exec(value);
  if (!m) throw new Error("Invalid SQL date text");
  const year = Number(m[1]) * (m[4] ? -1 : 1), month = Number(m[2]), day = Number(m[3]);
  if (!Number.isSafeInteger(year) || year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new Error("Invalid SQL civil date");
  return { year, month, day };
}
export function readingDate(value: unknown, precision: unknown = "day"): CatalogueDate | null {
  if (value === null) return null;
  const { year, month, day } = sqlCivil(value);
  if (precision !== "year" && precision !== "month" && precision !== "day") throw new Error("Invalid reading date precision");
  return catalogueDateSchema.parse({ precision, start: { year, month: precision === "year" ? null : month, day: precision === "day" ? day : null }, end: null, approximate: false, label: null });
}
export function sqlDateDays(value: unknown): number {
  const civil = sqlCivil(value);
  let y = bi(civil.year < 0 ? civil.year + 1 : civil.year);
  const m = bi(civil.month), d = bi(civil.day);
  if (m <= bi(2)) y -= ONE;
  const era = floor(y, bi(400)), yoe = y - era * bi(400);
  const mp = m + (m > bi(2) ? -bi(3) : bi(9));
  const days = era * bi(146097) + yoe * bi(365) + yoe / bi(4) - yoe / bi(100) + (bi(153) * mp + bi(2)) / bi(5) + d - ONE - bi(719468);
  if (days < bi(-2147483648) || days > bi(2147483647)) throw new Error("Date outside signed INT32");
  return Number(days);
}
