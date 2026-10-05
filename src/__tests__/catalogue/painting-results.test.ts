import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaintingCount: vi.fn(),
  getPaintings: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  },
}));
vi.mock("@/lib/actions/paintings", () => mocks);
vi.mock("@/components/paintings/painting-grid", () => ({ PaintingGrid: () => null }));

import { PaintingResults } from "@/app/paintings/(list)/painting-results";

describe("the painting home's results", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a page past the end to the last page before reading any painting", async () => {
    mocks.getPaintingCount.mockResolvedValue(50);
    // Page 30,000 of 48 is an offset past the list's 1,000,000 cap
    await expect(
      PaintingResults({ params: { page: "30000", q: "garden" } }),
    ).rejects.toThrow("NEXT_REDIRECT /paintings?page=2&q=garden");
    expect(mocks.getPaintings).not.toHaveBeenCalled();
  });

  it("reads nothing when nothing matches, whatever the page", async () => {
    mocks.getPaintingCount.mockResolvedValue(0);
    const element = await PaintingResults({ params: { page: "30000" } });
    expect(mocks.getPaintings).not.toHaveBeenCalled();
    expect(element.props).toMatchObject({ paintings: [], pagination: { total: 0 } });
  });

  it("reads the page it shows", async () => {
    mocks.getPaintingCount.mockResolvedValue(50);
    mocks.getPaintings.mockResolvedValue([{ id: "a" }]);
    const element = await PaintingResults({ params: { page: "2" } });
    expect(mocks.getPaintings).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 48, offset: 48 }),
    );
    expect(element.props).toMatchObject({ paintings: [{ id: "a" }], pagination: { page: 2, total: 50 } });
  });
});
