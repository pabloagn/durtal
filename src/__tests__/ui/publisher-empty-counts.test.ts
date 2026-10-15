import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish, 15 Oct: a publisher with no books listed Books 0, Editions
// 0, Owned 0, Read 0, Wanted 0 and On order 0 beside its empty Books section.
const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/publishers/[slug]/page.tsx"), "utf8");

it("leaves the catalogue counts out when every one is zero", () => {
  expect(page).toMatch(/const inCatalogue = \[counts\.books, counts\.editions, counts\.owned, counts\.read, counts\.wanted, counts\.onOrder\]\.some\(\(n\) => n > 0\)/);
  expect(page).toMatch(/\{inCatalogue && \(\s*<RecordGroup title="In the catalogue">/);
});
