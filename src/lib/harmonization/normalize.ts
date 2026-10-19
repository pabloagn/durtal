export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function displayName(value: string): string {
  const parts = value.split(",").map((s) => s.trim());
  // Multiple commas and suffixes are ambiguous; never rearrange these automatically.
  return parts.length === 2 &&
    parts.every(Boolean) &&
    !/^(jr\.?|sr\.?|ii|iii|iv|phd|md)$/i.test(parts[1]) &&
    !/^(baron|baroness|count|countess|comte|duke|duchess|earl|lord|lady|marquis|marquess)\b/i.test(
      parts[1],
    )
    ? `${parts[1]} ${parts[0]}`
    : value;
}
export function identityName(value: unknown, person = false) {
  const name = person ? displayName(String(value ?? "")) : String(value ?? "");
  // Initials with or without spaces should compare equally: M.R. / M. R.
  return normalize(name.replace(/\.(?=\p{L})/gu, ". "));
}
/** Bounded edit distance; short names deliberately require exact matching. */
export function closeSpelling(a: string, b: string): boolean {
  if (a.length < 7 || b.length < 7 || Math.abs(a.length - b.length) > 1)
    return false;
  if (a.split(" ").length !== b.split(" ").length) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    if (Math.min(...next) > 1) return false;
    previous = next;
  }
  return previous[b.length] === 1;
}
// localeCompare's order, worked out once per shape of object: a scan
// fingerprints every finding, and the keys must keep this order so stored
// fingerprints still match (SLN-887)
const keyOrder = new Intl.Collator().compare;
const sortedKeys = new Map<string, string[]>();
function keysInOrder(value: object) {
  const keys = Object.keys(value);
  const shape = keys.join("\u0000");
  let sorted = sortedKeys.get(shape);
  if (!sorted) {
    sorted = keys.sort(keyOrder);
    if (sortedKeys.size < 1000) sortedKeys.set(shape, sorted);
  }
  return sorted;
}
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${keysInOrder(value)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function isBlank(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  );
}
export function validIsbn(value: unknown, length: 10 | 13) {
  const digits = String(value).replace(/[\s-]/g, "").toUpperCase();
  if (length === 13)
    return (
      /^97[89]\d{10}$/.test(digits) &&
      [...digits].reduce((s, n, i) => s + Number(n) * (i % 2 ? 3 : 1), 0) %
        10 ===
        0
    );
  return (
    /^\d{9}[\dX]$/.test(digits) &&
    [...digits].reduce(
      (s, n, i) => s + (n === "X" ? 10 : Number(n)) * (10 - i),
      0,
    ) %
      11 ===
      0
  );
}

/** Numbered volumes, years and source batches carry identity, not typographic noise. */
export function numberSignature(value: string): string {
  const numbers: string[] = value.match(/\d+/g) || [];
  const roman = value.match(/(?:^|\s)([ivxlcdm]+)$/i)?.[1];
  if (
    roman &&
    /^(?=[mdclxvi]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.test(
      roman,
    )
  )
    numbers.push(roman.toLowerCase());
  return numbers.join(":");
}
