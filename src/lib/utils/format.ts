/**
 * Display formatting utilities for the Durtal book catalogue.
 */

import { displayYear } from "./years";

/**
 * Format a file size in bytes to a human-readable string.
 * e.g. 2_400_000 -> "2.4 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  const formatted = value % 1 === 0 ? value.toString() : value.toFixed(1);
  return `${formatted} ${units[i]}`;
}

/**
 * Format physical dimensions to a display string.
 * Returns null if all dimensions are absent.
 * e.g. (230, 150, 25) -> "230 x 150 x 25 mm"
 * e.g. (230, 150, null) -> "230 x 150 mm"
 */
export function formatDimensions(
  h?: number | null,
  w?: number | null,
  d?: number | null,
): string | null {
  const parts = [h, w, d].filter((v): v is number => v != null && v > 0);
  if (parts.length === 0) return null;
  return `${parts.join(" x ")} mm`;
}

/**
 * Format a price with optional currency prefix.
 * Returns null if price is absent.
 * e.g. ("29.99", "EUR") -> "EUR 29.99"
 * e.g. (29.99, null) -> "29.99"
 */
export function formatPrice(
  price: string | number | null,
  currency?: string | null,
): string | null {
  if (price == null || price === "") return null;
  const priceStr =
    typeof price === "number" ? price.toFixed(2) : String(price);
  if (currency) return `${currency} ${priceStr}`;
  return priceStr;
}

/**
 * Format a date string (ISO or partial) for display.
 * Returns null if absent.
 * e.g. "2023-09-15" -> "15 September 2023"
 * e.g. "2023-09" -> "September 2023"
 * e.g. "2023" -> "2023"
 */
export function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  // Full ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    try {
      const d = new Date(`${dateStr}T00:00:00Z`);
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return dateStr;
    }
  }
  // Year-month only
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    try {
      const d = new Date(`${dateStr}-01T00:00:00Z`);
      return d.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return dateStr;
    }
  }
  // Year only or fallback
  return dateStr;
}

/** How many of a list's books can be read here: "1 available as an eBook", "3 available as eBooks" */
export function ebooksAvailableText(count: number): string {
  return `${count.toLocaleString("en")} available as ${count === 1 ? "an eBook" : "eBooks"}`;
}

/** A count and its noun in the right form, thousands grouped: "1 book", "1,107 books", "2 copies" */
export function countLabel(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

/** A person's years, from the authors table: approximate years read "c." */
export interface LifeYears {
  birthYear?: number | null;
  deathYear?: number | null;
  birthYearIsApproximate?: boolean | null;
  deathYearIsApproximate?: boolean | null;
}

const lifeYear = (year: number, approximate?: boolean | null) =>
  `${approximate ? "c. " : ""}${displayYear(year)}`;

/**
 * A person's life dates, the same on their page, the cards, the rows, the
 * map and the timeline (SLN-1006): "1848–1907", "b. 1950" for the living,
 * "d. 1890" when only the death is known, "c. 1450–1500"; null with neither.
 */
export function lifeDates(person: LifeYears): string | null {
  const { birthYear, deathYear } = person;
  if (birthYear != null && deathYear != null)
    return `${lifeYear(birthYear, person.birthYearIsApproximate)}–${lifeYear(deathYear, person.deathYearIsApproximate)}`;
  if (birthYear != null) return `b. ${lifeYear(birthYear, person.birthYearIsApproximate)}`;
  if (deathYear != null) return `d. ${lifeYear(deathYear, person.deathYearIsApproximate)}`;
  return null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A birth or death as the person page's Born and Died lines say it, as
 * precise as it is known: "5 February 1848, Paris", "May 1907", "c. 1450",
 * "Paris"; null when nothing is known.
 */
export function lifeEvent(event: {
  year?: number | null;
  month?: number | null;
  day?: number | null;
  approximate?: boolean | null;
  place?: string | null;
}): string | null {
  let when: string | null = null;
  if (event.year != null) {
    const month = event.month && event.month >= 1 && event.month <= 12 ? MONTHS[event.month - 1] : null;
    // A day or month on an approximate year would claim more than is known
    when = month && !event.approximate
      ? `${event.day ? `${event.day} ` : ""}${month} ${displayYear(event.year)}`
      : lifeYear(event.year, event.approximate);
  }
  const parts = [when, event.place?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
