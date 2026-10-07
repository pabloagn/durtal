/**
 * The User-Agent of every book enrichment request (SLN-460): the product
 * token, what Durtal is, and a contact. The contact comes from
 * ENRICHMENT_CONTACT; it is never invented, so without it nothing starts.
 */

/** The product token robots.txt groups name */
export const ROBOTS_PRODUCT_TOKEN = "DurtalBot";

export function enrichmentUserAgent(): string {
  const contact = process.env.ENRICHMENT_CONTACT?.trim();
  if (!contact)
    throw new Error("ENRICHMENT_CONTACT is not set: enrichment requests name a contact. Set it in .env.local (docs/13_CONFIGURATION.md).");
  return `${ROBOTS_PRODUCT_TOKEN}/1.0 (personal book catalogue; ${contact})`;
}
