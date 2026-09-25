import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// A fake connection: `batch` is present (neon-http) or removed (postgres-js).
const fake: { batch?: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> } = {
  batch: vi.fn(),
  transaction: vi.fn(),
};
vi.mock("@/lib/db", () => ({ db: fake }));

const { atomic } = await import("@/lib/db/atomic");

beforeEach(() => {
  fake.batch = vi.fn(async (queries: unknown[]) => queries.map((q) => `ran:${q}`));
  fake.transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown[]>) => run({ tx: true }));
});

describe("atomic()", () => {
  it("sends every query in ONE batch when the driver has batch (neon-http)", async () => {
    const results = await atomic(() => ["a", "b", "c"]);
    expect(fake.batch).toHaveBeenCalledTimes(1);
    expect(fake.batch).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(results).toEqual(["ran:a", "ran:b", "ran:c"]);
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it("sends nothing for an empty list (neon rejects an empty batch)", async () => {
    expect(await atomic(() => [])).toEqual([]);
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("builds the queries on the transaction when there is no batch", async () => {
    delete fake.batch;
    const seen: unknown[] = [];
    const results = await atomic((d) => {
      seen.push(d);
      return [Promise.resolve(1), Promise.resolve(2)];
    });
    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ tx: true }]);
    expect(results).toEqual([1, 2]);
  });

  it("passes a failure through, so the caller sees it", async () => {
    fake.batch = vi.fn(async () => {
      throw new Error("violates foreign key constraint");
    });
    await expect(atomic(() => ["a"])).rejects.toThrow("foreign key");
  });
});

describe("add-book wizard", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/library/new/wizard.tsx"), "utf8");

  it("submits through the single atomic action, not a chain of create calls", () => {
    expect(source).toContain("createBookFromWizard(");
    for (const name of ["createWork", "createEdition", "createInstance", "findOrCreateAuthor", "updateWorkTaxonomy", "addEditionToCollection"]) {
      expect(source, `${name} must not be called from the wizard`).not.toMatch(new RegExp(`\\b${name}\\(`));
    }
  });

  it("checks the ISBN before it leaves the edition step", () => {
    expect(source).toContain("isIsbnInUse(");
    expect(source).toMatch(/leaveEditionStep\("instance"\)/);
    expect(source).toMatch(/leaveEditionStep\("categorize"\)/);
  });
});
