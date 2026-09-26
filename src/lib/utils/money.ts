import { DEFAULT_CURRENCY } from "@/lib/constants/currencies";

export interface CurrencyTotal {
  currency: string | null;
  total: string;
}

/**
 * Format an amount in its own currency, e.g. (285.46, "EUR") -> "€285.46".
 * Without a currency the plain number is shown; no currency is assumed.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount == null || amount === "") return "—";
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(num)) return "—";
  if (!currency) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

/**
 * Order per-currency totals for display: the default currency first, then
 * the largest amounts, and orders without a currency last. Zero totals drop.
 */
export function sortCurrencyTotals(rows: CurrencyTotal[]): CurrencyTotal[] {
  const rank = (row: CurrencyTotal) =>
    row.currency === DEFAULT_CURRENCY ? 0 : row.currency ? 1 : 2;
  return rows
    .filter(
      (row) => parseFloat(row.total) !== 0 && !isNaN(parseFloat(row.total)),
    )
    .sort(
      (a, b) => rank(a) - rank(b) || parseFloat(b.total) - parseFloat(a.total),
    );
}
