/**
 * The canonical form of an evidence URL (SLN-468): no fragment, no tracking
 * parameters, a lowercase host and no default port. The store keys reuse on
 * it, and the research agent (SLN-469) merges equal URLs with it.
 */

const TRACKING = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^dclid$/i, /^msclkid$/i, /^mc_(cid|eid)$/i, /^igshid$/i, /^_ga$/i];

export function canonicalEvidenceUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  for (const name of [...u.searchParams.keys()]) if (TRACKING.some((re) => re.test(name))) u.searchParams.delete(name);
  // URL drops a default port by itself; an empty query leaves no "?"
  if (![...u.searchParams.keys()].length) u.search = "";
  return u.toString();
}
