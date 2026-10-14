import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("server-only", () => ({}));
// The duplicate refusal comes before any publication is read, so its evidence is taken as accepted here
vi.mock("@/lib/ebooks/publication-evidence", async (load) => ({ ...await load<object>(), acceptedPublication: () => true }));
import { readUploadTargetSummary } from "@/lib/ebooks/upload/target-summary";
import { readUploadTargetSnapshotOn } from "@/lib/ebooks/upload/atomic-snapshots";
import { planUploadRegistrationOn, uploadTargetRowsFingerprint } from "@/lib/ebooks/ingest/upload-atomic";
import { targetFingerprintFromRows } from "@/lib/ebooks/upload-core/snapshots";

// The upload page's fingerprint for an add-format or replace link must be the
// one the server checks at preview (SLN-672). Disposable local database only.
const url = process.env.DURTAL_EBOOK_UPLOAD_TARGET_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln672_ebook_upload_target")
    throw new Error("Upload target tests require disposable local sln672_ebook_upload_target");
}
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
describe.skipIf(!url)("upload target summary on PostgreSQL", () => {
  const conn = (client ? drizzle(client, { schema }) : null) as unknown as Db;
  beforeAll(async () => { await migrate(drizzle(client!, { schema }), { migrationsFolder: "src/lib/db/migrations" }); });
  afterAll(async () => { await client?.end(); });
  it("matches the server's fingerprint, names the file, and refuses a file of another eBook", async () => {
    const insert = async (title: string) => {
      const [ebook] = await client!`insert into ebooks(title, import_source, search_text) values (${title}, 'upload', ${title.toLowerCase()}) returning id`;
      const [file] = await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status)
        values (${ebook.id}, ${randomUUID().replaceAll("-", "").padEnd(64, "0")}, ${`ebooks/${randomUUID()}.epub`}, 'epub', 2048, 'application/epub+zip', 'stored') returning id`;
      return { ebookId: ebook.id as string, fileId: file.id as string };
    };
    const one = await insert("À rebours"), other = await insert("Là-bas");
    const summary = await readUploadTargetSummary(one.ebookId, one.fileId, conn);
    const snapshot = await readUploadTargetSnapshotOn(conn, { ebookIds: [one.ebookId], runId: randomUUID() });
    expect(summary).toEqual({ fingerprint: uploadTargetRowsFingerprint(snapshot), title: "À rebours", file: { format: "epub", sizeBytes: 2048 } });
    expect(summary!.fingerprint).toBe(targetFingerprintFromRows(snapshot, one.ebookId));
    expect((await readUploadTargetSummary(one.ebookId, null, conn))?.file).toBeNull();
    expect(await readUploadTargetSummary(one.ebookId, other.fileId, conn)).toBeNull();
    expect(await readUploadTargetSummary(randomUUID(), null, conn)).toBeNull();
    // A change to the eBook changes what the server will check
    await client!`update ebooks set title = 'A rebours' where id = ${one.ebookId}`;
    expect((await readUploadTargetSummary(one.ebookId, null, conn))!.fingerprint).not.toBe(summary!.fingerprint);
  });
  it("refuses a file already in the library in plain words, so the page can show why", async () => {
    const sha256 = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const [ebook] = await client!`insert into ebooks(title, import_source, search_text) values ('Nadja', 'upload', 'nadja') returning id`;
    await client!`insert into ebook_files(ebook_id, sha256, s3_key, format, size_bytes, content_type, status)
      values (${ebook.id}, ${sha256}, ${`ebooks/${randomUUID()}.epub`}, 'epub', 2048, 'application/epub+zip', 'stored')`;
    const path = `upload:${randomUUID()}`;
    const file = { path, size: 2048, mtimeMs: 0, sha256, format: "epub", contentType: "application/epub+zip", key: "k",
      problem: null, drm: null, metadata: {}, manifestKey: null };
    const group = { key: path, folder: path, sidecar: null, importSource: "upload", importRef: null, personalData: false,
      existingEbookId: null, ebook: { title: "Nadja" }, paths: [path] };
    await expect(planUploadRegistrationOn(conn, { group, file, target: { kind: "new" }, runId: randomUUID(), at: new Date() } as never))
      .rejects.toMatchObject({ status: 409, code: "upload_already_stored", message: "This exact file is already in the library." });
  });
});
