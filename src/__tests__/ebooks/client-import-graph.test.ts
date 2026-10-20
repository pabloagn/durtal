import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// What a "use client" module imports ships to the browser. The book page's
// Read button once reached node:crypto through the e-book conditions, which
// broke the dev server and put the crypto polyfill in the page (SLN-1065).
// No client module may reach a node: built-in, the database client or the
// server environment (SLN-1278). A "use server" module ships only
// a reference to its actions, so the walk stops there.
const src = path.resolve(__dirname, "../..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  if (name === "__tests__" || name === "node_modules") return [];
  return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
});
const resolve = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const file of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")])
    if (existsSync(file) && statSync(file).isFile()) return file;
  return null;
};
/** The modules a file imports for their values: type-only imports and
 * exports ship nothing. A dynamic import() is a lazy chunk of its own, but
 * that chunk still ships to the browser, so it is followed too: Pick one for
 * me reached the database client through one (SLN-1278). `typeof import()`
 * and `import().Type` are types and ship nothing. */
const imports = (source: string): string[] => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  for (const m of code.matchAll(/(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (m[2]) continue;
    const names = m[3].match(/^\{([^}]*)\}$/)?.[1].split(",").map((n) => n.trim()).filter(Boolean);
    if (names?.length && names.every((n) => n.startsWith("type "))) continue;
    found.push(m[4]);
  }
  for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g)) found.push(m[1]);
  for (const m of code.matchAll(/(?<!typeof\s*)\bimport\(\s*["']([^"']+)["']\s*\)(?!\s*\.\s*[A-Z])/g)) found.push(m[1]);
  return found;
};
/** The database client and schema, its query helpers and the server
 * environment, by resolved file (the browser takes publicEnv from
 * env-public), and the packages behind them. drizzle-orm's `sql` tag alone
 * tree-shakes away; its pg-core builders do not. */
const SERVER_ONLY = ["lib/db/", "lib/env.ts", "lib/harmonization/store.ts"];
const SERVER_PACKAGES = ["drizzle-orm/pg-core", "drizzle-orm/neon", "@neondatabase/", "@aws-sdk/"];
const serverOnly = (file: string) => {
  const relative = path.relative(src, file).split(path.sep).join("/");
  return SERVER_ONLY.some((prefix) => relative.startsWith(prefix));
};
const serverActions = (source: string) => /^\s*["']use server["']/.test(source);

describe("client modules reach no server-only module (SLN-1065, SLN-1278)", () => {
  const all = files(src);
  const roots = all.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));

  it("finds the client modules", () => {
    expect(roots.length).toBeGreaterThan(50);
  });

  it("reaches no node: built-in, database client or server environment from any client module", () => {
    const seen = new Map<string, string[]>();
    const bad: string[] = [];
    const queue: [string, string[]][] = roots.map((file) => [file, [path.relative(src, file)]]);
    for (const [file, chain] of queue) {
      if (seen.has(file)) continue;
      seen.set(file, chain);
      const source = readFileSync(file, "utf8");
      if (chain.length > 1 && serverActions(source)) continue;
      for (const spec of imports(source)) {
        const next = resolve(file, spec);
        if (spec.startsWith("node:") || SERVER_PACKAGES.some((name) => spec.startsWith(name)) || (next && serverOnly(next))) {
          bad.push([...chain, spec].join(" -> "));
          continue;
        }
        if (next && !seen.has(next)) queue.push([next, [...chain, path.relative(src, next)]]);
      }
    }
    expect(bad).toEqual([]);
  });

  it("renders the book page's Read button on the server", () => {
    const button = readFileSync(path.join(src, "components/ebooks/catalogue-read-button.tsx"), "utf8");
    expect(button).not.toMatch(/^\s*["']use client["']/);
  });
});
