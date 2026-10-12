import type { Db } from "@/lib/catalogue/work-store";
import type { PrepareEbookReview } from "@/lib/validations/ebook-review";
import { accessionBatchEffects } from "../match/effects";
import { editionEffect } from "../match/editions";
import { loadMatchCatalogue } from "../match/load";
import { scorePair } from "../match/score";
import { ReviewPreparationError, type ReviewPreparationField, type ReviewPreparationIssue } from "./errors";
type Label = readonly [ReviewPreparationField, string];
const MISSING: Record<string, Label> = {
  author: ["authors", "Choose at least one author."], language: ["language", "Choose a known language."],
  verified_file: ["file", "Choose an available verified eBook file."],
  ebook_location: ["locationId", "Choose an active digital location."], title: ["title", "Supply a book title."],
};
const AMBIGUITIES: Record<string, Label> = {
  author_identity: ["authors", "Choose the intended catalogue author."],
  author_compatible: ["authors", "Choose the catalogue author or explicitly create a new author."],
  author_missing: ["authors", "Choose an author that still exists."],
  batch_author: ["authors", "Choose consistent author identities for this selection."],
  isbn_choice: ["isbn13", "Choose a declared ISBN or explicitly choose none."],
  isbn_undeclared: ["isbn13", "Choose a declared ISBN or explicitly choose none."],
  multiple_isbns: ["isbn13", "Choose the edition’s ISBN or explicitly choose none."],
  isbn_held: ["isbn13", "This ISBN is held or shared. Choose an eligible edition or no ISBN."],
  digital_location: ["locationId", "Choose an active digital location."],
  locked_edition: ["edition", "Review the identified edition before changing the edition choice."],
  copy_choice: ["copy", "Choose an eligible digital copy of this book."],
  copy_taken: ["copy", "This copy is already linked. Choose an eligible copy."],
  multiple_copies: ["copy", "Choose the intended digital copy."],
  edition_language: ["edition", "Choose an edition in the intended language."],
  edition_identifier: ["edition", "Choose the edition that agrees with the identifiers."],
  multiple_editions: ["edition", "Choose the intended edition."],
  multiple_placeholders: ["edition", "Choose the intended placeholder edition."],
  number_signature: ["metadata", "Review the volume numbers that disagree with this book."],
  multiple_volume_signatures: ["metadata", "Choose the volume identity before linking."],
  already_linked: ["copy", "This eBook already belongs to a book. Refresh its review."],
};
/** Map actual core effect codes, never parse free-form text. Unknown future
 * codes get a generic choice issue rather than disclosing internal messages. */
export function reviewEffectIssues(ebookId: string, effect: {
  ready: boolean; missing: readonly string[]; ambiguities: readonly { code: string }[];
}): ReviewPreparationIssue[] {
  if (effect.ready) return [];
  const entry = (code: string, labels: Record<string, Label>) => Object.hasOwn(labels, code)
    ? { label: labels[code], code } : { label: undefined, code: "choice_required" };
  return [...effect.missing.map((code) => entry(code, MISSING)),
    ...effect.ambiguities.map(({ code }) => entry(code, AMBIGUITIES))]
    .map(({ label, code }) => { const [field, message]: Label = label ?? ["choices", "Review the edition and copy choices."];
      return { ebookId, field, code, message }; });
}
/** Called only after the actual planner refuses, on that SAME repeatable-read
 * connection. No second matcher/planner or writer; project the actual core
 * effects to make missing choices actionable. Successful preparation pays no
 * extra full-catalogue read. Failure to inspect remains a sanitized unavailable
 * preparation, never a claim that any mutation occurred. */
export async function readPreparationRefusalOn(conn: Db, intents: readonly PrepareEbookReview[]): Promise<ReviewPreparationError | null> {
  const selected = intents.filter((intent) => ["accession", "link", "accept"].includes(intent.action));
  if (!selected.length) return null;
  const loaded = await loadMatchCatalogue(conn), issues: ReviewPreparationIssue[] = [];
  const accessions = selected.filter((intent) => intent.action === "accession");
  if (accessions.length) {
    const ids = accessions.map((intent) => intent.ebookId);
    const effects = accessionBatchEffects(loaded.catalogue.source.ebooks.filter((ebook) => ids.includes(ebook.id)),
      loaded.catalogue, new Map(accessions.map((intent) => [intent.ebookId, {
        ...(intent.authors !== undefined ? { authors: intent.authors } : {}),
        ...(intent.language !== undefined ? { language: intent.language } : {}),
        ...(intent.isbn13 !== undefined ? { isbn13: intent.isbn13 } : {}),
      }])));
    for (const effect of effects) issues.push(...reviewEffectIssues(effect.ebookId, effect));
  }
  for (const intent of selected) {
    if (intent.action !== "link" && intent.action !== "accept") continue;
    const ebook = loaded.catalogue.source.ebooks.find((row) => row.id === intent.ebookId);
    const workId = intent.action === "link" ? intent.workId : loaded.rows.ebook_match_candidates.find((row) =>
      row.ebook_id === intent.ebookId && row.rank === intent.rank)?.work_id;
    const work = typeof workId === "string" ? loaded.catalogue.byWorkId.get(workId) : null;
    if (!ebook || !work) { issues.push({ ebookId: intent.ebookId, field: "workId", code: "book_required", message: "Choose an existing book and refresh its proposal." }); continue; }
    const choice = intent.action === "link" ? intent.choice : null;
    const options = choice?.kind === "new_edition" ? { newEdition: {
      ...(choice.language !== undefined ? { language: choice.language } : {}),
      ...(choice.isbn13 !== undefined ? { isbn13: choice.isbn13 } : {}),
    } } : choice ? { editionId: choice.editionId, ...(choice.kind === "fill_copy" ? { instanceId: choice.instanceId } : {}) } : {};
    const effect = editionEffect(ebook, work, loaded.catalogue, { ...options,
      ...(intent.action === "link" && intent.locationId !== undefined ? { locationId: intent.locationId } : {}) });
    issues.push(...reviewEffectIssues(intent.ebookId, effect));
    if (scorePair(ebook, work, loaded.catalogue).identifierConflict)
      issues.push({ ebookId: intent.ebookId, field: "metadata", code: "identifier_conflict", message: "Review the identifiers that contradict this book." });
  }
  return issues.length ? new ReviewPreparationError(issues) : null;
}
