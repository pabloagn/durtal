import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";

const url = process.env.DURTAL_EBOOK_IMPORT_EXISTING_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln657_import_existing")
    throw new Error("Import existing tests require disposable local sln657_import_existing");
}
const client = url ? postgres(url, { prepare: false, max: 8, onnotice: () => {} }) : null;
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

import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { currentTarget, planCommand, undoCommand } from "@/lib/ebooks/ingest/command";
import { applyPlan, planSha256, resumeRun, runReconcileScope, type ApplyOptions } from "@/lib/ebooks/ingest/run";
import { reconcileIngest } from "@/lib/ebooks/ingest/reconcile";
import { takeCalibreSnapshot } from "@/lib/ebooks/calibre/snapshot";
import { importExistingCounts, planImportExistingOn, planSelectionMatchingOn, writeImportExisting, type ImportExistingPlan } from "@/lib/ebooks/calibre/import-existing";
import { readSelection } from "@/lib/ebooks/calibre/selection";
import { applyMatchingDocument, labelMatchingDocument, undoMatchingDocument } from "@/lib/ebooks/match/command";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { ARCANE_UUID, CHAMPS_UUID, NADJA_UUID, POLICEMAN_UUID, makeCalibreLibrary, type FixtureBook } from "../fixtures/calibre-library";
import { encryptionXml, makeEpub } from "../fixtures/ebook-builders";

/*
 * SLN-657: Import existing on PostgreSQL. A catalogue of Durtal books, a
 * Calibre library built in code that has some of them, some of them twice,
 * an omnibus, a shared ISBN, a DRM file, a file missing on the drive and
 * books Durtal does not have; the bucket in memory. The steps build on one
 * another: the dry run, the ingest of its selection, its matching, a second
 * dry run, the undo.
 */

const bucket = new Map<string, Buffer>();
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
      const keys = [...bucket.keys()].filter((k) => k.startsWith(command.input.Prefix ?? "")).sort();
      return { Contents: keys.map((Key) => ({ Key, Size: bucket.get(Key)!.length, LastModified: new Date() })), IsTruncated: false };
    }
    if (command instanceof HeadObjectCommand) {
      const bytes = bucket.get(command.input.Key!);
      if (!bytes) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return {
        ContentLength: bytes.length,
        ...(command.input.ChecksumMode === "ENABLED" ? { ChecksumSHA256: sha256(bytes).toString("base64"), ChecksumType: "FULL_OBJECT" } : {}),
        Metadata: { sha256: sha256(bytes).toString("hex") },
        LastModified: new Date(),
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = bucket.get(command.input.Key!);
      if (!object) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      const match = /bytes=(\d+)-(\d*)/.exec(command.input.Range ?? "bytes=0-")!;
      const bytes = object.subarray(Number(match[1]), match[2] ? Number(match[2]) + 1 : undefined);
      return {
        ContentLength: bytes.length,
        Body: { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) },
      };
    }
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key!;
      if (command.input.IfNoneMatch === "*" && bucket.has(key))
        throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      const bytes = await bodyBytes(command.input.Body);
      if (command.input.ChecksumSHA256 !== sha256(bytes).toString("base64")) throw Object.assign(new Error("BadDigest"), { name: "BadDigest", $metadata: { httpStatusCode: 400 } });
      bucket.set(key, bytes);
      return {};
    }
    throw new Error(`Unexpected S3 command ${(command as object).constructor.name}`);
  }) as never);
}

const uuid = (n: number) => `9e${String(n).padStart(6, "0")}-1111-4222-8333-${String(n).padStart(12, "0")}`;
const CHAMPS_AGAIN = uuid(5);
const HOPSCOTCH = uuid(6);
const CRIME = uuid(7);
const NOTES = uuid(8);
const IDIOT = uuid(9);
const OMNIBUS = uuid(10);
const LOCKED = uuid(11);
const HARBOUR = uuid(12);
const VESSELS = uuid(13);
const SHARED_ISBN = "9780140449136";

function book(id: number, uuidValue: string, title: string, author: [string, string], language: string, extra: Partial<FixtureBook> = {}): FixtureBook {
  const folder = `${author[0]}/${title} (${id})`;
  return {
    id,
    uuid: uuidValue,
    title,
    sort: title,
    authors: [author],
    folder,
    fileName: `${title} - ${author[0]}`,
    formats: [{ format: "EPUB", bytes: makeEpub({ metadata: `<dc:title>${title}</dc:title><dc:language>${language.slice(0, 2)}</dc:language>`, salt: `book-${id}` }) }],
    pubdate: "2001-01-01 00:00:00+00:00",
    added: "2023-01-01 00:00:00+00:00",
    modified: "2023-01-01 00:00:00+00:00",
    hasCover: false,
    language,
    ...extra,
  };
}

const BRETON: [string, string] = ["André Breton", "Breton, André"];
const DOSTOEVSKY: [string, string] = ["Fyodor Dostoevsky", "Dostoevsky, Fyodor"];
const EXTRA: FixtureBook[] = [
  {
    ...book(5, CHAMPS_AGAIN, "Les Champs magnétiques", BRETON, "fra"),
    authors: [BRETON, ["Philippe Soupault", "Soupault, Philippe"]],
  },
  book(6, HOPSCOTCH, "Hopscotch", ["Julio Cortázar", "Cortázar, Julio"], "eng", { identifiers: [["isbn", "9780394752846"]] }),
  book(7, CRIME, "Crime and Punishment", DOSTOEVSKY, "eng", { identifiers: [["isbn", SHARED_ISBN]] }),
  book(8, NOTES, "Notes from Underground", DOSTOEVSKY, "eng", { identifiers: [["isbn", SHARED_ISBN]] }),
  book(9, IDIOT, "The Idiot", DOSTOEVSKY, "eng", { identifiers: [["isbn", SHARED_ISBN]] }),
  book(10, OMNIBUS, "Molloy, Malone Dies", ["Samuel Beckett", "Beckett, Samuel"], "eng"),
  {
    ...book(11, LOCKED, "The Locked Room", ["Ben Moss", "Moss, Ben"], "eng"),
    formats: [
      {
        format: "EPUB",
        bytes: makeEpub({
          entries: [
            { name: "META-INF/encryption.xml", data: encryptionXml([{ uri: "OEBPS/c1.xhtml", algorithm: "http://www.w3.org/2001/04/xmlenc#aes128-cbc" }]) },
            { name: "META-INF/rights.xml", data: "<rights/>" },
          ],
          metadata: `<dc:title>The Locked Room</dc:title><dc:creator>Ben Moss</dc:creator><dc:language>en</dc:language>`,
        }),
      },
    ],
  },
  book(12, HARBOUR, "Night Harbour", ["Anna Vale", "Vale, Anna"], "eng"),
  book(13, VESSELS, "Communicating Vessels", BRETON, "eng"),
];

/** Every file under a folder with its checksum and modification time */
function disk(root: string): Record<string, string> {
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

describe.skipIf(!url)("Import existing", () => {
  const c = client!;
  const database = testDb as unknown as Db;
  let work: string;
  let root: string;
  let cacheDir: string;
  let reportDir: string;
  let backup: string;
  let snapshotFile: string;
  let libraryBefore: Record<string, string>;
  const host = "test-mac";
  const target = () => currentTarget(url!);
  const works: Record<string, string> = {};
  let policemanCopy: string;
  const options = (extra: Partial<ApplyOptions> = {}): ApplyOptions => ({
    database, host, cacheDir, target: target(), backup, live: false, localDatabase: true, reportDir, sleep: async () => {}, ...extra,
  });
  const dryRun = () => withReadOnlyPlanningConnection(url!, (db) => planImportExistingOn(db, snapshotFile, { uploadSpeed: 1_000_000 }));
  const planSelection = (selection: string) =>
    withReadOnlyPlanningConnection(url!, (db) => planCommand({ database: db, roots: [root], host, cacheDir, target: target(), reportDir, calibre: snapshotFile, select: selection }));
  const catalogueCounts = async () => {
    const [row] = await c`select (select count(*) from works)::int as works, (select count(*) from authors)::int as authors,
      (select count(*) from series)::int as series, (select count(*) from publishing_houses)::int as publishers,
      (select count(*) from editions)::int as editions, (select count(*) from instances)::int as instances`;
    return row;
  };
  const byUuid = (plan: ImportExistingPlan, id: string) => plan.books.find((b) => b.uuid === id)!;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    work = mkdtempSync(path.join(tmpdir(), "durtal-import-existing-"));
    root = path.join(work, "Calibre Library");
    cacheDir = path.join(work, "cache");
    reportDir = path.join(work, "reports");
    backup = path.join(work, "backup.dump");
    writeFileSync(backup, "PGDMP fake custom-format header");

    // Durtal's books
    const location = randomUUID();
    await c`insert into locations(id,name,type,is_active) values(${location},'E-books','digital',true)`;
    await c`insert into app_settings(id,ebook_location_id) values(true,${location}) on conflict(id) do update set ebook_location_id=excluded.ebook_location_id`;
    const people: Record<string, string> = {};
    for (const name of ["André Breton", "Philippe Soupault", "Flann O'Brien", "Julio Cortázar", "Fyodor Dostoevsky", "Samuel Beckett", "Ben Moss", "Philip K. Dick"]) {
      people[name] = randomUUID();
      await c`insert into authors(id,name) values(${people[name]},${name})`;
    }
    const addWork = async (key: string, title: string, authors: string[], language: string, edition: { title?: string; language?: string; isbn?: string } = {}, originalTitle: string | null = null) => {
      const id = randomUUID();
      works[key] = id;
      await c`insert into works(id,title,original_title,kind,original_language,catalogue_status) values(${id},${title},${originalTitle},'book',${language},'accessioned')`;
      for (const name of authors) await c`insert into work_authors(work_id,author_id,role) values(${id},${people[name]},'author')`;
      const editionId = randomUUID();
      await c`insert into editions(id,work_id,title,language,isbn_13) values(${editionId},${id},${edition.title ?? title},${edition.language ?? language},${edition.isbn ?? null})`;
      return editionId;
    };
    await addWork("nadja", "Nadja", ["André Breton"], "fr", { isbn: "9782070360536" });
    const policemanEdition = await addWork("policeman", "The Third Policeman", ["Flann O'Brien"], "en");
    policemanCopy = randomUUID();
    await c`insert into instances(id,edition_id,location_id) values(${policemanCopy},${policemanEdition},${location})`;
    await addWork("arcane", "Arcane 17", ["André Breton"], "fr");
    await addWork("champs", "Les Champs magnétiques", ["André Breton", "Philippe Soupault"], "fr");
    await addWork("hopscotch", "Hopscotch", ["Julio Cortázar"], "es", { title: "Rayuela" }, "Rayuela");
    await addWork("crime", "Crime and Punishment", ["Fyodor Dostoevsky"], "ru", { language: "en" });
    await addWork("molloy", "Molloy", ["Samuel Beckett"], "en");
    await addWork("malone", "Malone Dies", ["Samuel Beckett"], "en");
    await addWork("locked", "The Locked Room", ["Ben Moss"], "en");
    await addWork("ubik", "Ubik", ["Philip K. Dick"], "en");

    await makeCalibreLibrary(root, { extra: EXTRA });
    ({ snapshotFile } = await takeCalibreSnapshot(root, { cacheDir, reportDir, host, volume: () => ({ uuid: null, mountPoint: null }) }));
    libraryBefore = disk(root);
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
  });

  let first: ImportExistingPlan;
  let files: ReturnType<typeof writeImportExisting>;
  let catalogueBefore: Awaited<ReturnType<typeof catalogueCounts>>;

  it("dry run: selects only the Calibre books that are Durtal's, links only the sure ones, and writes nothing", async () => {
    catalogueBefore = await catalogueCounts();
    first = await dryRun();
    files = writeImportExisting(first, reportDir);

    const tiers = Object.fromEntries(first.books.map((b) => [b.title + (b.uuid === CHAMPS_AGAIN ? " (again)" : ""), [b.tier, b.selected, b.autoLink, b.clashes]]));
    expect(tiers).toEqual({
      Nadja: ["exact", true, true, []],
      "The Third Policeman": ["strong", true, true, []],
      "Arcane 17": ["strong", false, false, []],
      "Les Champs magnétiques": ["strong", true, false, ["several_ebooks"]],
      "Les Champs magnétiques (again)": ["strong", true, false, ["several_ebooks"]],
      Hopscotch: ["strong", true, true, []],
      "Crime and Punishment": ["conflict", true, false, []],
      "Notes from Underground": ["conflict", false, false, []],
      "The Idiot": ["conflict", false, false, []],
      "Molloy, Malone Dies": ["to_choose", true, false, ["several_works"]],
      "The Locked Room": ["strong", true, false, []],
      "Night Harbour": ["not_in_durtal", false, false, []],
      "Communicating Vessels": ["same_author", false, false, []],
    });
    // The edition rules: the ISBN's edition, the digital copy waiting for its file, a new edition in another language
    expect(byUuid(first, NADJA_UUID)).toMatchObject({ workId: works.nadja, rule: "isbn_edition" });
    expect(byUuid(first, POLICEMAN_UUID)).toMatchObject({ workId: works.policeman, rule: "fill_copy", instanceId: policemanCopy });
    expect(byUuid(first, HOPSCOTCH)).toMatchObject({ workId: works.hopscotch, rule: "new_isbn_edition" });
    expect(byUuid(first, ARCANE_UUID).formats).toEqual([expect.objectContaining({ onDisk: false })]);
    expect(byUuid(first, LOCKED).formats).toEqual([expect.objectContaining({ onDisk: true, drm: "adobe-adept" })]);
    // Books out of scope are never read
    expect(byUuid(first, HARBOUR).formats).toEqual([expect.objectContaining({ onDisk: null })]);

    const counts = importExistingCounts(first);
    expect(counts).toMatchObject({
      books: 13,
      alreadyStored: 0,
      inScope: 9,
      selected: 8,
      noFile: 1,
      outside: 0,
      auto: 3,
      review: 5,
      clashes: { several_ebooks: 2, several_works: 1 },
      formats: { epub: 8, pdf: 1 },
      drm: { "adobe-adept": 1 },
      missingFiles: 0,
      rated: 1,
      readDates: 1,
      // The library's tags: counted, never written (SLN-658)
      tagged: 2,
      tags: 3,
      distinctTags: 3,
      leftForBulk: { conflict: 2, not_in_durtal: 1, same_author: 1 },
    });
    expect(first.coverage).toMatchObject({ works: 10, auto: 3, hasEbook: 0, copiesWaiting: 1, copiesAuto: 1, copiesReview: 0 });
    // Calibre has Arcane 17, but not its file: never among the books Calibre lacks
    expect(first.coverage.none.map((w) => w.title)).toContain("Ubik");
    expect(first.coverage.none.map((w) => w.title)).not.toContain("Arcane 17");
    expect(first.coverage.noFile).toEqual([expect.objectContaining({ title: "Arcane 17", why: "missing" })]);
    expect(first.selection.books.map((b) => b.uuid).sort()).toEqual([NADJA_UUID, POLICEMAN_UUID, CHAMPS_UUID, CHAMPS_AGAIN, HOPSCOTCH, CRIME, OMNIBUS, LOCKED].sort());

    const report = readFileSync(files.markdown, "utf8");
    expect(report).toContain("Dry run: nothing was written");
    expect(report).toContain("Tags: 2 books carry 3 tags (3 different).");
    expect(report).toContain("Ubik");
    expect(readFileSync(files.csv, "utf8").split("\n")).toHaveLength(14);
    expect(readSelection(files.selection)).toEqual(first.selection);

    expect(await catalogueCounts()).toEqual(catalogueBefore);
    expect(await c`select 1 from ebooks`).toHaveLength(0);
    expect(puts()).toEqual([]);
    expect(disk(root)).toEqual(libraryBefore);
  });

  it("reports a file leading outside the library apart from a missing one, and never reads it", async () => {
    const book = byUuid(first, ARCANE_UUID);
    const link = path.join(root, ...book.formats[0].path.split("/"));
    const target = path.join(work, "outside.epub");
    writeFileSync(target, "not read");
    symlinkSync(target, link);
    try {
      const plan = await dryRun();
      expect(byUuid(plan, ARCANE_UUID)).toMatchObject({ selected: false, formats: [expect.objectContaining({ onDisk: false, outside: true, drm: null })] });
      expect(importExistingCounts(plan)).toMatchObject({ noFile: 0, outside: 1, selected: 8 });
      expect(plan.coverage.none.map((w) => w.title)).not.toContain("Arcane 17");
      expect(plan.coverage.noFile).toEqual([expect.objectContaining({ title: "Arcane 17", why: "outside" })]);
      expect(plan.selection.books).toEqual(first.selection.books);
    } finally {
      rmSync(link);
      rmSync(target);
    }
    expect(disk(root)).toEqual(libraryBefore);
  });

  it("refuses a selection made against another catalogue or another snapshot", async () => {
    const extra = randomUUID();
    await c`insert into works(id,title,kind,original_language) values(${extra},'Valis','book','en')`;
    await expect(planSelection(files.selection)).rejects.toThrow("changed since this selection");
    await c`delete from works where id = ${extra}`;

    const other = path.join(work, "other-selection.json");
    writeFileSync(other, JSON.stringify({ ...first.selection, snapshotSha256: "0".repeat(64) }));
    await expect(planSelection(other)).rejects.toThrow("another snapshot");
    expect(existsSync(path.join(reportDir, "never"))).toBe(false);
  });

  let runId: string;
  let undoFile: string;

  it("ingests the selection alone: resumes after an interruption, creates no book, author, series or publisher", async () => {
    const { plan, files: planned } = await planSelection(files.selection);
    expect(plan.calibre?.selection).toEqual({ file: files.selection, books: 8 });
    const sources = new Set(Object.keys(plan.files).map((p) => path.relative(root, p).split(path.sep)[1]));
    expect([...sources].sort()).toEqual(
      ["Crime and Punishment (7)", "Hopscotch (6)", "Les Champs magnetiques (4)", "Les Champs magnétiques (5)", "Molloy, Malone Dies (10)", "Nadja (1)", "The Locked Room (11)", "The Third Policeman (2)"].sort(),
    );
    expect(plan.summary.ebooksToCreate).toBe(8);

    // The drive is unplugged after the third file: the run stops taking books and resumes later
    const controller = new AbortController();
    let stored = 0;
    const stopped = await applyPlan(planned.plan, options({ signal: controller.signal, afterStore: () => { if (++stored === 3) controller.abort(); } }));
    expect(stopped.state).toBe("interrupted");
    const runs = await c<{ id: string }[]>`select id from ebook_ingest_runs where plan_sha256 = ${planSha256(readFileSync(planned.plan, "utf8"))}`;
    runId = runs[0].id;
    expect(runId).toBe(stopped.runId);
    const resumed = await resumeRun(runId, options());
    expect(resumed).toMatchObject({ state: "finished", exact: true });
    undoFile = resumed.undoFile;

    // Reconciled again later by the run's id: the selection's files alone. The
    // whole library is not this run's to account for.
    const scope = await runReconcileScope(database, runId, cacheDir);
    expect(scope).toMatchObject({ roots: [root], host, runId });
    expect(scope.paths?.sort()).toEqual(Object.keys(plan.files).sort());
    expect((await reconcileIngest({ database, cacheDir, ...scope })).exact).toBe(true);
    expect((await reconcileIngest({ database, cacheDir, roots: [root], host })).exact).toBe(false);

    const refs = await c`select import_ref from ebooks order by import_ref`;
    expect(refs.map((r) => r.import_ref)).toEqual(first.selection.books.map((b) => b.uuid).sort());
    // Only the selected books' files reached the bucket
    for (const key of puts()) expect(key).toMatch(/^(bronze|silver|gold)\//);
    expect(await catalogueCounts()).toEqual(catalogueBefore);
    expect(disk(root)).toEqual(libraryBefore);
  });

  it("matches the selection one book, one e-book: the clashes and the DRM file go to review, the sure ones link and undo", async () => {
    const { document, notStored } = await withReadOnlyPlanningConnection(url!, (db) => planSelectionMatchingOn(db, databaseFingerprint(url!), readSelection(files.selection)));
    expect(notStored).toBe(0);
    expect(document.oneEbookPerWork).toBe(true);
    const ebooks = await c`select id, import_ref from ebooks`;
    const refOf = new Map(ebooks.map((e) => [e.id as string, e.import_ref as string]));
    const results = document.approval.plan.results;
    const auto = results.filter((r) => r.autoLink).map((r) => refOf.get(r.ebookId)).sort();
    expect(auto).toEqual([NADJA_UUID, POLICEMAN_UUID, HOPSCOTCH].sort());
    const champs = results.filter((r) => [CHAMPS_UUID, CHAMPS_AGAIN].includes(refOf.get(r.ebookId)!));
    expect(champs.flatMap((r) => r.candidates[0]?.reasons.map((reason) => reason.code) ?? [])).toContain("several_ebooks");
    // Within the selection alone its ISBN is no longer shared; the dry run, which saw the whole library, keeps it in review
    const crime = results.find((r) => refOf.get(r.ebookId) === CRIME)!;
    expect(crime.candidates[0].reasons[0].code).toBe("import_existing_review");
    expect(await catalogueCounts()).toEqual(catalogueBefore);

    // Joris labels the sample; the links go in, under the books Durtal already has
    const scored = labelMatchingDocument(document, document.approval.plan.sample.map((row) => ({ ebookId: row.ebookId, fingerprint: row.fingerprint, tier: row.tier!, label: "right" as const })));
    const applied = await applyMatchingDocument(database, url!, scored, { backup, live: false, reportDir });
    expect(applied).toMatchObject({ kind: "applied", linked: 3 });
    const linked = await c`select e.import_ref, ed.work_id from ebooks e join instances i on i.id = e.instance_id join editions ed on ed.id = i.edition_id where e.match_state = 'linked'`;
    expect(Object.fromEntries(linked.map((r) => [r.import_ref, r.work_id]))).toEqual({ [NADJA_UUID]: works.nadja, [POLICEMAN_UUID]: works.policeman, [HOPSCOTCH]: works.hopscotch });
    expect(await c`select e.instance_id from ebooks e where e.import_ref = ${POLICEMAN_UUID}`).toEqual([{ instance_id: policemanCopy }]);
    const after = await catalogueCounts();
    expect(after).toEqual({ ...catalogueBefore, editions: catalogueBefore.editions + 1, instances: catalogueBefore.instances + 2 });
    if (applied.kind !== "applied") throw new Error("Expected applied links");
    await undoMatchingDocument(database, url!, applied.undoFile, { backup, live: false });
    expect(await c`select 1 from ebooks where match_state = 'linked'`).toHaveLength(0);
    expect(await catalogueCounts()).toEqual(catalogueBefore);
  });

  it("a second dry run selects nothing new, and a second ingest of the selection writes nothing", async () => {
    const second = await dryRun();
    const counts = importExistingCounts(second);
    expect(counts).toMatchObject({ books: 13, alreadyStored: 8, selected: 0 });
    expect(second.selection.books).toEqual([]);

    const before = await c`select (select count(*) from ebooks)::int as ebooks, (select count(*) from ebook_files)::int as files`;
    const { plan, files: planned } = await planSelection(files.selection);
    expect(plan.summary.ebooksToCreate).toBe(0);
    expect(plan.summary.alreadyStored).toBe(Object.keys(plan.files).length);
    const putsBefore = puts().length;
    await applyPlan(planned.plan, options());
    expect(puts()).toHaveLength(putsBefore);
    expect(await c`select (select count(*) from ebooks)::int as ebooks, (select count(*) from ebook_files)::int as files`).toEqual(before);
  });

  it("undoes the ingest: the e-books go, Durtal's books stay", async () => {
    const undone = await undoCommand({ database, undoFile, backup, live: false, localDatabase: true });
    expect(undone).toMatchObject({ runId, ebooksRemoved: 8 });
    expect(await c`select 1 from ebooks`).toHaveLength(0);
    expect(await catalogueCounts()).toEqual(catalogueBefore);
    expect(importExistingCounts(await dryRun())).toMatchObject({ selected: 8 });
  });
});
