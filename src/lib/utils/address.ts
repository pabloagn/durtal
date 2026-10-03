/**
 * The city in a one-line postal address, as Google formats it
 * ("Spui 14-16, 1012 XA Amsterdam, Netherlands" → "Amsterdam"). The city is
 * the part before the country, without its postal code. Null when that part
 * is not a plain name (a US "NY 11201", a missing address). Pure module.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  const parts = address?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  if (parts.length < 2) return null;
  const city = parts[parts.length - 2]
    // Postal codes before the name: "1012 XA" (NL), "75004" (FR), "10115" (DE)
    .replace(/^\d{4}\s?[A-Z]{2}\s+/, "")
    .replace(/^(?:[A-Z]{1,2}-)?\d{4,5}\s+/, "")
    // Postal codes after the name: "London EC1A 1BB", "Lisboa 1200-195"
    .replace(/\s+[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}$/, "")
    .replace(/\s+\d{4}-\d{3}$/, "")
    .trim();
  return city && !/\d/.test(city) ? city : null;
}

/**
 * The street of a one-line postal address, without its number
 * ("Spui 14-16, 1012 XA Amsterdam, Netherlands" → "Spui"; "100 Main St, …"
 * → "Main St"). Null when the address has no street part.
 */
export function streetFromAddress(address: string | null | undefined): string | null {
  const parts = address?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  if (parts.length < 3) return null;
  const street = parts[0]
    .replace(/\s+\d[\w/-]*$/, "")
    .replace(/^\d[\w/-]*\s+/, "")
    .trim();
  return street && !/^\d/.test(street) ? street : null;
}
