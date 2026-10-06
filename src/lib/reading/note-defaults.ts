import { pickDefaultEdition, type EditionChoice } from "./defaults";

/*
 * What the note dialog fills in when it adds a quote (SLN-480): the edition
 * the quote is filed under, and whether its place is a page or a percent.
 * Pure, so the dialog and its tests share it.
 */

/** Where the Edition field's value came from: only "reading" and "default" follow a change of Reading */
export type EditionSource = "caller" | "reading" | "default" | "manual" | "stored";

/**
 * The first rule that applies: the edition the caller passes (the edition
 * card, Log progress's other edition), the chosen reading's edition, then
 * the edition Start reading would pick at the "I'm at" home. None only when
 * the book has no edition.
 */
export function noteEditionDefault(
  editions: EditionChoice[],
  { callerEditionId, readingEditionId, homeId, lastReadingEditionId }: {
    callerEditionId: string | null;
    readingEditionId: string | null;
    homeId: string | null;
    lastReadingEditionId: string | null;
  },
): { editionId: string | null; source: EditionSource } {
  const known = (id: string | null) => !!id && editions.some((e) => e.id === id);
  if (known(callerEditionId)) return { editionId: callerEditionId, source: "caller" };
  if (known(readingEditionId)) return { editionId: readingEditionId, source: "reading" };
  return { editionId: pickDefaultEdition(editions, { homeId, lastReadingEditionId }).editionId, source: "default" };
}

/**
 * Page or Percent when adding: a request that carries a percent (even null)
 * opens in Percent, one that carries a page in Page; else, when the edition
 * is the chosen reading's, the reading's unit decides; else Page.
 */
export function noteDefaultMode({
  request,
  readingUnit,
  onReadingEdition,
}: {
  request: { page?: number | null; percent?: number | null };
  readingUnit: string | null;
  onReadingEdition: boolean;
}): "page" | "percent" {
  if (request.percent !== undefined) return "percent";
  if (request.page !== undefined) return "page";
  if (onReadingEdition && readingUnit && readingUnit !== "pages") return "percent";
  return "page";
}
