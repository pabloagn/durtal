import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// On a phone the collection name's title row is a block that starts 8px left
// of the page's text edge (-ml-2, for the icon button's padding), and the
// icon floats. The name's second and later lines run under the icon, so
// without padding they started at 8px while the cover and description start
// at 16px. Browser layout is measured by hand; this pins the class.
it("starts a wrapped collection name's later lines on the page's text edge", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/collections/[id]/page.tsx"), "utf8");
  const row = source.match(/className="(-ml-2 [^"]*max-md:block[^"]*)"/);
  expect(row?.[1].split(" ")).toContain("-ml-2");
  const h1 = source.match(/<h1 [^>]*className="([^"]*)">\s*\{collection\.name\}/);
  expect(h1?.[1].split(" ")).toContain("max-md:pl-2");
});
