import { describe, it, expect, vi } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/s3/client", () => ({ s3: {}, S3_BUCKET: "local-test" }));
import { KEY_COLUMNS, ownedPrefixes } from "@/lib/s3/cleanup";

describe("S3 cleanup reference check", () => {
  it("covers every column that stores an S3 key", () => {
    const listed = new Set(
      Object.entries(KEY_COLUMNS).flatMap(([table, columns]) =>
        columns.map((column) => `${table}.${column}`),
      ),
    );
    const stored = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .flatMap((table) => {
        const config = getTableConfig(table as PgTable);
        return config.columns
          .filter((column) => column.name.includes("s3"))
          .map((column) => `${config.name}.${column.name}`);
      });
    expect(stored.length).toBeGreaterThan(0);
    // A new key column must join the reference check, or cleanup could delete its files.
    expect(stored.filter((column) => !listed.has(column))).toEqual([]);
    // E-book keys do not all say "s3" (SLN-490): no e-book object is ever reported unused
    for (const column of ["ebooks.cover_key", "ebook_files.s3_key", "ebook_files.manifest_key", "ebook_files.cover_key"])
      expect(listed.has(column), column).toBe(true);
  });

  it("owned folders end with a slash so one id never matches another", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const all = [
      ...ownedPrefixes.work(id),
      ...ownedPrefixes.author(id),
      ...ownedPrefixes.collection(id),
      ...ownedPrefixes.edition(id),
      ...ownedPrefixes.comment({ entityType: "work", entityId: id, id }),
    ];
    for (const prefix of all) expect(prefix.endsWith(`${id}/`)).toBe(true);
  });
});
