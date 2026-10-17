import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => Object.fromEntries([
  "orders", "suggestions", "related", "targets", "collections", "similar", "marked",
  "series", "links", "readings", "notes", "day", "queue", "gate", "prediction",
  "estimates", "availability", "reach",
].map((name) => [name, vi.fn()])));
vi.mock("@/lib/actions/orders", () => ({ getOrdersForWork: reads.orders }));
vi.mock("@/lib/ebooks/review-queue/suggestions", () => ({ getEbookSuggestionCount: reads.suggestions }));
vi.mock("@/lib/actions/book-related", () => ({ getBookRelatedGroups: reads.related }));
vi.mock("@/lib/actions/publishers", () => ({ getAcquisitionTargets: reads.targets }));
vi.mock("@/lib/actions/collections", () => ({ getCollectionsForWork: reads.collections, getCollectionCoverPreviews: vi.fn(async (ids) => ids) }));
vi.mock("@/lib/actions/similar-works", () => ({ getSimilarWorks: reads.similar }));
vi.mock("@/lib/actions/works", () => ({ getWorksWithMark: reads.marked }));
vi.mock("@/lib/actions/series", () => ({ getOtherWorksInSeries: reads.series }));
vi.mock("@/lib/actions/work-relations", () => ({ getWorkRelations: reads.links }));
vi.mock("@/lib/actions/reading", () => ({ getReadingsForWork: reads.readings }));
vi.mock("@/lib/actions/reading-notes", () => ({ getNotesForWork: reads.notes }));
vi.mock("@/lib/actions/reading-queue", () => ({ getQueuePlace: reads.queue }));
vi.mock("@/lib/reading/day", () => ({ readingDayStartHour: reads.day }));
vi.mock("@/lib/reading/dates", () => ({ readingDay: () => "2026-10-17" }));
vi.mock("@/lib/utils/date", () => ({ appTimeZone: () => "Europe/Amsterdam" }));
vi.mock("@/lib/reading/suggest/context", () => ({ predictionGateOn: reads.gate, getBookPredictionContext: reads.prediction }));
vi.mock("@/lib/reading/estimates", () => ({ readingEstimates: reads.estimates }));
vi.mock("@/lib/ebooks/catalogue-availability", () => ({ catalogueAvailability: reads.availability }));
vi.mock("@/lib/ebooks/highlights", () => ({ getEbookReach: reads.reach }));
vi.mock("@/components/collections/collection-card", () => ({ collectionPoster: (media: unknown[]) => media.length ? media[0] : null }));

import { loadBookPageData } from "@/lib/catalogue/book-page-data";
import { getCollectionCoverPreviews } from "@/lib/actions/collections";

const work: Parameters<typeof loadBookPageData>[0] = {
  id: "book", kind: "book", seriesId: null, isRare: false, isPoison: false, isFavourite: false,
};
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(reads)) fn.mockReset().mockResolvedValue([]);
  reads.suggestions.mockResolvedValue(0);
  reads.day.mockResolvedValue(4);
  reads.gate.mockResolvedValue(true);
  reads.queue.mockResolvedValue(null);
  reads.estimates.mockResolvedValue({});
  reads.prediction.mockResolvedValue({ prediction: true });
  reads.availability.mockResolvedValue(new Map());
  reads.reach.mockResolvedValue(new Map());
});

describe("book page read dependencies", () => {
  it("starts dependent reads while an unrelated section is still loading", async () => {
    const orders = deferred<unknown[]>();
    reads.orders.mockReturnValue(orders.promise);
    reads.collections.mockResolvedValue([{ id: "without-poster", media: [] }, { id: "with-poster", media: [{}] }]);
    reads.readings.mockResolvedValue([
      { reading: { id: "open", status: "reading" } },
      { reading: { id: "paused", status: "paused" } },
      { reading: { id: "abandoned", status: "abandoned" } },
    ]);
    const pending = loadBookPageData(work);
    let complete = false;
    void pending.then(() => { complete = true; });
    await tick();

    expect(complete).toBe(false);
    expect(getCollectionCoverPreviews).toHaveBeenCalledWith(["without-poster"]);
    expect(reads.estimates).toHaveBeenCalledWith(["open", "paused"], "2026-10-17");
    expect(reads.prediction).toHaveBeenCalledWith("book");
    expect(reads.availability).toHaveBeenCalledWith(["book"]);
    expect(reads.reach).toHaveBeenCalledWith([]);
    orders.resolve([]);
    expect((await pending).today).toBe("2026-10-17");
  });

  it("waits for availability before reach, but not before collection covers or estimates", async () => {
    const availability = deferred<Map<string, { ebooks: { ebookId: string }[] }>>();
    reads.availability.mockReturnValue(availability.promise);
    const pending = loadBookPageData(work);
    await tick();
    expect(getCollectionCoverPreviews).toHaveBeenCalledOnce();
    expect(reads.estimates).toHaveBeenCalledOnce();
    expect(reads.reach).not.toHaveBeenCalled();
    availability.resolve(new Map([["book", { ebooks: [{ ebookId: "ebook" }] }]]));
    await pending;
    expect(reads.reach).toHaveBeenCalledWith(["ebook"]);
  });

  it.each([false, true])("preserves the prediction gate and finished-reading guard (gate %s)", async (gate) => {
    reads.gate.mockResolvedValue(gate);
    if (gate) reads.readings.mockResolvedValue([{ reading: { id: "finished", status: "finished" } }]);
    expect((await loadBookPageData(work)).predictionContext).toBeNull();
    expect(reads.prediction).not.toHaveBeenCalled();
  });

  it("retains linked books' reading availability and excludes linked non-books", async () => {
    const links = [
      { other: { id: "linked-book", kind: "book" } },
      { other: { id: "linked-film", kind: "film" } },
      { other: { id: "linked-book", kind: "book" } },
    ];
    const digital = new Map([["linked-book", { read: { href: "/reader/linked-ebook" }, ebooks: [] }]]);
    reads.links.mockResolvedValue(links);
    reads.availability.mockResolvedValue(digital);
    const loaded = await loadBookPageData(work);
    expect(reads.availability).toHaveBeenCalledWith(["book", "linked-book"]);
    expect(loaded.links).toBe(links);
    expect(loaded.digital).toBe(digital);
    expect(loaded.digital.get("linked-book")?.read).toEqual({ href: "/reader/linked-ebook" });
  });
});
