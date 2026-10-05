import { isAtHand, type CopyPlace } from "./at-hand";

/*
 * The edition and copy a new reading starts with (SLN-447). Pure, so the
 * Start dialog and its tests share it.
 */

export interface EditionChoice {
  id: string;
  pageCount: number | null;
  copies: (CopyPlace & { id: string })[];
}

const held = (copy: { status: string }) => copy.status !== "deaccessioned";
/** Copies that are not deaccessioned, available ones first */
const ranked = <T extends { status: string }>(copies: T[]) =>
  copies.filter(held).sort((a, b) => Number(b.status === "available") - Number(a.status === "available"));

/**
 * In order: an edition with a copy at hand at the home (a physical copy there
 * first, else a digital one); the edition of the last reading; an edition with
 * a copy; an edition with a page count; the first edition. The copy is the one
 * that made the edition win, else the edition's first copy.
 */
export function pickDefaultEdition(
  editions: EditionChoice[],
  { homeId, lastReadingEditionId }: { homeId: string | null; lastReadingEditionId: string | null },
): { editionId: string | null; instanceId: string | null } {
  if (!editions.length) return { editionId: null, instanceId: null };
  const firstCopy = (e: EditionChoice) => ranked(e.copies)[0]?.id ?? null;
  const pick = (e: EditionChoice, instanceId = firstCopy(e)) => ({ editionId: e.id, instanceId });
  for (const physical of [true, false])
    for (const e of editions) {
      const copy = e.copies.find((c) => isAtHand(c, homeId) && (c.locationType === "digital") !== physical);
      if (copy) return pick(e, copy.id);
    }
  const last = editions.find((e) => e.id === lastReadingEditionId);
  if (last) return pick(last);
  const owned = editions.find((e) => e.copies.some(held));
  if (owned) return pick(owned);
  const counted = editions.find((e) => e.pageCount);
  return pick(counted ?? editions[0]);
}
