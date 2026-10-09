import type {
  DurtalLocator,
  EngineEvents,
  GoToTarget,
  ReaderEngine,
} from "./engine";
import { ReaderHistory } from "./history";

export type JumpSource =
  | "contents"
  | "goto"
  | "scrubber"
  | "chapter"
  | "edge"
  | "history"
  | "resume"
  | "search"
  | "link"
  | "footnote"
  | "bookmark"
  | "annotation";
type Relocation = EngineEvents["relocate"];
type Turn = "next" | "prev" | "goLeft" | "goRight";
type Command = {
  id: number;
  abort: AbortController;
  source: JumpSource;
  target?: GoToTarget;
  direction?: -1 | 1;
  step?: "nextSection" | "prevSection";
  turn?: Turn;
  originMark?: string;
  resolve: (value: DurtalLocator | null) => void;
  reject: (reason: unknown) => void;
};
export const sameLocation = (
  a: DurtalLocator | null,
  b: DurtalLocator | null,
) =>
  !!a &&
  !!b &&
  a.fileHash === b.fileHash &&
  a.sectionIndex === b.sectionIndex &&
  (a.cfi && b.cfi
    ? a.cfi === b.cfi
    : a.pdf && b.pdf
      ? a.pdf.page === b.pdf.page
      : a.href === b.href && Math.abs(a.progression - b.progression) < 1e-6);

/** A session owns its engine, commands, history, and publication. No global navigation singleton. */
export function createReaderNavigation(options: {
  engine: ReaderEngine;
  commit: (relocation: Relocation) => void;
  changed?: () => void;
  interrupt?: () => void;
  fatal?: (error: unknown) => void;
  paint?: (signal: AbortSignal) => Promise<void>;
}) {
  const { engine } = options;
  const history = new ReaderHistory();
  let sequence = 0;
  let active: Command | null = null;
  let pending: Command[] = [];
  let latest: Relocation | null = null;
  let committed: Relocation | null = null;
  let destroyed = false;
  let recovering = false;
  let recovery: AbortController | null = null;
  let passive: AbortController | null = null;
  const paint = options.paint ?? painted;
  const changed = () => {
    if (!destroyed) options.changed?.();
  };
  const publish = (relocation: Relocation) => {
    committed = relocation;
    options.commit(relocation);
    changed();
  };
  const settlePending = () => {
    for (const command of pending) {
      command.abort.abort();
      command.resolve(null);
    }
    pending = [];
  };
  async function recover(origin: Relocation, command: Command) {
    if (destroyed || sameLocation(engine.currentLocator(), origin.locator))
      return;
    recovering = true;
    const operation = new AbortController();
    recovery = operation;
    // The movement that was cancelled must settle before recovery or a replacement begins.
    try {
      await engine.goTo(origin.locator, {
        id: command.id,
        signal: operation.signal,
      });
      if (!destroyed) await paint(operation.signal);
    } finally {
      recovering = false;
      if (recovery === operation) recovery = null;
    }
    if (!destroyed) committed = origin;
  }
  async function run(command: Command) {
    active = command;
    changed();
    latest = null;
    const origin = committed;
    try {
      if (destroyed || !origin) {
        command.resolve(null);
        return;
      }
      const owner = { id: command.id, signal: command.abort.signal };
      if (command.turn) await engine[command.turn](owner);
      else if (command.step) await engine[command.step](owner);
      else await engine.goTo(command.target!, owner);
      if (destroyed) {
        command.resolve(null);
        return;
      }
      if (command.abort.signal.aborted) {
        await recover(origin, command);
        command.resolve(null);
        return;
      }
      let destination = latest as Relocation | null;
      if (
        command.turn &&
        !destination &&
        sameLocation(engine.currentLocator(), origin.locator)
      ) {
        command.resolve(null);
        return;
      }
      if (!destination || destination.navigationId !== command.id)
        throw new Error("The destination did not finish loading.");
      do {
        destination = (latest as Relocation | null) ?? destination;
        await paint(command.abort.signal);
      } while (
        !destroyed &&
        !command.abort.signal.aborted &&
        latest !== destination
      );
      if (destroyed || command.abort.signal.aborted) {
        if (!destroyed) await recover(origin, command);
        command.resolve(null);
        return;
      }
      if (sameLocation(origin.locator, destination.locator)) {
        command.resolve(null);
        return;
      }
      if (command.turn) history.turn(destination.locator);
      else if (command.direction)
        history.commit(command.direction, destination.locator);
      else
        history.push(
          origin.locator,
          destination.locator,
          command.source,
          command.originMark ?? origin.originMark,
        );
      publish({
        ...destination,
        origin: "human",
        reason: command.turn ? "turn" : "jump",
      });
      if (command.direction === -1 && history.current?.originMark)
        engine.setDecorations("history", [
          { cfi: history.current.originMark, color: "link" },
        ]);
      command.resolve(destination.locator);
    } catch (error) {
      if (!destroyed && origin) {
        try {
          await recover(origin, command);
        } catch (recoveryError) {
          if (destroyed) {
            command.resolve(null);
            return;
          }
          destroyed = true;
          settlePending();
          options.fatal?.(recoveryError);
          command.reject(recoveryError);
          return;
        }
      }
      if (command.abort.signal.aborted || destroyed) command.resolve(null);
      else command.reject(error);
    } finally {
      recovering = false;
      if (active === command) active = null;
      changed();
      const next = pending.shift();
      if (next && !destroyed) void run(next);
      else next?.resolve(null);
    }
  }
  function refreshUnowned(relocation: Relocation, layout: boolean) {
    passive?.abort();
    const operation = new AbortController();
    passive = operation;
    if (layout) options.interrupt?.();
    void (async () => {
      try {
        await paint(operation.signal);
        if (destroyed || operation.signal.aborted || active || !committed)
          return;
        const destination: Relocation = layout
          ? {
              ...relocation,
              reason: "layout",
              origin: "layout",
              activity: undefined,
              atEnd: false,
              locator: {
                ...relocation.locator,
                totalProgression: committed.locator.totalProgression,
                position: committed.locator.position,
              },
            }
          : { ...relocation, origin: "human" };
        if (sameLocation(committed.locator, destination.locator)) return;
        if (layout) history.reanchor(destination.locator);
        else history.turn(destination.locator);
        publish(destination);
      } catch (error) {
        if (!operation.signal.aborted && !destroyed) options.fatal?.(error);
      } finally {
        if (passive === operation) passive = null;
      }
    })();
  }
  function enqueue(
    input: Omit<Command, "id" | "abort" | "resolve" | "reject">,
  ) {
    if (destroyed || !committed) return Promise.resolve(null);
    passive?.abort();
    passive = null;
    if (!input.turn || (active && !active.turn)) options.interrupt?.();
    return new Promise<DurtalLocator | null>((resolve, reject) => {
      const command = {
        ...input,
        id: ++sequence,
        abort: new AbortController(),
        resolve,
        reject,
      };
      if (active) {
        // Ordinary turns are deliberate input. Queue each until the renderer's
        // transition and paint settle instead of dropping keys during its lock.
        if (input.turn && active.turn && !active.abort.signal.aborted) {
          pending.push(command);
          return;
        }
        if (!input.turn) settlePending();
        // Recovery owns a different signal; replacing a queued request must not cancel recovery.
        if (!recovering) active.abort.abort();
        pending.push(command);
      } else void run(command);
    });
  }
  return {
    history,
    get current() {
      return committed;
    },
    get busy() {
      return !!active;
    },
    start(relocation: Relocation) {
      committed = relocation;
      history.start(relocation.locator);
      changed();
    },
    relocate(relocation: Relocation) {
      if (destroyed) return;
      const origin =
        relocation.origin ??
        (relocation.reason === "turn" || relocation.navigationId !== undefined
          ? "human"
          : "layout");
      if (active) {
        if (origin !== "human") options.interrupt?.();
        if (
          origin === "human" &&
          relocation.navigationId === active.id &&
          relocation.reason === (active.turn ? "turn" : "jump")
        )
          latest = relocation;
        return;
      }
      if (!committed) return;
      // Late owned arrivals never become independent reading movements.
      if (relocation.navigationId !== undefined) return;
      // Speech must enter through a future owned automatic-navigation operation.
      if (origin === "speech") {
        passive?.abort();
        passive = null;
        options.interrupt?.();
        return;
      }
      if (origin === "layout" || relocation.reason === "layout")
        refreshUnowned(relocation, true);
      else if (relocation.reason === "turn") refreshUnowned(relocation, false);
    },
    navigate(
      target: GoToTarget,
      input: { source: JumpSource; originMark?: string },
    ) {
      if ("v" in target && sameLocation(committed?.locator ?? null, target))
        return Promise.resolve(null);
      return enqueue({ target, ...input });
    },
    chapterStep(direction: -1 | 1) {
      return enqueue({
        source: "chapter",
        step: direction > 0 ? "nextSection" : "prevSection",
      });
    },
    historyStep(direction: -1 | 1) {
      const entry = direction < 0 ? history.back : history.forward;
      return entry
        ? enqueue({ source: "history", direction, target: entry.locator })
        : Promise.resolve(null);
    },
    turn(turn: Turn) {
      return enqueue({ source: "edge", turn });
    },
    cancel() {
      if (!recovering) active?.abort.abort();
      settlePending();
      passive?.abort();
      passive = null;
      options.interrupt?.();
    },
    destroy() {
      destroyed = true;
      active?.abort.abort();
      active?.resolve(null);
      active = null;
      recovery?.abort();
      recovery = null;
      passive?.abort();
      passive = null;
      settlePending();
    },
  };
}
export type ReaderNavigation = ReturnType<typeof createReaderNavigation>;
/** Explicit session ownership lets future panels use the same jump entry point. */
export function navigate(
  target: GoToTarget,
  input: { source: JumpSource; originMark?: string },
  session: ReaderNavigation,
) {
  return session.navigate(target, input);
}

/** Paint barriers are cancellable, including while a tab is hidden or a session closes. */
export function painted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0;
    let count = 0;
    const abort = () => {
      cancelAnimationFrame(frame);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    const next = () => {
      if (++count === 2) {
        signal.removeEventListener("abort", abort);
        resolve();
      } else frame = requestAnimationFrame(next);
    };
    frame = requestAnimationFrame(next);
  });
}
