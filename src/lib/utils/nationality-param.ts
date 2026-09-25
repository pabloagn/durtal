/**
 * Helpers for the `/authors?nationality=` URL param.
 *
 * The param holds ISO 3166-1 alpha-2 codes joined by commas ("HU,FR").
 * Country display names cannot be used: most of them contain a comma
 * ("Hungary, Republic of"), which collides with the list delimiter.
 */

const CODE_RE = /^[A-Za-z]{2}$/;

export interface NationalityOption {
  /** ISO 3166-1 alpha-2 code, uppercase */
  code: string;
  /** Country display name */
  name: string;
}

function splitTokens(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Parse a comma-joined list of country codes.
 * Returns `null` when any token is not a 2-letter code, which means the
 * param uses the old name-based format (see `resolveLegacyNationalityNames`).
 */
export function parseNationalityCodes(raw: string | null | undefined): string[] | null {
  if (!raw) return [];
  const tokens = splitTokens(raw);
  if (!tokens.every((t) => CODE_RE.test(t))) return null;
  return [...new Set(tokens.map((t) => t.toUpperCase()))];
}

export function formatNationalityParam(codes: string[]): string {
  return codes.join(",");
}

/** Build the authors list URL filtered to one or more nationalities. */
export function nationalityFilterHref(codes: string | string[]): string {
  const list = Array.isArray(codes) ? codes : [codes];
  return `/authors?nationality=${encodeURIComponent(formatNationalityParam(list))}`;
}

/**
 * Resolve an old name-based param (e.g. "Hungary, Republic of,Japan") to codes.
 * Names can contain ", ", so consecutive tokens are re-joined: at each position
 * the longest run of tokens that forms a known country name wins. Tokens that
 * are already valid codes are kept. Unknown tokens are dropped.
 */
export function resolveLegacyNationalityNames(
  raw: string,
  countries: NationalityOption[],
): string[] {
  const byName = new Map(countries.map((c) => [c.name.toLowerCase(), c.code.toUpperCase()]));
  const knownCodes = new Set(countries.map((c) => c.code.toUpperCase()));
  const tokens = splitTokens(raw);
  const codes: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    let consumed = 0;
    for (let j = tokens.length; j > i; j--) {
      const code = byName.get(tokens.slice(i, j).join(", ").toLowerCase());
      if (code) {
        codes.push(code);
        consumed = j - i;
        break;
      }
    }
    if (consumed === 0) {
      const upper = tokens[i].toUpperCase();
      if (CODE_RE.test(upper) && knownCodes.has(upper)) codes.push(upper);
      consumed = 1;
    }
    i += consumed;
  }

  return [...new Set(codes)];
}
