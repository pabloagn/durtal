import { describe, expect, it } from "vitest";
import { formatMoney, sortCurrencyTotals } from "@/lib/utils/money";
import {
  currencyOptions,
  currencySymbol,
  isSupportedCurrency,
} from "@/lib/constants/currencies";
import {
  orderCurrencySchema,
  createOrderSchema,
} from "@/lib/validations/orders";

describe("formatMoney", () => {
  it.each([
    ["285.46", "EUR", "€285.46"],
    ["13.51", "GBP", "£13.51"],
    [1234.5, "USD", "$1,234.50"],
    ["0", "EUR", "€0.00"],
    ["1450", "EUR", "€1,450.00"],
    ["18.5", "EUR", "€18.50"],
    [9800, "JPY", "¥9,800"],
    [1234567.891, "GBP", "£1,234,567.89"],
  ])("formats %s %s", (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
  });

  it("never assumes a currency when none is stored", () => {
    expect(formatMoney("19.13", null)).toBe("19.13");
    expect(formatMoney("1450", null)).toBe("1,450.00");
  });

  it("falls back to the code for a currency that isn't ISO 4217", () => {
    expect(formatMoney("5", "XX")).toBe("XX 5.00");
    expect(formatMoney("1450", "XX")).toBe("XX 1,450.00");
    expect(formatMoney(18.5, "Euros")).toBe("Euros 18.50");
  });

  it.each([null, undefined, "", "abc"])("shows a dash for %s", (amount) => {
    expect(formatMoney(amount, "EUR")).toBe("—");
  });
});

describe("sortCurrencyTotals", () => {
  it("puts EUR first by default, then larger totals, then no currency", () => {
    expect(
      sortCurrencyTotals([
        { currency: null, total: "500.00" },
        { currency: "GBP", total: "13.51" },
        { currency: "USD", total: "40.00" },
        { currency: "EUR", total: "285.46" },
      ]).map((row) => row.currency),
    ).toEqual(["EUR", "USD", "GBP", null]);
  });

  it("puts the home currency first when one is given", () => {
    expect(
      sortCurrencyTotals(
        [
          { currency: "EUR", total: "285.46" },
          { currency: "GBP", total: "13.51" },
          { currency: "MXN", total: "40.00" },
        ],
        "MXN",
      ).map((row) => row.currency),
    ).toEqual(["MXN", "EUR", "GBP"]);
  });

  it("drops zero and unreadable totals", () => {
    expect(
      sortCurrencyTotals([
        { currency: "EUR", total: "0" },
        { currency: "GBP", total: "abc" },
        { currency: "USD", total: "3.00" },
      ]),
    ).toEqual([{ currency: "USD", total: "3.00" }]);
  });
});

describe("currency helpers", () => {
  it("knows supported codes and symbols", () => {
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("eur")).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("XX")).toBeNull();
  });

  it("offers the home currency first and keeps a stored code off the list", () => {
    const codes = (home?: string, current?: string | null) =>
      currencyOptions(home, current).map((o) => o.value);
    expect(codes().slice(0, 3)).toEqual(["EUR", "USD", "GBP"]);
    expect(codes("MXN").slice(0, 3)).toEqual(["MXN", "EUR", "USD"]);
    expect(codes("MXN").filter((c) => c === "MXN")).toHaveLength(1);
    expect(codes("EUR", "XYZ").at(-1)).toBe("XYZ");
    expect(codes("EUR", "GBP").filter((c) => c === "GBP")).toHaveLength(1);
  });
});

describe("order currency validation", () => {
  it("accepts supported codes and null", () => {
    expect(orderCurrencySchema.parse("EUR")).toBe("EUR");
    expect(orderCurrencySchema.parse(null)).toBeNull();
  });

  it("rejects free text", () => {
    expect(() => orderCurrencySchema.parse("Apples")).toThrow();
    expect(() => orderCurrencySchema.parse("")).toThrow();
  });

  it("applies to new orders", () => {
    const base = {
      workId: "00000000-0000-4000-8000-000000000000",
      acquisitionMethod: "online_order" as const,
      orderDate: "2026-09-26",
    };
    expect(
      createOrderSchema.safeParse({ ...base, currency: "GBP" }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({ ...base, currency: "Pears" }).success,
    ).toBe(false);
  });
});
