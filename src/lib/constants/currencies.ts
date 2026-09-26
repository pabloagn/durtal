// Supported ISO 4217 currency codes with display labels.
// Sorted by expected frequency of use.

export interface CurrencyOption {
  code: string;
  symbol: string;
  label: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: "EUR", symbol: "\u20AC", label: "EUR \u20AC" },
  { code: "USD", symbol: "$", label: "USD $" },
  { code: "GBP", symbol: "\u00A3", label: "GBP \u00A3" },
  { code: "CHF", symbol: "CHF", label: "CHF" },
  { code: "PLN", symbol: "z\u0142", label: "PLN z\u0142" },
  { code: "CZK", symbol: "K\u010D", label: "CZK K\u010D" },
  { code: "SEK", symbol: "kr", label: "SEK kr" },
  { code: "NOK", symbol: "kr", label: "NOK kr" },
  { code: "DKK", symbol: "kr", label: "DKK kr" },
  { code: "JPY", symbol: "\u00A5", label: "JPY \u00A5" },
  { code: "CAD", symbol: "CA$", label: "CAD $" },
  { code: "AUD", symbol: "A$", label: "AUD $" },
  { code: "BRL", symbol: "R$", label: "BRL R$" },
  { code: "MXN", symbol: "MX$", label: "MXN $" },
  { code: "ARS", symbol: "AR$", label: "ARS $" },
  { code: "CLP", symbol: "CL$", label: "CLP $" },
  { code: "CNY", symbol: "\u00A5", label: "CNY \u00A5" },
  { code: "KRW", symbol: "\u20A9", label: "KRW \u20A9" },
  { code: "INR", symbol: "\u20B9", label: "INR \u20B9" },
  { code: "TRY", symbol: "\u20BA", label: "TRY \u20BA" },
  { code: "ZAR", symbol: "R", label: "ZAR R" },
  { code: "RUB", symbol: "\u20BD", label: "RUB \u20BD" },
];

export const DEFAULT_CURRENCY = "EUR";

export const CURRENCY_SELECT_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: c.label,
}));

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.code);

/** localStorage key for the last currency picked in an order dialog. */
export const PREFERRED_CURRENCY_KEY = "durtal:preferred-currency";

export function isSupportedCurrency(
  code: string | null | undefined,
): code is string {
  return code != null && CURRENCY_CODES.includes(code);
}

export function currencySymbol(code: string | null | undefined): string | null {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? null;
}

/** Last currency used in an order dialog, or the default. Browser only. */
export function preferredCurrency(): string {
  if (typeof window === "undefined") return DEFAULT_CURRENCY;
  try {
    const stored = localStorage.getItem(PREFERRED_CURRENCY_KEY);
    return isSupportedCurrency(stored) ? stored : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

export function rememberCurrency(code: string): void {
  try {
    localStorage.setItem(PREFERRED_CURRENCY_KEY, code);
  } catch {
    // Storage can be blocked; the default still applies next time.
  }
}
