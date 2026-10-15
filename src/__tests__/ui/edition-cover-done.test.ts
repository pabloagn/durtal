import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Edition cover applies every change at once (an upload, a pasted URL, the
// book's cover), so like the other dialogs with nothing to save it shows Done:
// its main button, so Enter closes it (SLN-634). ⌘Enter in the pasted URL adds
// it, as a Done dialog's own field does (Collections, Manage media).
const source = readFileSync(
  path.resolve(__dirname, "../../app/(catalogue)/library/[slug]/edition-cover-dialog.tsx"),
  "utf8",
);

it("shows Done in Edition cover", () => {
  const dialog = source.slice(source.indexOf("<Dialog"), source.indexOf('title="Edition cover"') + 200);
  expect(dialog).toMatch(/\n\s+done\n/);
});

it("adds a pasted cover URL on ⌘Enter", () => {
  const add = source.slice(source.indexOf('<Button type="submit"'), source.indexOf("Add\n", source.indexOf('<Button type="submit"')));
  expect(add).toContain('data-shortcut="save"');
});
