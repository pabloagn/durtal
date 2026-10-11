import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";

const url = process.env.DURTAL_DISPOSABLE_RESET_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln497_disposable_reset")
    throw new Error("Reset tests require disposable local sln497_disposable_reset");
  requireDisposableDatabaseUrl(url, "sln497_disposable_reset");
}

it("rejects remote, encoded and libpq-overridden targets before connecting", () => {
  const good = "postgresql://test:password@127.0.0.1:12345/sln497_disposable_reset";
  expect(requireDisposableDatabaseUrl(good, "sln497_disposable_reset")).toBe(good);
  for (const bad of [
    good.replace("127.0.0.1", "database.example"),
    good.replace("sln497_disposable_reset", "production"),
    good.replace("sln497_disposable_reset", "%73ln497_disposable_reset"),
    good.replace("postgresql:", "https:"),
    ...["host=remote", "hostaddr=203.0.113.1", "dbname=production", "database=production", "service=prod", "host=%2Ftmp", "%68ost=remote", "options=-csearch_path=other"].map((override) => `${good}?${override}`),
    `${good}#other`,
  ]) expect(() => requireDisposableDatabaseUrl(bad, "sln497_disposable_reset")).toThrow();
});

describe.skipIf(!url).sequential("disposable reset keeps production guards", () => {
  const client = url ? postgres(url, { max: 2, prepare: false, onnotice: () => {} }) : null;
  const c = client!;
  afterAll(async () => { await client?.end({ timeout: 5 }); });

  it("recreates a populated schema and restores genuine migration seeds", async () => {
    await resetDisposableDatabase(url!, "sln497_disposable_reset");
    await c`insert into works(title) values ('Previous fixture')`;
    await resetDisposableDatabase(url!, "sln497_disposable_reset");
    expect(await c`select count(*)::int as n from works`).toEqual([{ n: 0 }]);
    expect(await c`select name, type from locations`).toEqual([{ name: "eBooks", type: "digital" }]);
    expect(await c`select reading_auto_track_ebooks, lookup_settings from app_settings`).toEqual([{ reading_auto_track_ebooks: true, lookup_settings: null }]);
  }, 30000);

  it("refuses permanent-ledger removal after every reset, even when empty", async () => {
    for (let round = 0; round < 2; round++) {
      await resetDisposableDatabase(url!, "sln497_disposable_reset", { emptyLocations: true });
      expect(await c`select count(*)::int as n from locations`).toEqual([{ n: 0 }]);
      expect(await c`select count(*)::int as n from app_settings`).toEqual([{ n: 0 }]);
      for (const table of ["ebook_annotation_cursors", "ebook_annotation_retired_ids", "reader_sitting_receipts"])
        await expect(c.unsafe(`truncate only ${table}`)).rejects.toMatchObject({ code: "23514" });
      for (const table of ["ebook_upload_operations", "ebook_upload_capacity"]) {
        // The upload tables reference each other. Include both through CASCADE
        // so PostgreSQL reaches the history guard instead of refusing the FK.
        await expect(c.unsafe(`truncate ${table} cascade`)).rejects.toMatchObject({
          code: "23514",
          message: expect.stringMatching(/^Upload history in ebook_upload_(capacity|operations) is permanent; TRUNCATE is forbidden$/),
        });
        await expect(c.unsafe(`delete from ${table}`)).rejects.toMatchObject({
          code: "23514",
          message: `Upload history in ${table} is permanent; DELETE is forbidden`,
        });
      }
    }
  }, 30000);
});
