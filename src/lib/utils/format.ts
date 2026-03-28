/**
 * Display formatting utilities for the Durtal book catalogue.
 */

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
