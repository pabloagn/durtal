import { expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Design polish 2: a person's Credits read "Books / Author 2", which reads as
// a person named Author 2. Each role is now a line: "Author · 2 books".
const page = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/people/[slug]/page.tsx"), "utf8");

it("names the count's noun, one role a line", () => {
  expect(page).not.toContain("`${role} ${ids.size}`");
  expect(page).toContain('`${role} · ${ids.size.toLocaleString("en")} ${ids.size === 1 ? WORK_DOMAINS[kind].label.toLowerCase() : WORK_DOMAINS[kind].pluralLabel.toLowerCase()}`');
  expect(page).toContain('<span key={role} className="block" data-person-credit="">{role}</span>');
});
