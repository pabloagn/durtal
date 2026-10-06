import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The enrichment scripts only parse flags (SLN-464, R9): every read and write
 * goes through the query builders and services in src/lib/enrichment/. A
 * `sql` template or a query string in a script fails this test.
 */

const DIR = "scripts/enrichment";
const QUERY = /\bsql`|\b(select\s+[\w*"]+[\s\S]{0,200}?\bfrom|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i;

describe("enrichment scripts", () => {
  it("hold no SQL of their own", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(QUERY.test(readFileSync(join(DIR, file), "utf8")), file).toBe(false);
  });

  it("finds a query in a script", () => {
    expect(QUERY.test("await conn.execute(sql`select 1`)")).toBe(true);
    expect(QUERY.test('client.unsafe("update works set title = $1")')).toBe(true);
    expect(QUERY.test("// Select the books, then update the report")).toBe(false);
  });
});
