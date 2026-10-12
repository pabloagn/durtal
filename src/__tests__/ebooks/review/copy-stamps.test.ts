import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
const mock = vi.hoisted(() => ({ stamp: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ebooks/match/existing-copy", () => ({ existingCopyStampForRow: mock.stamp }));
import { attachReviewCopyStampsOn } from "@/lib/ebooks/review/copy-stamps";
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = { updatedAt: "2026-10-11T10:00:00.123456Z", metadataFingerprint: "a".repeat(64) };
const options = () => ({ workId: id(1), title: "Saved book", editions: [{ id: id(2), copies: [
  { id: id(3), format: "ebook", canFill: true }, { id: id(4), format: "pdf", canFill: true },
] }] });

describe("same-snapshot copy stamp projection", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.stamp.mockReturnValue(stamp); });
  it("uses one caller connection read and forwards full raw metadata to the canonical core helper", async () => {
    const row = { id: id(3), edition_id: id(2), updated_at: stamp.updatedAt, notes: "Raw metadata" };
    const execute = vi.fn().mockResolvedValue([{ row }]);
    const value = await attachReviewCopyStampsOn({ execute } as unknown as Db, options());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mock.stamp).toHaveBeenCalledExactlyOnceWith(row);
    expect(value.editions[0].copies[0]).toEqual({ id: id(3), format: "ebook", canFill: true, stamp });
    expect(value.editions[0].copies[1].stamp).toBeNull();
  });
  it("never supplies a guard for unsupported timestamp or mismatched edition ownership", async () => {
    const execute = vi.fn().mockResolvedValue([{ row: { id: id(3), edition_id: id(2), updated_at: null } },
      { row: { id: id(4), edition_id: id(9), updated_at: stamp.updatedAt } }]);
    const value = await attachReviewCopyStampsOn({ execute } as unknown as Db, options());
    expect(value.editions[0].copies.map((copy) => copy.stamp)).toEqual([null, null]);
  });
  it("rejects duplicate or over-bound displayed copies before any read", async () => {
    const execute = vi.fn(), conn = { execute } as unknown as Db;
    const work = options(); work.editions[0].copies.push(work.editions[0].copies[0]);
    await expect(attachReviewCopyStampsOn(conn, work)).rejects.toThrow("duplicate");
    await expect(attachReviewCopyStampsOn(conn, { ...options(), editions: Array.from({ length: 201 }, () => options().editions[0]) }))
      .rejects.toThrow("bounds");
    expect(execute).not.toHaveBeenCalled();
  });
  it("projects only captured options when the caller mutates them during the guard read", async () => {
    let release!: (value: unknown) => void;
    const execute = vi.fn().mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const work = options(), pending = attachReviewCopyStampsOn({ execute } as unknown as Db, work);
    work.workId = id(9); work.editions[0].copies[0].format = "Changed";
    work.editions[0].copies[0].id = id(8); work.editions[0].id = id(7);
    release([{ row: { id: id(3), edition_id: id(2), updated_at: stamp.updatedAt } }]);
    const value = await pending;
    expect(value.workId).toBe(id(1));
    expect(value.editions[0]).toMatchObject({ id: id(2), copies: [
      { id: id(3), format: "ebook", stamp }, { id: id(4), stamp: null },
    ] });
  });
});
