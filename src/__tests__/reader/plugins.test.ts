import { describe, expect, it, vi } from "vitest";
// Next normally supplies the server boundary. This unit tests registry/loading,
// so fixture the tracker feature and its request loader at their module boundary.
vi.mock("@/lib/reading/reader", () => ({ loadReaderTracking: vi.fn() }));
vi.mock("@/components/reading/reader-tracking", () => ({
  ReaderTracking: () => null, ReaderTrackingFailure: () => null,
}));
import { READER_TRACKING_CONTROLLER_ID } from "@/lib/reading/reader-controller";
import {
  loadReaderPlugins,
  getRequiredReaderControllerIds,
  readerPlugins,
  type ReaderPlugin,
} from "@/app/reader/[ebookId]/plugins";
describe("reader plugin server boundary", () => {
  it("keeps the configured production tracker and isolates failed/non-serialisable loads", async () => {
    expect(readerPlugins.map(({ id, controller }) => ({ id, controller }))).toEqual([
      { id: READER_TRACKING_CONTROLLER_ID, controller: true },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Component = () => null;
    const good = vi.fn(async () => ({ title: "ready" }));
    const plugins: ReaderPlugin[] = [
      {
        id: "bad",
        Component,
        load: async () => {
          throw new Error("offline");
        },
      },
      { id: "good", Component, load: good },
      { id: "local", Component },
      { id: "invalid", Component, load: async () => ({ handler: () => {} }) },
    ];
    const result = await loadReaderPlugins({ ebookId: "book" }, plugins);
    expect(result.map((plugin) => plugin.id)).toEqual(["good", "local"]);
    expect(good).toHaveBeenCalledWith({ ebookId: "book" });
    vi.restoreAllMocks();
  });
  it("starts loaders in parallel and preserves registry order", async () => {
    const starts: number[] = [],
      finish: (() => void)[] = [];
    const load = (index: number) => async () => {
      starts.push(index);
      await new Promise<void>((resolve) => {
        finish[index] = resolve;
      });
      return index;
    };
    const result = loadReaderPlugins({ ebookId: "book" }, [
      { id: "one", Component: () => null, load: load(0) },
      { id: "two", Component: () => null, load: load(1) },
    ]);
    expect(starts).toEqual([0, 1]);
    finish[1]();
    finish[0]();
    expect((await result).map((plugin) => plugin.id)).toEqual(["one", "two"]);
  });
});


describe("required controller plugin configuration", () => {
  const Component = () => null;
  const Failure = () => null;
  it("retains configured IDs and failure descriptors across failed and nonserialisable loaders", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugins: ReaderPlugin[] = [
      { id: "failed", controller: true, Component, Failure, load: async () => { throw new Error("unavailable"); } },
      { id: "invalid", controller: true, Component, Failure, load: async () => ({ handler: () => {} }) },
    ];
    expect(getRequiredReaderControllerIds(plugins)).toEqual(["failed", "invalid"]);
    const results = await loadReaderPlugins({ ebookId: "book" }, plugins);
    expect(results.map(({ id }) => id)).toEqual(["failed", "invalid"]);
    for (const result of results) {
      expect(result).toMatchObject({ controller: true, node: null, failure: "reader_controller_load_failed" });
      expect(result.failureNode?.props.id).toBe(result.id);
    }
    error.mockRestore();
  });
  it("keeps the eager failure descriptor without declaring successful tracking data", async () => {
    const result = await loadReaderPlugins({ ebookId: "book" }, [
      { id: "configured", controller: true, Component, Failure, load: async () => ({ status: "disabled" }) },
    ]);
    expect(result[0].controller).toBe(true);
    expect(result[0].failure).toBeUndefined();
    expect(result[0].failureNode?.props.id).toBe("configured");
  });
  it("rejects duplicate IDs and missing feature-owned failure renderers before loader work", async () => {
    const load = vi.fn(async () => null);
    await expect(loadReaderPlugins({ ebookId: "book" }, [
      { id: "duplicate", Component, load }, { id: "duplicate", Component, load },
    ])).rejects.toThrow("unique");
    await expect(loadReaderPlugins({ ebookId: "book" }, [
      { id: "missing-failure", controller: true, Component, load },
    ])).rejects.toThrow("failure surface");
    expect(load).not.toHaveBeenCalled();
  });
  it("requires the configured tracker controller in the production registry", () => {
    expect(getRequiredReaderControllerIds()).toEqual([READER_TRACKING_CONTROLLER_ID]);
    expect(readerPlugins.map(({ id, controller }) => ({ id, controller }))).toEqual([
      { id: READER_TRACKING_CONTROLLER_ID, controller: true },
    ]);
  });
});
