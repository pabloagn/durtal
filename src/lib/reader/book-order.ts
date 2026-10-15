import type { DurtalLocator } from "./engine";

/**
 * A CFI's place as numbers (EPUB CFI 3.1): each step's index, then the
 * character offset, from a range's start. Assertions and the spatial and
 * temporal parts do not change the order. Null when it does not read as a CFI.
 */
export function cfiPlace(cfi: string): number[] | null {
  const inner = /^epubcfi\(([^]*)\)$/.exec(cfi.trim())?.[1];
  if (!inner) return null;
  const [parent, start = ""] = inner.replace(/\[(?:\^.|[^\]^])*\]/g, "").split(",");
  const path = (parent + start).replace(/[~@].*$/, "");
  if (!/^(?:[/!:~@]|\d|\.)+$/.test(path)) return null;
  const place: number[] = [];
  for (const [, mark, value] of path.matchAll(/([/:])(\d+)/g)) {
    place.push(Number(value));
    if (mark === ":") break;
  }
  return place.length ? place : null;
}

function comparePlaces(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * Reading order for marks (SLN-682): by section, then by the CFI where both
 * have one, then by progression. A mark's progression is only as fine as
 * the page it was made on, so two marks a page apart can come out reversed;
 * their CFIs cannot.
 */
export function compareBookPlaces(a: DurtalLocator, b: DurtalLocator): number {
  if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex;
  const at = a.cfi ? cfiPlace(a.cfi) : null, bt = b.cfi ? cfiPlace(b.cfi) : null;
  const order = at && bt ? comparePlaces(at, bt) : 0;
  return order || a.progression - b.progression;
}
