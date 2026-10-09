import { describe, expect, it, vi } from "vitest";
import {
  loadReaderPlugins,
  readerPlugins,
  type ReaderPlugin,
} from "@/app/reader/[ebookId]/plugins";
describe("reader plugin server boundary", () => {
  it("keeps production empty and isolates failed/non-serialisable loads", async () => {
    expect(readerPlugins).toEqual([]);
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
