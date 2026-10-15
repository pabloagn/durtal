import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";

// Design polish pass 2: an edition in a collection read "fr" or "de", and a
// binding such as "saddle_stitch", where the book page names them

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("an edition's facts in a collection", () => {
  it("name the language and the binding on the collection's page", () => {
    const page = source("app/(catalogue)/collections/[id]/page.tsx");
    expect(page).toContain("languageName(e.language), bindingLabel(e.binding)");
    expect(page).not.toMatch(/e\.publicationYear, e\.language/);
  });

  it("name the language when adding editions", () => {
    const dialog = source("components/collections/add-books-dialog.tsx");
    expect(dialog).toContain("languageName(e.language)");
    expect(dialog).not.toMatch(/e\.publicationYear, e\.language/);
  });

  it("read as words", () => {
    expect(languageName("fr")).toBe("French");
    expect(languageName("de")).toBe("German");
    expect(bindingLabel("saddle_stitch")).toBe("Saddle stitch");
  });
});
