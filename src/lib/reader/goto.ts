import type { GoToTarget } from "./engine";
import type { PositionIndex } from "./position-index";
export type GoToMode = "page" | "location" | "percent" | "chapter";
export const chapterQuery = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
export type GoToResult =
  | { target: GoToTarget; error?: never }
  | { error: string; target?: never };
export function parseGoTo(
  mode: GoToMode,
  input: string,
  index: PositionIndex,
): GoToResult {
  const text = input.trim();
  if (mode === "page") {
    const label = text.replace(/^(?:page\s+|p\.?\s*)/i, "").trim();
    const exact = index.pages.find(
      (page) => page.label.toLowerCase() === label.toLowerCase(),
    );
    if (exact) return { target: { href: exact.href } };
    if (/^\d+$/.test(label)) {
      const preceding = index.pages
        .filter(
          (page) =>
            /^\d+$/.test(page.label) && Number(page.label) <= Number(label),
        )
        .sort((a, b) => Number(b.label) - Number(a.label))[0];
      if (preceding) return { target: { href: preceding.href } };
    }
    return { error: "This edition has no page " + (label || text) };
  }
  if (mode === "location") {
    const location = Number(text);
    if (
      /^\d+$/.test(text) &&
      location >= 1 &&
      location <= index.info.locationCount
    )
      return { target: { location } };
    return {
      error:
        "Locations run from 1 to " + index.info.locationCount.toLocaleString(),
    };
  }
  if (mode === "percent") {
    const value = text.replace(/%$/, "").trim();
    const percent = Number(value);
    if (
      /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) &&
      percent >= 0 &&
      percent <= 100
    )
      return { target: { fraction: percent / 100 } };
    return { error: "Percent runs from 0 to 100" };
  }
  const matches = index.chapters.filter((item) =>
    chapterQuery(item.label).includes(chapterQuery(text)),
  );
  return matches.length
    ? { target: { href: matches[0].href } }
    : { error: "No chapter matches " + text };
}
