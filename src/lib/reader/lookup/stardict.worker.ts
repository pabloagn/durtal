import { z } from "zod";
import { LookupPackRuntime } from "./pack-runtime";
import { LOOKUP_LIMITS } from "./policy";
import { operationSignal } from "./resources";

const identity = z.string().min(1).max(100);
const requestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("lookup"),
      id: identity,
      packIds: z.array(z.uuid()).max(32),
      words: z.array(z.string().min(1).max(4096)).min(1).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal("install"),
      id: identity,
      files: z.array(z.instanceof(File)).min(1).max(4),
      language: z.string().regex(/^[a-z]{2,3}$/),
    })
    .strict(),
  z
    .object({ type: z.literal("remove"), id: identity, packId: z.uuid() })
    .strict(),
  z
    .object({
      type: z.literal("inspect"),
      id: identity,
      files: z.array(z.instanceof(File)).min(1).max(4),
    })
    .strict(),
  z.object({ type: z.literal("list"), id: identity }).strict(),
  z.object({ type: z.literal("cancel"), id: identity }).strict(),
]);

// Structural declaration of the native dedicated worker channel, without conflicting DOM globals.
const scope = globalThis as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: unknown): void;
};
const runtime = new LookupPackRuntime(),
  controllers = new Map<string, AbortController>();
let queue = Promise.resolve();
let active: string | null = null;

scope.addEventListener("message", (event) => {
  const parsed = requestSchema.safeParse(event.data);
  if (!parsed.success) {
    // Malformed messages never acquire OPFS/IDB or echo arbitrary untrusted payloads.
    const id =
      event.data && typeof event.data === "object" && "id" in event.data
        ? identity.safeParse(event.data.id)
        : null;
    if (id?.success)
      scope.postMessage({
        type: "error",
        id: id.data,
        name: "Error",
        message: "Invalid dictionary request",
      });
    return;
  }
  const request = parsed.data;
  if (request.type === "cancel") {
    controllers
      .get(request.id)
      ?.abort(new DOMException("Dictionary operation canceled", "AbortError"));
    if (active !== request.id && controllers.has(request.id))
      scope.postMessage({
        type: "error",
        id: request.id,
        name: "AbortError",
        message: "Dictionary operation canceled",
      });
    return;
  }
  if (controllers.has(request.id) || controllers.size >= 32) {
    scope.postMessage({
      type: "error",
      id: request.id,
      name: "Error",
      message: "Too many dictionary operations are waiting",
    });
    return;
  }
  const controller = new AbortController();
  controllers.set(request.id, controller);
  // Serialize work so installs, index arrays and inflaters cannot multiply the worker's memory budget.
  queue = queue
    .then(async () => {
      active = request.id;
      const lifetime = operationSignal(
        controller.signal,
        request.type === "install" ? 125000 : LOOKUP_LIMITS.lookupTimeoutMs,
      );
      try {
        lifetime.signal.throwIfAborted();
        switch (request.type) {
          case "inspect":
            scope.postMessage({
              type: "inspected",
              id: request.id,
              metadata: await runtime.inspect(request.files, lifetime.signal),
            });
            break;
          case "lookup":
            scope.postMessage({
              type: "result",
              id: request.id,
              entries: await runtime.lookup(
                request.packIds,
                request.words,
                lifetime.signal,
              ),
            });
            break;
          case "install":
            scope.postMessage({
              type: "installed",
              id: request.id,
              record: await runtime.install(
                request.files,
                request.language,
                lifetime.signal,
              ),
            });
            break;
          case "remove":
            await runtime.remove(request.packId, lifetime.signal);
            scope.postMessage({ type: "removed", id: request.id });
            break;
          case "list":
            scope.postMessage({
              type: "packs",
              id: request.id,
              records: await runtime.list(lifetime.signal),
            });
            break;
        }
      } catch (error) {
        const reason =
          error instanceof Error
            ? error
            : new Error("This dictionary operation could not finish");
        scope.postMessage({
          type: "error",
          id: request.id,
          name: reason.name,
          message: reason.message.slice(0, 500),
        });
      } finally {
        lifetime.dispose();
        controllers.delete(request.id);
        active = null;
      }
    })
    .catch(() => {});
});
