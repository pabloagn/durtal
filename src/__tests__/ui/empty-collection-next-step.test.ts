import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish pass 2: an empty collection said "Nothing yet" under its
// title and "Build your collection" below, with no button; an empty
// publisher's Books section said why but offered no next step

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("an empty collection", () => {
  const page = source("app/(catalogue)/collections/[id]/page.tsx");

  it("says it is empty once, with no count line under the title", () => {
    expect(page).not.toContain('"Nothing yet"');
    expect(page).not.toContain("Build your collection");
    expect(page).toContain("{counts && <p");
  });

  it("offers its Add button in the empty state", () => {
    expect(page).toMatch(/<EmptyState[\s\S]*?title="Nothing in this collection yet"[\s\S]*?action=\{<AddToCollectionButton \/>\}/);
  });

  it("opens the header's add dialog from that button", () => {
    const controls = source("components/collections/collection-controls.tsx");
    expect(controls).toMatch(/export function AddToCollectionButton[\s\S]*?dispatchEvent\(new CustomEvent\(ADD_EVENT\)\)/);
    expect(controls).toMatch(/addEventListener\(ADD_EVENT, onAdd\)/);
    // Empty, the empty state's Add is the page's only one (SLN-918): the
    // header's shows once something is in it, and takes the focus when the
    // empty state's leaves with the dialog's add
    expect(controls).toMatch(/\{!empty && \(\s*<Button ref=\{addButton\}/);
    expect(controls).toMatch(/if \(wasEmpty\.current && !empty\) focusAddIfLost\(\);/);
  });
});

describe("an empty publisher's Books section", () => {
  it("offers to add a book, unless its Review line is the next step", () => {
    const page = source("app/(catalogue)/publishers/[slug]/page.tsx");
    expect(page).toMatch(/title="No books yet"[\s\S]*?action=\{suggested\.editions > 0 \? undefined : <DomainAddLink kind="book" size="md" \/>\}/);
  });
});

// SLN-918: an empty series showed a dashed box saying only "No books yet."
describe("an empty series", () => {
  it("shows one empty state with a sentence and the page's only Add", () => {
    const page = source("app/(catalogue)/series/[id]/page.tsx");
    expect(page).not.toContain("No books yet.");
    expect(page).toMatch(/<EmptyState[\s\S]*?title="No books in this series yet"[\s\S]*?description="[^"]+"[\s\S]*?action=\{<AddSeriesBooksButton \/>\}/);
    const actions = source("components/series/series-actions.tsx");
    expect(actions).toMatch(/\{!empty && \(\s*<Button\s+ref=\{addButton\}/);
    expect(actions).toMatch(/export function AddSeriesBooksButton[\s\S]*?data-focus-empty="series"/);
  });
});
