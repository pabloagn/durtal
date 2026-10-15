import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { ebooksAvailableText } from "@/lib/utils/format";

// Design polish 2: a person and a series with one e-book said "1 available as eBooks"
it("counts one eBook in the singular", () => {
  expect(ebooksAvailableText(1)).toBe("1 available as an eBook");
  expect(ebooksAvailableText(2)).toBe("2 available as eBooks");
  expect(ebooksAvailableText(1200)).toBe("1,200 available as eBooks");
});

it("is the line on a person's books and a series", () => {
  for (const file of ["people/[slug]/page.tsx", "series/[id]/page.tsx"]) {
    const source = readFileSync(path.resolve(__dirname, "../../app/(catalogue)", file), "utf8");
    expect(source, file).toContain("ebooksAvailableText(digitalCount)");
    expect(source, file).not.toContain("available as eBooks");
  }
});
