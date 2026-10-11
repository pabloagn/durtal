import { describe, expect, it, vi } from "vitest";
import { createReaderEventBus } from "@/lib/reader/events";
import { createAnnotationDeleteHooks } from "@/lib/reader/annotation-deletion";
import { annotation } from "./fixtures/annotation";

function delivery() {
  const frames = new Map<number, FrameRequestCallback>();
  const tasks: (() => void)[] = [];
  let id = 0;
  const bus = createReaderEventBus({
    frame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelFrame: (key) => {
      frames.delete(key);
    },
    microtask: (fn) => {
      tasks.push(fn);
    },
    now: () => 42,
    hidden: () => false,
  });
  return {
    bus,
    frame: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(0));
    },
    tasks: () => {
      const pending = tasks.splice(0);
      pending.forEach((fn) => fn());
    },
  };
}

describe("annotation bridge delivery", () => {
  it("runs the default menu only after every handler receives the painted event", () => {
    const d = delivery(),
      seen: string[] = [];
    d.bus.on("annotation-activated", (event) => {
      seen.push(event.annotationId);
      expect(event.at).toBe(42);
    });
    d.bus.on("annotation-activated", () => {
      seen.push("second");
    });
    d.bus.annotationActivated(annotation(), () => {
      seen.push("menu");
    });
    expect(seen).toEqual([]);
    d.frame();
    expect(seen).toEqual([]);
    d.tasks();
    expect(seen).toEqual([annotation().id, "second", "menu"]);
  });
  it("lets a quote plugin suppress the menu in deferred dispatch", () => {
    const d = delivery(),
      menu = vi.fn();
    d.bus.on("annotation-activated", (event) => event.preventDefault());
    d.bus.annotationActivated(annotation({ style: "quote" }), menu);
    d.frame();
    d.tasks();
    expect(menu).not.toHaveBeenCalled();
  });
  it("drops a stale activation and its default after teardown, including a queued microtask", () => {
    const d = delivery(),
      menu = vi.fn();
    d.bus.annotationActivated(annotation(), menu);
    d.frame();
    d.bus.destroy();
    d.bus.start();
    d.tasks();
    expect(menu).not.toHaveBeenCalled();
  });
});

describe("prepared delete hooks", () => {
  const effect = {
    action: "keep-quote" as const,
    noteId: "note",
    expectedNoteVersion: "opaque μ",
    expectedBindingVersion: "binding",
  };
  it("awaits confirmation before returning one composed effect and never invokes a writer", async () => {
    const hooks = createAnnotationDeleteHooks();
    let release!: () => void;
    const confirmation = new Promise<void>((resolve) => {
      release = resolve;
    });
    hooks.register(async () => {
      await confirmation;
      return { status: "proceed", effect };
    });
    const later = vi.fn(async () => true);
    hooks.register(later);
    const result = hooks.prepare(
      annotation({ style: "quote" }),
      new AbortController().signal,
    );
    expect(later).not.toHaveBeenCalled();
    release();
    expect(await result).toEqual({ status: "proceed", effect });
    expect(later).toHaveBeenCalledOnce();
  });
  it("cancels boolean veto, canceled effect, absent quote binding and abort while a hook is pending", async () => {
    for (const response of [false, { status: "cancel" as const }]) {
      const hooks = createAnnotationDeleteHooks();
      hooks.register(async () => response);
      expect(
        await hooks.prepare(annotation(), new AbortController().signal),
      ).toEqual({ status: "cancel" });
    }
    const hooks = createAnnotationDeleteHooks();
    expect(
      await hooks.prepare(
        annotation({ style: "quote" }),
        new AbortController().signal,
      ),
    ).toEqual({ status: "cancel" });
    const abort = new AbortController();
    hooks.register(async () => {
      abort.abort();
      return { status: "proceed", effect };
    });
    expect(
      await hooks.prepare(annotation({ style: "quote" }), abort.signal),
    ).toEqual({ status: "cancel" });
  });
  it("unregisters hooks and refuses inconsistent prepared effects", async () => {
    const hooks = createAnnotationDeleteHooks();
    const remove = hooks.register(async () => false);
    remove();
    expect(
      await hooks.prepare(annotation(), new AbortController().signal),
    ).toEqual({ status: "proceed", effect: { action: "none" } });
    hooks.register(async () => ({ status: "proceed", effect }));
    hooks.register(async () => ({
      status: "proceed",
      effect: { ...effect, action: "delete-quote" },
    }));
    await expect(
      hooks.prepare(
        annotation({ style: "quote" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("conflicting");
  });
});
