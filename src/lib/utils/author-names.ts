import { displayName } from "@/lib/harmonization/normalize";

/** Default sort name for an author: "Last, First Middle" (single names stay as they are). */
export function defaultSortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(" ")}`;
}

/** Name particles that stay small inside a name: "Simone de Beauvoir" */
const PARTICLES = new Set([
  "de", "del", "della", "der", "di", "da", "du", "des", "van", "von", "la",
  "le", "y", "e", "bin", "ibn", "al",
]);

/**
 * A name in catalogue order ("Huxley, Aldous") in natural order, with its
 * parts, when the harmonizer would reorder it. Null when there is no comma,
 * or when the comma is not a name order ("Smith, Jr.", "Sade, Marquis de").
 * A name typed all in capitals or all in small letters also gets capitals.
 */
export function naturalNameParts(
  name: string,
): { name: string; first: string; last: string; sortName: string } | null {
  const clean = name.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
  if (!clean.includes(",") || displayName(clean) === clean) return null;
  const letters = clean.replace(/\P{L}/gu, "");
  const uniform =
    letters === letters.toUpperCase() || letters === letters.toLowerCase();
  const [last, first] = clean
    .split(",")
    .map((part, i) => (uniform ? capitalizeName(part.trim(), i === 0) : part.trim()));
  return { name: `${first} ${last}`, first, last, sortName: `${last}, ${first}` };
}

/** "Huxley, Aldous" becomes "Aldous Huxley"; other names stay as they are */
export function naturalAuthorName(name: string): string {
  return naturalNameParts(name)?.name ?? name;
}

/** "JEAN-PAUL" → "Jean-Paul", "o'brien" → "O'Brien", "de beauvoir" → "de Beauvoir" */
function capitalizeName(part: string, isLastName: boolean): string {
  return part
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      (i > 0 || isLastName) && PARTICLES.has(word)
        ? word
        : word.replace(/(^|[-'’.])(\p{L})/gu, (_, mark, c) => mark + c.toUpperCase()),
    )
    .join(" ");
}
