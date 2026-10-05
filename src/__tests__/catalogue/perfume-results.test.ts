import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPerfumeCount: vi.fn(),
  getPerfumes: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  },
}));
vi.mock("@/lib/actions/perfumes", () => mocks);
vi.mock("@/components/perfumes/perfume-grid", () => ({ PerfumeGrid: () => null }));

import { PerfumeResults } from "@/app/perfumes/(list)/perfume-results";

describe("the perfume home's results", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a page past the end to the last page before reading any perfume", async () => {
    mocks.getPerfumeCount.mockResolvedValue(50);
    // Page 30,000 of 48 is an offset past the list's 1,000,000 cap
    await expect(
      PerfumeResults({ params: { page: "30000", q: "iris" } }),
    ).rejects.toThrow("NEXT_REDIRECT /perfumes?page=2&q=iris");
    expect(mocks.getPerfumes).not.toHaveBeenCalled();
  });

  it("reads nothing when nothing matches, whatever the page", async () => {
    mocks.getPerfumeCount.mockResolvedValue(0);
    const element = await PerfumeResults({ params: { page: "30000" } });
    expect(mocks.getPerfumes).not.toHaveBeenCalled();
    expect(element.props).toMatchObject({ perfumes: [], pagination: { total: 0 } });
  });

  it("reads the page it shows", async () => {
    mocks.getPerfumeCount.mockResolvedValue(50);
    mocks.getPerfumes.mockResolvedValue([{ id: "a" }]);
    const element = await PerfumeResults({ params: { page: "2" } });
    expect(mocks.getPerfumes).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 48, offset: 48 }),
    );
    expect(element.props).toMatchObject({ perfumes: [{ id: "a" }], pagination: { page: 2, total: 50 } });
  });
});
