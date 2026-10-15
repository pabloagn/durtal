import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake connection: `batch` is present (neon-http) or removed (postgres-js).
const fake: { batch?: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> } = {
  batch: vi.fn(),
  transaction: vi.fn(),
};
vi.mock("@/lib/db", () => ({ db: fake }));

const { readTogether } = await import("@/lib/db/read-together");

beforeEach(() => {
  fake.batch = vi.fn(async (queries: unknown[]) => queries.map((q) => `ran:${q}`));
  fake.transaction = vi.fn();
});

describe("readTogether()", () => {
  it("sends the reads in ONE batch when the driver has batch (neon-http)", async () => {
    const seen: unknown[] = [];
    const results = await readTogether((d) => {
      seen.push(d);
      return ["count", "page"] as const;
    });
    expect(seen).toEqual([fake]);
    expect(fake.batch).toHaveBeenCalledTimes(1);
    expect(fake.batch).toHaveBeenCalledWith(["count", "page"]);
    expect(results).toEqual(["ran:count", "ran:page"]);
  });

  it("runs the reads side by side, outside a transaction, when there is no batch", async () => {
    delete fake.batch;
    let release!: () => void;
    const first = new Promise<number>((resolve) => (release = () => resolve(1)));
    const started: string[] = [];
    const reading = readTogether(() => {
      started.push("count", "page");
      return [first, Promise.resolve(2)] as const;
    });
    expect(started).toEqual(["count", "page"]);
    release();
    expect(await reading).toEqual([1, 2]);
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it("sends nothing for no reads (neon rejects an empty batch)", async () => {
    expect(await readTogether(() => [] as const)).toEqual([]);
    expect(fake.batch).not.toHaveBeenCalled();
  });

  it("passes a failure through, so the caller sees it", async () => {
    fake.batch = vi.fn(async () => {
      throw new Error("canceling statement due to statement timeout");
    });
    await expect(readTogether(() => ["count"] as const)).rejects.toThrow("statement timeout");
  });
});
