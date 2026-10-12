import { z } from "zod/v4";
import type { ReviewPreparationIssue } from "@/lib/ebooks/review/errors";

// Presentation vocabulary only. Never copy labels, causes or extra properties
// from an error instance across Next's production serialization boundary.
const labels: Record<string, readonly [ReviewPreparationIssue["field"], string]> = {
  author: ["authors", "Choose at least one author."], language: ["language", "Choose a known language."],
  verified_file: ["file", "Choose an available verified eBook file."], ebook_location: ["locationId", "Choose an active digital location."],
  title: ["title", "Supply a book title."], author_identity: ["authors", "Choose the intended catalogue author."],
  author_compatible: ["authors", "Choose the catalogue author or explicitly create a new author."],
  author_missing: ["authors", "Choose an author that still exists."], batch_author: ["authors", "Choose consistent author identities for this selection."],
  isbn_choice: ["isbn13", "Choose a declared ISBN or explicitly choose none."], isbn_undeclared: ["isbn13", "Choose a declared ISBN or explicitly choose none."],
  multiple_isbns: ["isbn13", "Choose the edition’s ISBN or explicitly choose none."], isbn_held: ["isbn13", "This ISBN is held or shared. Choose an eligible edition or no ISBN."],
  digital_location: ["locationId", "Choose an active digital location."], locked_edition: ["edition", "Review the identified edition before changing the edition choice."],
  copy_choice: ["copy", "Choose an eligible digital copy of this book."], copy_taken: ["copy", "This copy is already linked. Choose an eligible copy."],
  multiple_copies: ["copy", "Choose the intended digital copy."], edition_language: ["edition", "Choose an edition in the intended language."],
  edition_identifier: ["edition", "Choose the edition that agrees with the identifiers."], multiple_editions: ["edition", "Choose the intended edition."],
  multiple_placeholders: ["edition", "Choose the intended placeholder edition."], number_signature: ["metadata", "Review the volume numbers that disagree with this book."],
  multiple_volume_signatures: ["metadata", "Choose the volume identity before linking."], already_linked: ["copy", "This eBook already belongs to a book. Refresh its review."],
  book_required: ["workId", "Choose an existing book and refresh its proposal."], identifier_conflict: ["metadata", "Review the identifiers that contradict this book."],
};
export function publicPreparationIssues(issues: readonly ReviewPreparationIssue[]): ReviewPreparationIssue[] {
  return issues.slice(0, 250).flatMap((issue) => {
    const id = z.uuid().safeParse(issue.ebookId);
    if (!id.success) return [];
    const known = Object.hasOwn(labels, issue.code);
    const [field, message] = known ? labels[issue.code] : ["choices" as const, "Review the edition and copy choices."];
    return [{ ebookId: id.data.toLowerCase(), field, code: known ? issue.code : "choice_required", message }];
  });
}
