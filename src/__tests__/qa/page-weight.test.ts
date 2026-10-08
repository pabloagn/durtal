import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* scripts/qa/page-weight.js (SLN-479): a detail row with no record to
   measure is skipped when it says so, and fails otherwise. A small server
   stands in for the app. */

const pages: Record<string, string> = {
  "/empty": "<main>No import yet</main>",
  "/full": '<main><a href="/full/abc">An import</a></main>',
  "/full/abc": "<main>The preview</main>",
  // A list whose first link is the add page, and a notes page that quotes "two" most (SLN-510)
  "/books": '<main><a href="/books/new">Add</a><a href="/books/one">One</a><a href="/books/two">Two</a></main>',
  "/notes": '<main><a href="/books/one">One</a><a href="/books/two">Two</a><a href="/books/two">Two</a><a href="/books/one?x">One</a><a href="/books/two">Two</a></main>',
  "/books/new": "<main>Add a book</main>",
  "/books/one": "<main>One</main>",
  "/books/two": "<main>Two</main>",
};
let server: Server;
let base = "";
const dir = mkdtempSync(join(tmpdir(), "page-weight-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = pages[req.url ?? ""];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    res.end(body ?? "not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function run(routes: unknown[]): Promise<{ code: number; out: string }> {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ baseUrl: base, routes }));
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/qa/page-weight.js", base], { env: { ...process.env, PAGE_WEIGHT_CONFIG: file } }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

describe("page-weight.js", () => {
  it("skips a detail row with no link when it has an ifNone note", async () => {
    const { code, out } = await run([{ path: "/empty/*", maxKB: 400, maxMs: 5000, ifNone: "no import" }]);
    expect(code).toBe(0);
    expect(out).toContain("skip  /empty/*");
    expect(out).toContain("skipped: no import (no link on /empty)");
    expect(out).toContain("1 of 1 routes skipped: nothing to measure yet");
  });
  it("measures the row once a record exists", async () => {
    const { code, out } = await run([{ path: "/full/*", maxKB: 400, maxMs: 5000, ifNone: "no import" }]);
    expect(code).toBe(0);
    expect(out).toMatch(/^ok {4}\/full\/abc/m);
  });
  it("still fails a detail row with no link and no note", async () => {
    const { code, out } = await run([{ path: "/empty/*", maxKB: 400, maxMs: 5000 }]);
    expect(code).toBe(1);
    expect(out).toContain("FAIL  /empty/*");
    expect(out).toContain("no link found on /empty");
  });
  it("skips a slug such as the add page, and reads the most linked record from another page", async () => {
    const skipped = await run([{ path: "/books/*", maxKB: 400, maxMs: 5000, skip: ["new"] }]);
    expect(skipped.out).toMatch(/^ok {4}\/books\/one/m);
    const most = await run([{ path: "/books/*", list: "/notes", pick: "most", maxKB: 400, maxMs: 5000 }]);
    expect(most.out).toMatch(/^ok {4}\/books\/two/m);
    const none = await run([{ path: "/books/*", list: "/empty", pick: "most", maxKB: 400, maxMs: 5000, ifNone: "no quotes" }]);
    expect(none.out).toContain("skipped: no quotes (no link on /empty)");
  });
  it("measures a book, not the add page, and the book with the most quotes", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("scripts/qa/page-weight.json", "utf8")) as {
      routes: { path: string; ifNone?: string; skip?: string[]; list?: string; pick?: string }[];
    };
    const library = config.routes.filter((r) => r.path === "/library/*");
    expect(library.map((r) => [r.skip?.includes("new") ?? false, r.list ?? null, r.pick ?? null])).toEqual([
      [true, null, null],
      [false, "/reading/notes", "most"],
    ]);
    expect(config.routes.some((r) => r.path === "/library/new")).toBe(true);
  });
  it("gives the quoted book, the import preview, the Year in review, the reader and the ingestion run rows their notes, and no other row", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("scripts/qa/page-weight.json", "utf8")) as { routes: { path: string; ifNone?: string; list?: string }[] };
    expect(config.routes.find((r) => r.path === "/reading/import/*")?.ifNone).toBe("no import");
    expect(config.routes.find((r) => r.path === "/reading/year/*")?.ifNone).toBe("no finished year");
    expect(config.routes.find((r) => r.list === "/reading/notes")?.ifNone).toBe("no quotes");
    expect(config.routes.find((r) => r.path === "/ebooks/runs/*")?.ifNone).toBe("no ingestion run");
    expect(config.routes.find((r) => r.path === "/reader/*")?.ifNone).toBe("no e-book");
    expect(config.routes.filter((r) => r.ifNone).map((r) => r.path)).toEqual(["/library/*", "/reading/year/*", "/reading/import/*", "/ebooks/runs/*", "/reader/*"]);
  });
});
