import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }) }));
import { prepareUploadAtomicExtension, type PreparedUploadAtomicExtension } from "@/lib/ebooks/upload/atomic-extension";
import { requireUploadAtomicExtension, parseUploadAtomicBinding } from "@/lib/ebooks/upload/atomic-extension-registry";
import { requireCoreAtomicExtension } from "@/lib/ebooks/match/atomic-extension";
import { requireMatchAtomicExtension, prepareMatchAtomicExtension } from "@/lib/ebooks/match/review-extension";
import { registerGroup, registrationPlanSha256, planRegistrationRestoration } from "@/lib/ebooks/ingest/register";
import { privateRegistrationInput } from "@/lib/ebooks/ingest/registration-input";
import { uploadRowSnapshotSql, uploadTableSnapshotSql } from "@/lib/ebooks/upload/atomic-snapshots";

import { id, at, uploadAtomicScenario as scenario } from "./atomic-fixture";
const dialect = new PgDialect();
function render(query: unknown) {
  return dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL());
}
const builders = { before: () => [], after: () => [] };
describe("distinct upload atomic capabilities", () => {
  it("keeps both issuer registries separate and rejects copied brands/plan/target substitutions", () => {
    const s = scenario(), extension = prepareUploadAtomicExtension(s.binding, builders);
    const expected = { coreWriter: "registration" as const, coreOperation: s.operation, ebookIds: s.binding.ebookIds };
    expect(requireUploadAtomicExtension(extension, expected)).toBe(extension);
    s.binding.job.rawSnapshot.generation = 100;
    expect(requireUploadAtomicExtension(extension, expected)).toBe(extension);
    for (const copy of [{ ...extension }, JSON.parse(JSON.stringify(extension))])
      expect(() => requireUploadAtomicExtension(copy as PreparedUploadAtomicExtension, expected)).toThrow("Untrusted");
    expect(() => requireUploadAtomicExtension(extension, { ...expected, coreOperation: { ...s.operation, planSha256: "f".repeat(64) } })).toThrow();
    expect(() => requireMatchAtomicExtension(extension as never, { ...expected, coreWriter: "link" })).toThrow("Untrusted");
    const review = prepareMatchAtomicExtension({ coreWriter: "link", coreOperation: s.operation,
      reviewOperations: [s.operation], ebookIds: s.binding.ebookIds, purpose: "decision" }, { extraTables: ["activity_events"], ...builders });
    expect(() => requireUploadAtomicExtension(review as never, expected)).toThrow("Untrusted");
    expect(() => requireCoreAtomicExtension(extension, { ...expected, coreWriter: "link", reviewUnlink: {} as never })).toThrow("cannot consume");
  });
  it("binds publication to durable inspection before allocated IDs exist and binds the held preview separately", () => {
    const s = scenario();
    expect(parseUploadAtomicBinding(s.binding).publication[0].id).toBe(id(2));
    const badInspection = scenario();
    ((badInspection.binding.job.rawSnapshot.progress as Record<string, unknown>).inspectionV1 as Record<string, unknown>).metadata = {};
    expect(() => parseUploadAtomicBinding(badInspection.binding)).toThrow("inspection");
    const changedPreview = scenario();
    ((changedPreview.binding.command.rawSnapshot.progress as Record<string, unknown>).uploadCoreV1 as Record<string, unknown>).previewTokenSha256 = "e".repeat(64);
    expect(() => parseUploadAtomicBinding(changedPreview.binding)).toThrow("preview");
  });
  it("guards retained reservations during settled preview and separately guards live worker leases", () => {
    const settled = scenario(), d = drizzle.mock() as unknown as Db;
    const text = prepareUploadAtomicExtension(settled.binding, builders).before(d).map(render).map((q) => q.sql).join("\n");
    expect(text).toContain("j.state='ready'");
    expect(text).toContain("j.reservation_released_at is null");
    expect(text).toContain("j.cleanup_verified_at is not null");
    expect(text).not.toContain("j.reservation_released_at is not null");
    expect(text).not.toContain("j.reserved_bytes=0");
    const leased = scenario(); leased.binding.job.mode = "leased"; leased.binding.job.leaseToken = id(11); leased.binding.job.rawSnapshot.lease_token = id(11);
    leased.binding.job.rawSnapshot.lease_expires_at = "2030-10-11T10:00:00.123456Z";
    const live = prepareUploadAtomicExtension(leased.binding, builders).before(d).map(render).map((q) => q.sql).join("\n");
    expect(live).toContain("j.lease_expires_at > clock_timestamp()");
    expect(live).toContain("c.worker_token=j.lease_token");
  });
  it("locks/checks retired annotation IDs, cursor/quote-note rows before effects and again after receipts", () => {
    const s = scenario(), extension = prepareUploadAtomicExtension(s.binding, builders), d = drizzle.mock() as unknown as Db;
    for (const table of ["ebook_annotation_retired_ids", "ebook_annotation_cursors", "reading_notes"]) {
      expect(extension.extraTables).toContain(table);
      expect(extension.before(d).map(render).some((q) => q.sql.includes(`from "${table}"`))).toBe(true);
      expect(extension.after(d).map(render).some((q) => q.sql.includes(`from "${table}"`))).toBe(true);
    }
    const sql = render(uploadTableSnapshotSql("reading_notes", { ebookIds: [id(1)], runId: id(5) })).sql;
    expect(sql).toContain('"ebook_annotation_id"');
    expect(sql).toContain("union select id from ebook_annotation_retired_ids");
  });
  it("formats complete guard rows in PostgreSQL at UTC6 and refuses Date/ms-only guards", () => {
    const rendered = render(uploadRowSnapshotSql("ebook_upload_operations", "j"));
    expect(rendered.sql).toContain("at time zone 'UTC'");
    expect(rendered.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    const s = scenario(); s.binding.job.rawSnapshot.cleanup_verified_at = "2026-10-11T10:00:00.123Z";
    expect(() => parseUploadAtomicBinding(s.binding)).toThrow("UTC6");
    const next = scenario(); next.binding.job.rawSnapshot.created_at = new Date(at);
    expect(() => parseUploadAtomicBinding(next.binding)).toThrow();
  });
  it("validates full permanent command envelopes as well as original outcome receipts", () => {
    const s = scenario();
    s.binding.receipt = { version: 1, operationId: id(4), parentOperationId: id(3), status: 200,
      request: { key: id(6), kind: "complete", requestSha256: "c".repeat(64), targetFingerprint: s.binding.command.targetFingerprint,
        bindingSha256: "d".repeat(64) }, result: s.binding.receipt as never, effect: null };
    expect(parseUploadAtomicBinding(s.binding).receipt).toEqual(s.binding.receipt);
    s.binding.receipt.request.requestSha256 = "e".repeat(64);
    expect(() => parseUploadAtomicBinding(s.binding)).toThrow("envelope");
  });
});
describe("canonical registration upload boundary", () => {
  it("keeps Date copies private and hashes all row/metadata changes", () => {
    const s = scenario(), copied = privateRegistrationInput(s.r), hash = registrationPlanSha256(s.r);
    s.r.at.setUTCFullYear(2030);
    expect(copied.at.toISOString()).toBe("2026-10-11T10:00:00.123Z");
    expect(registrationPlanSha256(s.r)).not.toBe(hash);
    expect(() => privateRegistrationInput({ get bad() { throw new Error("getter ran"); } })).toThrow("accessors");
    expect(() => privateRegistrationInput(new Map())).toThrow("plain");
  });
  it("rejects plan substitutions and silent add-format replacement before touching the supplied connection", async () => {
    const s = scenario(), extension = prepareUploadAtomicExtension(s.binding, builders);
    s.r.items[0].fileId = id(99);
    const conn = new Proxy({}, { get() { throw new Error("connection touched"); } }) as Db;
    await expect(registerGroup(conn, s.r, s.operation.runId, { uploadExtension: extension, operation: s.operation })).rejects.toThrow("plan hash");
  });
  it("propagates final batch failures and never captures caller mutations after its first await", async () => {
    const s = scenario(), extension = prepareUploadAtomicExtension(s.binding, builders), d = drizzle.mock() as unknown as Db;
    let rendered: ReturnType<typeof render>[] = [];
    Object.assign(d, { batch: async (queries: unknown[]) => {
      s.r.at.setUTCFullYear(2030); s.r.inserts[0].metadata = { corruption: "after-await" };
      rendered = queries.map(render);
      throw new Error("actual final receipt assertion rejected");
    } });
    await expect(registerGroup(d, s.r, s.operation.runId, { uploadExtension: extension, operation: s.operation }))
      .rejects.toThrow("actual final receipt assertion rejected");
    expect(rendered[0].sql).toContain("lock table");
    const firstInsert = rendered.findIndex((q) => q.sql.startsWith("insert into"));
    expect(firstInsert).toBeGreaterThan(rendered.findIndex((q) => q.sql.includes('from "ebook_annotation_cursors"')));
    expect(JSON.stringify(rendered.flatMap((q) => q.params))).not.toContain("after-await");
    expect(rendered.at(-1)!.params).toContain("durtal.ebook.upload.rows.v1");
  });
  it("compensates with retained files rather than deleting annotated files, and refuses stale original source identity", () => {
    const oldFile = { id: id(12), ebook_id: id(1), format: "epub", sha256: "e".repeat(64), s3_key: "old", manifest_key: "old-manifest", status: "verified", drm: null, cover_key: "old-cover" };
    const before = { ebooks: [{ id: id(1), preferred_file_id: id(12), cover_key: "old-cover" }], ebook_files: [oldFile] };
    const after = { ebooks: [{ id: id(1), preferred_file_id: id(2), cover_key: "new-cover" }], ebook_files: [
      { ...oldFile, status: "replaced" }, { id: id(2), ebook_id: id(1), status: "stored", format: "epub", sha256: "ab".repeat(32),
        s3_key: "new", manifest_key: "new-manifest", drm: null, cover_key: "new-cover" }] };
    const operation = { version: 1 as const, operationId: id(20), runId: id(5), targetDatabase: "0123456789abcdef" };
    const undo = planRegistrationRestoration({ operation, kind: "compensate_registration", ebookId: id(1), fileId: null, before, after });
    expect(undo.files).toEqual([{ fileId: id(2), status: "replaced" }, { fileId: id(12), status: "verified" }]);
    expect(undo.preferredAfter).toBe(id(12));
    after.ebook_files[0].sha256 = "f".repeat(64);
    expect(() => planRegistrationRestoration({ operation, kind: "restore_registration", ebookId: id(1), fileId: id(12), before, after })).toThrow("original");
  });
});
