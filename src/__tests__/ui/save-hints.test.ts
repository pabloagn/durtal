import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * A disabled Save says what it waits for, beside it (SLN-945): forms whose
 * Save turns off for an empty required field carry a line in their footer.
 */

const read = (path: string) => readFileSync(`src/${path}`, "utf8");

describe("a disabled Save says what it waits for (SLN-945)", () => {
  it.each([
    ["components/books/work-form.tsx", "Give the book a title"],
    ["components/books/edition-form.tsx", "Give the edition a title"],
    ["app/(catalogue)/places/venue-create-dialog.tsx", "Give the place a name"],
    ["components/recommenders/recommender-form-dialog.tsx", "Give the recommender a name"],
    ["components/taxonomy/create-family-dialog.tsx", "Give the family a name"],
    ["components/taxonomy/edit-family-dialog.tsx", "Give the family a name"],
    ["components/taxonomy/create-item-dialog.tsx", "Give the item a name"],
    ["components/collections/collection-controls.tsx", "Give the collection a name"],
    ["components/catalogue/sources-section.tsx", "Name the source to save"],
    ["components/series/add-series-books-dialog.tsx", "Tick the books to add"],
    ["components/reading/dialogs/note-dialog.tsx", "Write the passage to save"],
    ["components/organizations/organization-dialog.tsx", "Give the organization a name"],
    ["components/reading/suggestions/not-for-me-dialog.tsx", "Choose at least one reason"],
    ["components/perfumes/retailers-section.tsx", "Choose a retailer"],
    ["app/(catalogue)/provenance/order-create-steps.tsx", "Add a title and author"],
    ["app/(catalogue)/provenance/order-create-dialog.tsx", "Choose a book"],
    ["app/(catalogue)/provenance/order-create-dialog.tsx", "Add the order date"],
    ["components/ebooks/new-book-dialog.tsx", "Choose a language"],
    ["components/ebooks/choose-book-dialog.tsx", "Choose a language for the new edition"],
  ])("%s", (file, line) => {
    expect(read(file)).toContain(line);
  });

  it("names an organization without the browser's own bubble", () => {
    const dialog = read("components/organizations/organization-dialog.tsx");
    expect(dialog).not.toMatch(/maxLength=\{200\}\s+required\b/);
    expect(dialog).toContain("disabled={!typedName.trim()}");
  });
});
