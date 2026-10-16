import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  libraryNumbers: vi.fn(), writtenYears: vi.fn(), breakdown: vi.fn(), busiestYears: vi.fn(),
}));
vi.mock("@/lib/statistics/library", () => reads);
import { loadDashboardStatistics } from "@/lib/statistics/dashboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  reads.libraryNumbers.mockResolvedValue({ books: 2 });
  reads.writtenYears.mockResolvedValue({ years: [{ year: 1990, count: 2 }], undated: 0 });
  reads.breakdown.mockResolvedValue({ read: 1, unread: 1 });
  reads.busiestYears.mockResolvedValue([{ year: 1990, books: 2, covers: [] }]);
});

describe("dashboard statistics loading", () => {
  it("starts the independent reads together and starts covers as soon as years arrive", async () => {
    const numbers = deferred<{ books: number }>();
    reads.libraryNumbers.mockReturnValue(numbers.promise);
    const pending = loadDashboardStatistics();
    expect(reads.libraryNumbers).toHaveBeenCalledOnce();
    expect(reads.writtenYears).toHaveBeenCalledOnce();
    expect(reads.breakdown).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(reads.busiestYears).toHaveBeenCalledWith([{ year: 1990, count: 2 }], 1);
    numbers.resolve({ books: 2 });
    expect(await pending).toEqual({
      numbers: { books: 2 }, written: { years: [{ year: 1990, count: 2 }], undated: 0 },
      split: { read: 1, unread: 1 }, busiest: { year: 1990, books: 2, covers: [] },
    });
  });

  it("keeps an empty set of years and its absent cover section", async () => {
    reads.libraryNumbers.mockResolvedValue({ books: 0 });
    reads.writtenYears.mockResolvedValue({ years: [], undated: 0 });
    reads.busiestYears.mockResolvedValue([]);
    expect((await loadDashboardStatistics()).busiest).toBeUndefined();
    expect(reads.busiestYears).toHaveBeenCalledWith([], 1);
  });
});
