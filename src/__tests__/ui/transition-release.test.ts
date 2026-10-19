// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement as h, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransitionRelease } from "@/components/shared/transition-release";

// SLN-1141: after a save, the page kept its old content for about 4 s, until
// the toast left or the pointer moved. Each finished request now makes one
// urgent update, which lets React try the waiting refresh again.

type Listener = (list: { getEntries: () => { initiatorType: string }[] }) => void;
const observers: { listener: Listener; types: string[]; connected: boolean }[] = [];

class FakeObserver {
  private record: (typeof observers)[number];
  constructor(listener: Listener) {
    this.record = { listener, types: [], connected: true };
    observers.push(this.record);
  }
  observe(options: { type: string }) {
    this.record.types.push(options.type);
  }
  disconnect() {
    this.record.connected = false;
  }
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = FakeObserver;
});

let root: Root;
let renders: number;
beforeEach(() => {
  observers.length = 0;
  renders = 0;
  root = createRoot(document.createElement("div"));
  act(() => root.render(h(Profiler, { id: "release", onRender: () => void renders++ }, h(TransitionRelease))));
});
afterEach(() => act(() => root.unmount()));

const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const finish = (...initiatorTypes: string[]) =>
  act(() => observers[0].listener({ getEntries: () => initiatorTypes.map((initiatorType) => ({ initiatorType })) }));

describe("TransitionRelease", () => {
  it("watches finished requests", () => {
    expect(observers).toHaveLength(1);
    expect(observers[0].types).toEqual(["resource"]);
  });

  it("makes one update when a request finishes", async () => {
    const before = renders;
    finish("fetch");
    await frame();
    expect(renders).toBe(before + 1);
  });

  it("makes one update for several requests in a frame", async () => {
    const before = renders;
    finish("fetch", "fetch");
    finish("fetch");
    await frame();
    expect(renders).toBe(before + 1);
  });

  it("ignores images, scripts and stylesheets", async () => {
    const before = renders;
    finish("img", "script", "link");
    await frame();
    expect(renders).toBe(before);
  });

  it("stops watching when it leaves", () => {
    act(() => root.unmount());
    expect(observers[0].connected).toBe(false);
    root = createRoot(document.createElement("div"));
  });

  it("runs on every catalogue page", () => {
    const layout = readFileSync(path.resolve(__dirname, "../../app/(catalogue)/layout.tsx"), "utf8");
    expect(layout).toMatch(/<TransitionRelease \/>/);
  });
});
