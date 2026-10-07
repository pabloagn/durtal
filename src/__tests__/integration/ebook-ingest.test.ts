import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";

const url = process.env.DURTAL_EBOOK_INGEST_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln494_ebook_ingest")
    throw new Error("E-book ingestion tests require disposable local sln494_ebook_ingest");
}
const client = url ? postgres(url, { max: 8, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));

import { assertReadOnly, readOnlySession } from "@/lib/enrichment/read-only-session";
import { currentTarget, planCommand, resolveRoots, undoCommand } from "@/lib/ebooks/ingest/command";
import { applyPlan, resumeRun, type ApplyOptions } from "@/lib/ebooks/ingest/run";
import { reconcileIngest } from "@/lib/ebooks/ingest/reconcile";
import { getRun, listRuns, runSections } from "@/lib/ebooks/runs";
import { makeCbz, makeCorruptZip, makeEpub, makeFb2, makeImage, makeMobi, makePdf, makeSidecarOpf, encryptionXml } from "../fixtures/ebook-builders";

/*
 * SLN-494: the ingestion on PostgreSQL, over a temporary folder of e-books
 * built in code, with the e-book bucket in memory (S3's answers to list,
 * HEAD with checksum and a conditional PUT with its SHA-256). Nothing here
 * reaches AWS. The steps build on one another, as runs over one inbox do.
 */

interface StoredObject {
  bytes: Buffer;
  lastModified: Date;
}
const bucket = new Map<string, StoredObject>();
let send: ReturnType<typeof vi.spyOn>;
const puts = () => (send.mock.calls as [unknown][]).filter(([c]) => c instanceof PutObjectCommand).map(([c]) => (c as PutObjectCommand).input.Key!);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function fakeS3() {
  return vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      const { Prefix = "", ContinuationToken } = command.input;
      const keys = [...bucket.keys()].filter((k) => k.startsWith(Prefix)).sort();
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const more = start + 25 < keys.length;
      return {
        Contents: keys.slice(start, start + 25).map((Key) => ({ Key, Size: bucket.get(Key)!.bytes.length, LastModified: bucket.get(Key)!.lastModified })),
        IsTruncated: more,
        NextContinuationToken: more ? String(start + 25) : undefined,
      };
    }
    if (command instanceof HeadObjectCommand) {
      const object = bucket.get(command.input.Key!);
      if (!object) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return {
        ContentLength: object.bytes.length,
        ...(command.input.ChecksumMode === "ENABLED" ? { ChecksumSHA256: sha256(object.bytes).toString("base64"), ChecksumType: "FULL_OBJECT" } : {}),
        Metadata: { sha256: sha256(object.bytes).toString("hex") },
        LastModified: object.lastModified,
      };
    }
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key!;
      if (command.input.IfNoneMatch === "*" && bucket.has(key))
        throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      const bytes = await bodyBytes(command.input.Body);
      if (command.input.ChecksumSHA256 !== sha256(bytes).toString("base64")) throw Object.assign(new Error("BadDigest"), { name: "BadDigest", $metadata: { httpStatusCode: 400 } });
      bucket.set(key, { bytes, lastModified: new Date() });
      return {};
    }
    throw new Error(`Unexpected S3 command ${(command as object).constructor.name}`);
  }) as never);
}

const LETTER_UUID = "6f1c2b9e-3a4d-4e5f-8a7b-9c0d1e2f3a4b";
const adobe = [
  { name: "META-INF/encryption.xml", data: encryptionXml([{ uri: "OEBPS/c1.xhtml", algorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc" }]) },
  { name: "META-INF/rights.xml", data: "<rights/>" },
];

function put(file: string, bytes: Uint8Array | string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

/** Every file under a folder with its checksum and modification time */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[full] = `${sha256(readFileSync(full)).toString("hex")} ${statSync(full).mtimeMs}`;
    }
  };
  walk(root);
  return out;
}

describe.skipIf(!url)("e-book ingestion", () => {
  const c = client!;
  const database = testDb as unknown as Db;
  let work: string;
  let root: string;
  let cacheDir: string;
  let reportDir: string;
  let backup: string;
  const host = "test-mac";
  const target = () => currentTarget(url!);
  const options = (extra: Partial<ApplyOptions> = {}): ApplyOptions => ({
    database,
    host,
    cacheDir,
    target: target(),
    backup,
    live: false,
    localDatabase: true,
    reportDir,
    sleep: async () => {},
    ...extra,
  });
  const plan = async (roots = [root]) => {
    const session = readOnlySession(url!);
    try {
      await assertReadOnly(session);
      return await planCommand({ database: drizzle(session) as unknown as Db, roots, host, cacheDir, target: target(), reportDir });
    } finally {
      await session.end();
    }
  };
  const rowCounts = async () => {
    const [row] = await c`select (select count(*) from ebooks)::int as ebooks, (select count(*) from ebook_files)::int as files,
      (select count(*) from ebook_ingest_runs)::int as runs, (select count(*) from ebook_ingest_items)::int as items`;
    return row as unknown as { ebooks: number; files: number; runs: number; items: number };
  };
  const itemsOf = async (runId: string) => {
    const rows = await c`select source_path, state, outcome, reason, ebook_id, file_id from ebook_ingest_items where run_id = ${runId}`;
    return Object.fromEntries(rows.map((r) => [path.relative(root, r.source_path), r])) as Record<string, { state: string; outcome: string | null; reason: string | null; ebook_id: string | null; file_id: string | null }>;
  };

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`delete from ebook_ingest_runs`;
    await c`delete from ebook_files`;
    await c`delete from ebooks`;
    work = mkdtempSync(path.join(tmpdir(), "durtal-ingest-"));
    root = path.join(work, "eBooks");
    cacheDir = path.join(work, "cache");
    reportDir = path.join(work, "reports");
    backup = path.join(work, "backup.dump");
    writeFileSync(backup, "PGDMP fake custom-format header");

    // A sidecar folder with two formats, loose books, a copy, a DRM EPUB beside its PDF, a damaged zip and a photo
    const letter = path.join(root, "Anna Vale", "The Letter and the Lamp (42)");
    put(path.join(letter, "metadata.opf"), makeSidecarOpf({ title: "The Letter and the Lamp", author: "Anna Vale", fileAs: "Vale, Anna", uuid: LETTER_UUID, isbn: "9780306406157", rating: 8 }));
    put(path.join(letter, "The Letter and the Lamp - Anna Vale.epub"), makeEpub({ cover: await makeImage("png", { width: 600, height: 900, color: "#556677" }), salt: "letter" }));
    put(path.join(letter, "The Letter and the Lamp - Anna Vale.pdf"), makePdf({ info: { Title: "The Letter and the Lamp", Author: "Anna Vale" } }));
    put(path.join(root, "loose", "Night Harbour.cbz"), await makeCbz());
    const lamp = makeFb2({ title: "The Lamp" });
    put(path.join(root, "loose", "The Lamp.fb2"), lamp);
    put(path.join(root, "zz copies", "The Lamp (copy).fb2"), lamp);
    put(path.join(root, "locked", "Locked.epub"), makeEpub({ entries: adobe, metadata: `<dc:title>The Locked Room</dc:title><dc:creator>Ben Moss</dc:creator><dc:language>en</dc:language>` }));
    put(path.join(root, "locked", "Locked.pdf"), makePdf({ info: { Title: "Locked" } }));
    put(path.join(root, "broken.epub"), makeCorruptZip());
    put(path.join(root, "photo.png"), await makeImage("png", { width: 40, height: 40 }));
  }, 60_000);
  afterAll(async () => {
    await client?.end();
    if (work) rmSync(work, { recursive: true, force: true });
  });
  beforeEach(() => {
    send = fakeS3();
  });
  afterEach(() => {
    send.mockRestore();
    vi.unstubAllEnvs();
  });

  let firstRun: string;
  let disk: Record<string, string>;

  it("plans read-only: no row is written, and the probe refuses a session that accepts writes", async () => {
    const { plan: first, files } = await plan();
    expect(await rowCounts()).toEqual({ ebooks: 0, files: 0, runs: 0, items: 0 });
    expect(puts()).toEqual([]);
    for (const file of Object.values(files)) expect(existsSync(file)).toBe(true);
    expect(first.summary).toMatchObject({ found: 9, ebooksToCreate: 5, formatsToAdd: 2, duplicates: 1, alreadyStored: 0 });
    expect(first.summary.quarantined).toEqual([{ path: path.join(root, "broken.epub"), reason: expect.stringMatching(/central directory/i) }]);
    expect(first.summary.drm).toEqual({ "adobe-adept": 1 });
    expect(Object.values(first.summary.ignored)).toEqual([1]);
    expect(readFileSync(files.csv, "utf8").split("\n")[0]).toBe("path,outcome,reason,format,size_bytes,sha256,drm,title,authors,word_count,page_estimate,language,duplicate_of,key");

    // The probe must fail on purpose: a session that takes the write is refused
    await expect(assertReadOnly(c)).rejects.toThrow("accepted a write");
  });

  it("refuses an apply before writing: no backup, an old backup, or a database that is not a preview without --live", async () => {
    const { files } = await plan();
    await expect(applyPlan(files.plan, options({ backup: undefined }))).rejects.toThrow("--apply needs --backup FILE");
    const old = path.join(work, "old.dump");
    writeFileSync(old, "PGDMP old");
    const twoHoursAgo = (Date.now() - 2 * 3600_000) / 1000;
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    await expect(applyPlan(files.plan, options({ backup: old }))).rejects.toThrow("--apply needs --backup FILE");
    const notDump = path.join(work, "not.dump");
    writeFileSync(notDump, "-- plain SQL");
    await expect(applyPlan(files.plan, options({ backup: notDump }))).rejects.toThrow("--apply needs --backup FILE");
    await expect(applyPlan(files.plan, options({ localDatabase: false }))).rejects.toThrow("needs --live");
    await expect(applyPlan(files.plan, options({ target: { ...target(), database: "0123456789abcdef" } }))).rejects.toThrow("another database");
    expect(await rowCounts()).toEqual({ ebooks: 0, files: 0, runs: 0, items: 0 });
    expect(puts()).toEqual([]);
  });

  it("applies: every e-book pending, its files stored and verified with counts, covers, manifests and source paths, the run finished and exact", async () => {
    disk = snapshot(root);
    const { files } = await plan();
    const result = await applyPlan(files.plan, options());
    firstRun = result.runId;
    expect(result).toMatchObject({ state: "finished", exact: true });
    expect(result.reconciliation).toMatchObject({ onDisk: 9, inNeon: 7, inS3: 7, exact: true, noLongerInInbox: 0 });

    const ebooks = await c`select id, title, match_state, import_source, import_ref, preferred_file_id, cover_key, authors from ebooks`;
    expect(ebooks.map((e) => [e.title, e.match_state]).sort()).toEqual([
      ["Night Harbour", "pending"],
      ["The Lamp", "pending"],
      ["The Letter and the Lamp", "pending"],
      ["The Locked Room", "pending"],
      ["broken", "pending"],
    ]);
    const letter = ebooks.find((e) => e.title === "The Letter and the Lamp")!;
    expect(letter).toMatchObject({ import_source: "folder", import_ref: LETTER_UUID });

    const rows = await c`select id, ebook_id, sha256, format, size_bytes, s3_key, status, drm, source_host, source_path, word_count, front_back_word_count, page_estimate,
      text_language, manifest_key, cover_key, metadata from ebook_files order by source_path`;
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      const bytes = readFileSync(row.source_path);
      expect(row.sha256).toBe(sha256(bytes).toString("hex"));
      expect(Number(row.size_bytes)).toBe(bytes.length);
      expect(row.s3_key).toBe(`files/${row.sha256.slice(0, 2)}/${row.sha256}.${row.format}`);
      expect(bucket.get(row.s3_key)?.bytes.equals(bytes)).toBe(true);
      expect(row.source_host).toBe(host);
      if (row.manifest_key) expect(bucket.has(row.manifest_key)).toBe(true);
      if (row.cover_key) expect(bucket.has(row.cover_key)).toBe(true);
    }
    const byName = Object.fromEntries(rows.map((r) => [path.basename(r.source_path), r]));
    expect(byName["The Letter and the Lamp - Anna Vale.epub"]).toMatchObject({ status: "stored", drm: null, text_language: "en", manifest_key: expect.stringContaining("/manifest.json") });
    expect(byName["The Letter and the Lamp - Anna Vale.epub"].word_count).toBeGreaterThan(900);
    expect(byName["The Letter and the Lamp - Anna Vale.epub"].front_back_word_count).toBeGreaterThan(0);
    expect(byName["The Letter and the Lamp - Anna Vale.epub"].cover_key).toMatch(/derived\/[0-9a-f]{64}\/cover-800\.webp$/);
    // The sidecar's title wins; the file's own stays under embedded
    expect(byName["The Letter and the Lamp - Anna Vale.epub"].metadata).toMatchObject({ title: "The Letter and the Lamp", embedded: { title: "The House by the River" }, sidecar: true });
    expect(letter.preferred_file_id).toBe(byName["The Letter and the Lamp - Anna Vale.epub"].id);
    expect(letter.cover_key).toBe(byName["The Letter and the Lamp - Anna Vale.epub"].cover_key);

    // DRM is stored with its kind and never preferred; the damaged zip is quarantined with its reason
    expect(byName["Locked.epub"]).toMatchObject({ status: "stored", drm: "adobe-adept", word_count: null, cover_key: null });
    expect(ebooks.find((e) => e.title === "The Locked Room")!.preferred_file_id).toBe(byName["Locked.pdf"].id);
    expect(byName["broken.epub"]).toMatchObject({ status: "quarantined", metadata: expect.objectContaining({ problem: expect.stringMatching(/central directory/i) }) });

    const items = await itemsOf(result.runId);
    expect(Object.keys(items)).toHaveLength(9);
    expect(Object.values(items).every((i) => i.state === "done")).toBe(true);
    expect(items["photo.png"]).toMatchObject({ outcome: "ignored", file_id: null });
    expect(items["broken.epub"]).toMatchObject({ outcome: "quarantined", reason: expect.stringMatching(/central directory/i) });
    const lampItems = [items["loose/The Lamp.fb2"], items["zz copies/The Lamp (copy).fb2"]];
    expect(lampItems.map((i) => i.outcome).sort()).toEqual(["duplicate_in_run", "new_ebook"]);
    // The duplicate names the file its first path stored
    expect(lampItems[0].file_id).toBe(lampItems[1].file_id);
    expect(rows.filter((r) => r.format === "fb2")).toHaveLength(1);

    // Nothing under the roots was moved, changed or deleted
    expect(snapshot(root)).toEqual(disk);
    const [run] = await c`select state, counts, reconciliation, finished_at, plan_sha256 from ebook_ingest_runs where id = ${result.runId}`;
    // Exactly the outcomes, with nothing left over from while it ran
    expect(run).toMatchObject({ state: "finished" });
    expect(run.counts).toEqual({ new_ebook: 4, new_format: 2, quarantined: 1, duplicate_in_run: 1, ignored: 1 });
    expect(result.counts).toEqual(run.counts);
  });

  it("shows the run on its pages: the list, the summary and its sections", async () => {
    const { runs, total } = await listRuns(50);
    expect(total).toBe(1);
    expect(runs[0]).toMatchObject({ id: firstRun, kind: "apply", state: "finished", host, roots: [root] });
    expect((await getRun(firstRun))?.reconciliation?.exact).toBe(true);
    const sections = await runSections(firstRun, {});
    expect(Object.fromEntries(sections.map((s) => [s.key, s.total]))).toEqual({ quarantined: 1, drm: 1, ignored: 1, duplicates: 1, new: 4, formats: 2 });
    expect(sections.find((s) => s.key === "drm")!.items[0]).toMatchObject({ path: path.join(root, "locked", "Locked.epub"), drm: "adobe-adept", ebookTitle: "The Locked Room" });
    expect((await runSections(firstRun, { formats: 1 })).find((s) => s.key === "formats")!.items).toHaveLength(1);
  });

  it("has nothing to do the second time: the plan finds every file stored, and an apply writes nothing", async () => {
    const before = await rowCounts();
    const { plan: again, files } = await plan();
    expect(again.summary).toMatchObject({ ebooksToCreate: 0, formatsToAdd: 0, changed: 0, alreadyStored: 7, uploadObjects: 0, uploadBytes: 0 });
    const result = await applyPlan(files.plan, options());
    expect(result).toMatchObject({ state: "finished", exact: true, uploadedBytes: 0 });
    expect(puts()).toEqual([]);
    const after = await rowCounts();
    expect({ ebooks: after.ebooks, files: after.files }).toEqual({ ebooks: before.ebooks, files: before.files });
    expect(Object.values(await itemsOf(result.runId)).filter((i) => i.outcome === "already_stored")).toHaveLength(7);
  });

  it("keeps the reconciliation exact when a source file is deleted after its object was stored: it is no longer in the inbox", async () => {
    const gone = path.join(root, "loose", "Night Harbour.cbz");
    const bytes = readFileSync(gone);
    unlinkSync(gone);
    const reconciliation = await reconcileIngest({ database, roots: [root], host, cacheDir });
    expect(reconciliation).toMatchObject({ exact: true, noLongerInInbox: 1, onDisk: 8, inNeon: 7 });
    put(gone, bytes);
    disk[gone] = `${sha256(bytes).toString("hex")} ${statSync(gone).mtimeMs}`;
  });

  it("resumes an apply interrupted between the upload and the registration: the object is adopted and registered once", async () => {
    const train = path.join(root, "loose", "Night Train.mobi");
    put(train, makeMobi({ title: "Night Train", exth: [[100, "Ben Moss"], [503, "Night Train"]] }));
    const { files } = await plan();
    let calls = 0;
    const crash = options({
      afterStore: () => {
        calls += 1;
        throw new Error("The machine went to sleep");
      },
    });
    await expect(applyPlan(files.plan, crash)).rejects.toThrow("The machine went to sleep");
    expect(calls).toBe(1);
    const [run] = await c`select id, state from ebook_ingest_runs order by started_at desc limit 1`;
    expect(run.state).toBe("interrupted");
    const sha = sha256(readFileSync(train)).toString("hex");
    expect(bucket.has(`files/${sha.slice(0, 2)}/${sha}.mobi`)).toBe(true);
    expect(await c`select 1 from ebook_files where sha256 = ${sha}`).toHaveLength(0);
    expect((await itemsOf(run.id))["loose/Night Train.mobi"].state).toBe("stored");

    const putsBefore = puts().length;
    const resumed = await resumeRun(run.id, options());
    expect(resumed).toMatchObject({ runId: run.id, state: "finished", exact: true, uploadedBytes: 0 });
    expect(puts().length).toBe(putsBefore);
    expect(await c`select 1 from ebook_files where sha256 = ${sha}`).toHaveLength(1);
    expect((await itemsOf(run.id))["loose/Night Train.mobi"]).toMatchObject({ state: "done", outcome: "new_ebook" });
    await expect(resumeRun(run.id, options())).rejects.toThrow("nothing to resume");
  });

  it("writes no row of a group whose atomic fails, and fails the item with the reason", async () => {
    const refused = path.join(root, "loose", "Refused.fb2");
    put(refused, makeFb2({ title: "Refused", salt: "refused" }));
    await c.unsafe(`create function refuse_ebook_file() returns trigger language plpgsql as $$
      begin if new.original_filename = 'Refused.fb2' then raise exception 'Refused for the test'; end if; return new; end $$;
      create trigger refuse_ebook_file before insert on ebook_files for each row execute function refuse_ebook_file();`);
    try {
      const { files } = await plan();
      const result = await applyPlan(files.plan, options());
      expect(result.state).toBe("failed");
      expect(result.reconciliation?.exceptions.filter((e) => e.blocking)).toEqual([expect.objectContaining({ side: "disk", kind: "failed", path: refused })]);
      expect(await c`select 1 from ebooks where title = 'Refused'`).toHaveLength(0);
      expect(await c`select 1 from ebook_files where original_filename = 'Refused.fb2'`).toHaveLength(0);
      expect((await itemsOf(result.runId))["loose/Refused.fb2"]).toMatchObject({ state: "failed", ebook_id: null, file_id: null, reason: expect.stringContaining("Refused for the test") });
    } finally {
      await c.unsafe(`drop trigger refuse_ebook_file on ebook_files; drop function refuse_ebook_file();`);
    }
  });

  it("adds a format from a second folder with the same sidecar uuid, and replaces a changed EPUB, moving the preferred file", async () => {
    const [letter] = await c`select id, preferred_file_id from ebooks where import_ref = ${LETTER_UUID}`;
    const later = path.join(root, "later", "The Letter and the Lamp");
    put(path.join(later, "metadata.opf"), makeSidecarOpf({ title: "The Letter and the Lamp", author: "Anna Vale", uuid: LETTER_UUID }));
    put(path.join(later, "The Letter and the Lamp.fb2"), makeFb2({ title: "The Letter and the Lamp", salt: "later" }));
    const epub = path.join(root, "Anna Vale", "The Letter and the Lamp (42)", "The Letter and the Lamp - Anna Vale.epub");
    put(epub, makeEpub({ cover: await makeImage("png", { width: 600, height: 900, color: "#665544" }), salt: "letter, corrected" }));

    const { plan: next, files } = await plan();
    expect(next.summary).toMatchObject({ ebooksToCreate: 1, formatsToAdd: 1, changed: 1 }); // Refused, the FB2, the EPUB
    const result = await applyPlan(files.plan, options());
    expect(result).toMatchObject({ state: "finished", exact: true });

    const own = await c`select id, format, status, sha256 from ebook_files where ebook_id = ${letter.id}`;
    expect(own.map((f) => [f.format, f.status]).sort()).toEqual([
      ["epub", "replaced"],
      ["epub", "stored"],
      ["fb2", "stored"],
      ["pdf", "stored"],
    ]);
    const replaced = own.find((f) => f.status === "replaced")!;
    const current = own.find((f) => f.format === "epub" && f.status === "stored")!;
    expect(replaced.id).toBe(letter.preferred_file_id);
    expect(current.sha256).toBe(sha256(readFileSync(epub)).toString("hex"));
    const [after] = await c`select preferred_file_id, cover_key from ebooks where id = ${letter.id}`;
    expect(after.preferred_file_id).toBe(current.id);
    expect(after.cover_key).toBe(`derived/${current.sha256}/cover-800.webp`);
    const items = await itemsOf(result.runId);
    expect(items["Anna Vale/The Letter and the Lamp (42)/The Letter and the Lamp - Anna Vale.epub"]).toMatchObject({ outcome: "replaced_file", ebook_id: letter.id });
    expect(items["later/The Letter and the Lamp/The Letter and the Lamp.fb2"]).toMatchObject({ outcome: "new_format", ebook_id: letter.id });
    expect(items["loose/Refused.fb2"]).toMatchObject({ outcome: "new_ebook" });
    expect(await c`select 1 from ebooks where import_ref = ${LETTER_UUID}`).toHaveLength(1);
  });

  it("plans ~/Downloads/eBooks when no folder is named, and says plainly when it is missing", async () => {
    const home = path.join(work, "home");
    mkdirSync(home);
    vi.stubEnv("HOME", home);
    expect(() => resolveRoots([])).toThrow("~/Downloads/eBooks does not exist. Make it and drop the eBooks in, or name a folder.");
    const inbox = path.join(home, "Downloads", "eBooks");
    put(path.join(inbox, "Inbox Book.epub"), makeEpub({ salt: "inbox" }));
    const roots = resolveRoots([]);
    expect(roots).toEqual([inbox]);
    const { plan: inboxPlan } = await plan(roots);
    expect(inboxPlan.roots).toEqual([inbox]);
    expect(inboxPlan.items.map((i) => [path.basename(i.path), i.outcome])).toEqual([["Inbox Book.epub", "new_ebook"]]);
    expect(() => resolveRoots([path.join(work, "nowhere")])).toThrow("does not exist.");
  });

  it("undoes a run: removes the rows nothing has touched, and keeps a file that gained a position", async () => {
    const batch = path.join(work, "batch");
    put(path.join(batch, "First.epub"), makeEpub({ salt: "first", metadata: "<dc:title>First</dc:title><dc:language>en</dc:language>" }));
    put(path.join(batch, "Second.epub"), makeEpub({ salt: "second", metadata: "<dc:title>Second</dc:title><dc:language>en</dc:language>" }));
    const { files } = await plan([batch]);
    const before = await rowCounts();
    const result = await applyPlan(files.plan, options());
    expect(result.state).toBe("finished");
    const [second] = await c`select f.id, f.ebook_id from ebook_files f join ebooks e on e.id = f.ebook_id where e.title = 'Second'`;
    await c`insert into ebook_positions (ebook_id, file_id, device_id, device_label, locator, progression, furthest_progression, client_updated_at)
      values (${second.ebook_id}, ${second.id}, 'device-1', 'Mac · Firefox', ${JSON.stringify({ href: "c1.xhtml" })}::jsonb, 0.2, 0.2, now())`;

    await expect(undoCommand({ database, undoFile: result.undoFile, backup: undefined, live: false, localDatabase: true })).rejects.toThrow("--undo needs --backup FILE");
    await expect(undoCommand({ database, undoFile: result.undoFile, backup, live: false, localDatabase: false })).rejects.toThrow("needs --live");
    const undone = await undoCommand({ database, undoFile: result.undoFile, backup, live: false, localDatabase: true });
    expect(undone).toMatchObject({ runId: result.runId, ebooksRemoved: 1, filesRemoved: 1, kept: 2 });
    expect(await c`select title from ebooks where title in ('First', 'Second')`).toEqual([{ title: "Second" }]);
    const after = await rowCounts();
    expect({ ebooks: after.ebooks, files: after.files }).toEqual({ ebooks: before.ebooks + 1, files: before.files + 1 });
    // Objects stay: content-addressed, and the orphan report lists them
    expect(puts().length).toBeGreaterThan(0);
  });
});
