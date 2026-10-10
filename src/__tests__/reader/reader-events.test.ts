import { describe, expect, it, vi } from "vitest";
import { createReaderEventBus, type ReaderEvents } from "@/lib/reader/events";
import { place } from "./fixtures/places";
function setup() {
  let clock = 1000,
    hidden = false,
    sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const tasks: (() => void)[] = [];
  const bus = createReaderEventBus({
    frame: (fn) => {
      frames.set(++sequence, fn);
      return sequence;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    microtask: (fn) => {
      tasks.push(fn);
    },
    now: () => clock,
    hidden: () => hidden,
  });
  return {
    bus,
    frame: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(clock));
    },
    tasks: () => {
      tasks.splice(0).forEach((fn) => fn());
    },
    clock: (value: number) => {
      clock = value;
    },
    hidden: (value: boolean) => {
      hidden = value;
    },
  };
}
const location = (
  kind: "turn" | "jump",
  fraction = 0.456789,
  atEnd = false,
) => ({
  kind,
  chapter: "Chapter",
  fileId: "epub",
  locator: { ...place().locator, totalProgression: fraction },
  atEnd,
});
describe("reader event bus", () => {
  it("dispatches only after a frame and microtask, isolates a throwing handler", () => {
    const s = setup(),
      received = vi.fn();
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    s.bus.on("location", () => {
      throw new Error("broken plugin");
    });
    s.bus.on("location", received);
    s.bus.location(location("turn"));
    expect(received).not.toHaveBeenCalled();
    s.frame();
    expect(received).not.toHaveBeenCalled();
    s.tasks();
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "jump", percent: 45.68 }),
    );
  });
  it("preserves turn/jump after opening, for all input and navigation origins", () => {
    const s = setup(),
      received = vi.fn();
    s.bus.on("location", received);
    s.bus.location(location("turn", 0.1));
    for (const [index, kind] of [
      "turn",
      "turn",
      "turn",
      "turn",
      "jump",
      "jump",
      "jump",
      "jump",
      "jump",
      "jump",
    ].entries())
      s.bus.location(
        location(kind as ReaderEvents["location"]["kind"], 0.2 + index / 100),
      );
    s.frame();
    s.tasks();
    expect(received.mock.calls.map(([event]) => event.kind)).toEqual([
      "jump",
      "turn",
      "turn",
      "turn",
      "turn",
      "jump",
      "jump",
      "jump",
      "jump",
      "jump",
      "jump",
    ]);
  });
  it("throttles activity separately by kind and never delivers hidden activity", () => {
    const s = setup(),
      received = vi.fn();
    s.bus.on("activity", received);
    s.bus.activity("turn");
    s.bus.activity("turn");
    s.bus.activity("key");
    s.frame();
    s.tasks();
    expect(received).toHaveBeenCalledTimes(2);
    s.clock(1999);
    s.bus.activity("turn");
    s.clock(2000);
    s.bus.activity("turn");
    s.hidden(true);
    s.frame();
    s.tasks();
    s.bus.activity("pointer");
    expect(received).toHaveBeenCalledTimes(2);
  });
  it("uses actual end visibility, rearms only below 98%, and deduplicates relocates", () => {
    const s = setup(),
      end = vi.fn(),
      moved = vi.fn();
    s.bus.on("end", end);
    s.bus.on("location", moved);
    s.bus.location(location("turn", 0.99, false));
    s.frame();
    s.tasks();
    expect(end).not.toHaveBeenCalled();
    s.bus.location(location("turn", 0.99, true));
    s.bus.location(location("turn", 0.985));
    s.bus.location(location("turn", 1, true));
    s.frame();
    s.tasks();
    expect(end).toHaveBeenCalledTimes(1);
    s.bus.location(location("turn", 0.979));
    s.bus.location(location("turn", 1, true));
    s.bus.location(location("turn", 1, true));
    s.frame();
    s.tasks();
    expect(end).toHaveBeenCalledTimes(2);
    expect(moved).toHaveBeenCalledTimes(5);
  });
  it("cancels callbacks on close, including microtasks from an old lifecycle", () => {
    const s = setup(),
      received = vi.fn();
    s.bus.on("selection", received);
    s.bus.emit("selection", null);
    s.frame();
    s.bus.destroy();
    s.bus.start();
    s.bus.on("selection", received);
    s.tasks();
    expect(received).not.toHaveBeenCalled();
  });
});

it("a one-page book whose first locator is below 98% still emits end once", () => {
  const s = setup(),
    end = vi.fn();
  s.bus.on("end", end);
  s.bus.location(location("jump", 0, true));
  s.bus.location(location("turn", 0, true));
  s.frame();
  s.tasks();
  expect(end).toHaveBeenCalledOnce();
});
