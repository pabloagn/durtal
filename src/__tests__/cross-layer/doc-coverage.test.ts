import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ── Docs cover every table and API route ────────────────────────────────────
// A new pgTable must appear in docs/02_DATA_MODEL.md and a new
// src/app/api/**/route.ts must appear in docs/05_API_REFERENCE.md.

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function files(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => match(path.basename(f)))
    .map((f) => path.join(dir, f));
}

const tables = files("src/lib/db/schema", (n) => n.endsWith(".ts")).flatMap(
  (f) => [...read(f).matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]),
);

const routes = files("src/app/api", (n) => n === "route.ts").map(
  (f) => "/" + path.dirname(path.relative("src/app", f)).split(path.sep).join("/"),
);

describe("doc coverage", () => {
  it("finds the tables and routes it checks", () => {
    expect(tables.length).toBeGreaterThan(50);
    expect(routes).toContain("/api/health");
  });

  it("docs/02_DATA_MODEL.md names every pgTable", () => {
    const doc = read("docs/02_DATA_MODEL.md");
    const missing = tables.filter((t) => !new RegExp(`\\b${t}\\b`).test(doc));
    expect(missing).toEqual([]);
  });

  it("docs/05_API_REFERENCE.md names every API route", () => {
    const doc = read("docs/05_API_REFERENCE.md");
    const missing = routes.filter((r) => !doc.includes(r));
    expect(missing).toEqual([]);
  });
});
