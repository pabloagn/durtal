import { DEFAULT_CURRENCY } from "@/lib/constants/currencies";

export interface CurrencyTotal {
  currency: string | null;
  total: string;
}

/**
 * Format an amount in its own currency, e.g. (1450, "EUR") -> "€1,450.00".
 * The one price format for every kind of thing. A code that isn't ISO 4217
 * shows before the grouped number ("XX 1,450.00"). Without a currency the
 * plain number is shown; no currency is assumed.
 */
export function formatMoney(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount == null || amount === "") return "—";
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (!Number.isFinite(num)) return "—";
  const plain = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!currency) return plain.format(num);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(
      num,
    );
  } catch {
    return `${currency} ${plain.format(num)}`;
  }
}

/**
 * Order per-currency totals for display: the home currency first, then the
 * largest amounts, and orders without a currency last. Zero totals drop.
 */
export function sortCurrencyTotals(
  rows: CurrencyTotal[],
  homeCurrency: string = DEFAULT_CURRENCY,
): CurrencyTotal[] {
  const rank = (row: CurrencyTotal) =>
    row.currency === homeCurrency ? 0 : row.currency ? 1 : 2;
  return rows
    .filter(
      (row) => parseFloat(row.total) !== 0 && !isNaN(parseFloat(row.total)),
    )
    .sort(
      (a, b) => rank(a) - rank(b) || parseFloat(b.total) - parseFloat(a.total),
    );
}
