/**
 * What each metered call costs (SLN-468), in US dollars per unit, read from
 * each provider's own price page. Empty until the research agent (SLN-469)
 * adds the providers chosen in SLN-461. A provider or operation without a
 * row is refused: the meter fails closed. A free-tier operation has a price
 * of 0 and is still metered, so its units are counted.
 */
export interface PriceRow {
  provider: string;
  operation: string;
  /** Unit name to USD per unit, such as { input_tokens: 0.000003 } */
  usdPerUnit: Record<string, number>;
  /** The provider's price page, and the day it was read */
  source: string;
  readOn: string;
}

export const PRICES: readonly PriceRow[] = [];

export function priceFor(provider: string, operation: string, prices: readonly PriceRow[] = PRICES): PriceRow {
  const row = prices.find((p) => p.provider === provider && p.operation === operation);
  if (!row) throw new Error(`No price for ${provider} ${operation}: add it to src/lib/enrichment/prices.ts first`);
  return row;
}

/** The cost of some units at a price; a unit the price does not name is refused */
export function costOf(units: Record<string, number>, price: PriceRow): number {
  let total = 0;
  for (const [unit, count] of Object.entries(units)) {
    const each = price.usdPerUnit[unit];
    if (each === undefined) throw new Error(`The price of ${price.provider} ${price.operation} has no unit ${unit}`);
    total += each * count;
  }
  return total;
}

/** The version a ledger row records: the price's page and the day it was read */
export const priceVersion = (price: PriceRow) => `${price.readOn} ${price.source}`.slice(0, 100);
