import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completeUndoFile, releaseUndoFile, reserveUndoFile } from "@/lib/books/undo-file";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "undo-file-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the undo file of an --apply run", () => {
  it("a missing folder stops the run before anything is written", () => {
    expect(() => reserveUndoFile(join(dir, "missing", "undo.json"), "run-1")).toThrow(
      /does not exist\. Nothing written\./,
    );
  });

  it("another run's file is never overwritten", () => {
    const path = join(dir, "undo.json");
    reserveUndoFile(path, "run-1");
    completeUndoFile(path, { runId: "run-1", written: [{ table: "works", id: "w", column: "description", value: "x" }] });
    expect(() => reserveUndoFile(path, "run-2")).toThrow(/exists: it may be another run's undo file/);
    expect(JSON.parse(readFileSync(path, "utf8")).runId).toBe("run-1");
  });

  it("is created empty before the write, filled after the commit, and removed after a rollback", () => {
    const path = join(dir, "undo.json");
    reserveUndoFile(path, "run-1");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ runId: "run-1", written: [] });
    releaseUndoFile(path);
    expect(existsSync(path)).toBe(false);
  });
});
