import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish 2: the Lookup and Lookup history panels ended in an empty
// bordered row. Their status rows take room only when they say something.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../../app/(catalogue)/settings/reader", file), "utf8");

it("keeps the lookup save status out of sight until it says something", () => {
  expect(read("lookup-settings.tsx")).toContain('className={saving || notice ? "mt-3 flex flex-wrap items-start gap-3" : "sr-only"}');
});

it("gives the lookup history's last row room only for loading, an error or Show more", () => {
  expect(read("lookup-history.tsx")).toContain('{(busy || error || entries.length < count) && <div className="px-5 py-4">');
});
