import { vi } from "vitest";
import type {
  DurtalLocator,
  EngineEvents,
  ReaderEngine,
} from "@/lib/reader/engine";
import { place } from "./places";
export function fakeEngine() {
  const handlers = new Map<keyof EngineEvents, Set<(payload: never) => void>>();
  let locator = place().locator;
  let selection: EngineEvents["selection"] = null;
  const emit = <K extends keyof EngineEvents>(
    name: K,
    payload: EngineEvents[K],
  ) => {
    if (name === "selection") selection = payload as EngineEvents["selection"];
    if (name === "relocate")
      locator = (payload as EngineEvents["relocate"]).locator;
    handlers.get(name)?.forEach((handler) => handler(payload as never));
  };
  const relocate = (at: DurtalLocator, reason: "turn" | "jump") =>
    emit("relocate", {
      locator: at,
      reason,
      chapter: at.tocLabel ?? "Chapter I",
      atEnd: false,
    });
  const engine = {
    on<K extends keyof EngineEvents>(
      name: K,
      handler: (payload: EngineEvents[K]) => void,
    ) {
      const set = handlers.get(name) ?? new Set();
      set.add(handler as (payload: never) => void);
      handlers.set(name, set);
      return () => {
        set.delete(handler as (payload: never) => void);
      };
    },
    open: vi.fn<ReaderEngine["open"]>(async (source, options) => {
      const at = options.at;
      locator =
        at && "v" in at
          ? at
          : {
              ...locator,
              fileHash: source.sha256,
              totalProgression: at?.fraction ?? 0,
            };
      emit("ready", {
        title: "Book",
        authors: [],
        language: "en",
        dir: "ltr",
        layout: "reflowable",
        toc: [],
        capabilities: {
          search: true,
          tts: true,
          spreads: true,
          scrolled: true,
        },
      });
      relocate(locator, "jump");
      return {
        resolved: at && "v" in at ? { status: "exact", locator } : null,
      };
    }),
    goTo: vi.fn<ReaderEngine["goTo"]>(async (target) => {
      const at =
        "v" in target
          ? target
          : {
              ...locator,
              totalProgression: "fraction" in target ? target.fraction : 0.8,
            };
      relocate(at, "jump");
    }),
    next: vi.fn(async () =>
      relocate(
        {
          ...locator,
          sectionIndex: locator.sectionIndex + 1,
          totalProgression: locator.totalProgression + 0.1,
        },
        "turn",
      ),
    ),
    prev: vi.fn(async () =>
      relocate(
        {
          ...locator,
          sectionIndex: locator.sectionIndex - 1,
          totalProgression: locator.totalProgression - 0.1,
        },
        "turn",
      ),
    ),
    goLeft: vi.fn(async (): Promise<void> => {
      await engine.prev();
    }),
    goRight: vi.fn(async (): Promise<void> => {
      await engine.next();
    }),
    currentLocator: () => locator,
    locatorFromSelection: () => selection?.locator ?? null,
    clearSelection: vi.fn(() => emit("selection", null)),
    setPresentation: vi.fn(),
    resolve: vi.fn<ReaderEngine["resolve"]>(async (at) => ({
      status: "exact",
      locator: at,
    })),
    destroy: vi.fn(),
  } satisfies ReaderEngine;
  return { engine, emit };
}
