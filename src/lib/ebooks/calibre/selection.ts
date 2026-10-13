import { existsSync, readFileSync } from "node:fs";
import type { Db } from "@/lib/catalogue/work-store";
import { dataFingerprint, loadMatchCatalogue } from "../match/load";
import { MATCH_MODEL } from "../match/model";
import type { CalibreSnapshot } from "./library";

/*
 * The selection Import existing makes (SLN-657): the Calibre books that are
 * already among Durtal's books, by id and uuid, bound to the snapshot, the
 * catalogue and the matching model it was scored with. The ingest plans only
 * these books, and refuses a selection made against another snapshot, an
 * older catalogue or another model: run the dry run again.
 */

export const SELECTION_VERSION = 1;

export interface CalibreSelection {
  v: typeof SELECTION_VERSION;
  kind: "calibre_import_existing";
  createdAt: string;
  libraryId: string;
  snapshotSha256: string;
  metadataDbSha256: string;
  catalogueFingerprint: string;
  modelVersion: number;
  modelFingerprint: string;
  /** review: the dry run sent the book to review; its matching after the ingest keeps it there */
  books: { bookId: number; uuid: string; review: boolean }[];
}

export function readSelection(file: string): CalibreSelection {
  if (!existsSync(file)) throw new Error(`${file} does not exist: make a selection with pnpm ebooks:import-existing.`);
  const selection = JSON.parse(readFileSync(file, "utf8")) as CalibreSelection;
  if (selection.v !== SELECTION_VERSION || selection.kind !== "calibre_import_existing" || !Array.isArray(selection.books))
    throw new Error(`${file} is not an Import existing selection of this version: run pnpm ebooks:import-existing again.`);
  return selection;
}

/** Throws unless the selection was made from this snapshot, against the catalogue as it is now, with this model */
export async function requireCurrentSelection(
  selection: CalibreSelection,
  snapshot: { snapshot: CalibreSnapshot; sha256: string },
  database: Db,
  nothing = "Nothing planned.",
): Promise<void> {
  if (selection.libraryId !== snapshot.snapshot.library.id || selection.snapshotSha256 !== snapshot.sha256)
    throw new Error(`This selection was made from another snapshot: run pnpm ebooks:import-existing on this one. ${nothing}`);
  if (selection.modelVersion !== MATCH_MODEL.version || selection.modelFingerprint !== dataFingerprint(MATCH_MODEL))
    throw new Error(`This selection was scored with another matching model: run pnpm ebooks:import-existing again. ${nothing}`);
  const { catalogueFingerprint } = await loadMatchCatalogue(database);
  if (selection.catalogueFingerprint !== catalogueFingerprint)
    throw new Error(`Durtal's books have changed since this selection: run pnpm ebooks:import-existing again. ${nothing}`);
  const uuids = new Map(snapshot.snapshot.books.map((book) => [book.id, book.uuid]));
  if (selection.books.some((book) => uuids.get(book.bookId) !== book.uuid))
    throw new Error(`A selected book is not in the snapshot: run pnpm ebooks:import-existing again. ${nothing}`);
}
