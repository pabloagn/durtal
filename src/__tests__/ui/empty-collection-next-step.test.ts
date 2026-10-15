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
    expect(controls).toMatch(/const onAdd = \(\) => setAdd\(true\)/);
  });
});

describe("an empty publisher's Books section", () => {
  it("offers to add a book", () => {
    const page = source("app/(catalogue)/publishers/[slug]/page.tsx");
    expect(page).toMatch(/title="No books yet"[\s\S]*?action=\{\s*<Link href="\/library\/new"[\s\S]*?Add a book/);
  });
});
