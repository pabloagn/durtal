import { readerUuid } from "@/lib/reader/uuid";
import { z } from "zod";
import { packRecordSchema, type PackRecord } from "./pack-store";
import { PACK_IMPORT_LIMITS } from "./pack-limits";
import { LOOKUP_LIMITS } from "./policy";
import type { PackLookupEntry } from "./pack-runtime";

const responseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("result"),
    id: z.string(),
    entries: z
      .array(
        z.object({
          packId: z.uuid(),
          headword: z.string().max(4096),
          parts: z
            .array(
              z.object({
                type: z.string().regex(/^[mltyhgx]$/),
                text: z.string().max(1024 * 1024),
              }),
            )
            .max(32),
        }),
      )
      .max(200),
  }),
  z.object({
    type: z.literal("installed"),
    id: z.string(),
    record: packRecordSchema,
  }),
  z.object({ type: z.literal("removed"), id: z.string() }),
  z.object({
    type: z.literal("inspected"),
    id: z.string(),
    metadata: z.object({
      name: z.string().min(1).max(500),
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .nullable(),
      wordCount: z.number().int().min(0).max(5_000_000),
      dictzip: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("packs"),
    id: z.string(),
    records: z.array(packRecordSchema).max(32),
  }),
  z.object({
    type: z.literal("error"),
    id: z.string(),
    name: z.string().max(100),
    message: z.string().max(500),
  }),
]);
type WorkerResponse = z.infer<typeof responseSchema>;

export class LookupPacksClient {
  private worker: Worker | null = null;
  private records: PackRecord[] | null = null;
  private pending = new Map<
    string,
    {
      resolve: (value: WorkerResponse) => void;
      reject: (reason: unknown) => void;
      dispose: () => void;
    }
  >();
  private canceled = new Map<string, ReturnType<typeof setTimeout>>();

  private start(): Worker {
    if (this.worker) return this.worker;
    if (
      !isSecureContext ||
      !navigator.storage?.getDirectory ||
      typeof Worker === "undefined"
    )
      throw new Error(
        "Offline dictionaries need Durtal's secure (https) address",
      );
    const worker = new Worker(
      new URL("./stardict.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const parsed = responseSchema.safeParse(event.data);
      if (!parsed.success) {
        this.close(
          new Error("The dictionary worker returned an invalid result"),
        );
        return;
      }
      const reply = parsed.data,
        canceled = this.canceled.get(reply.id);
      if (this.canceled.has(reply.id)) {
        clearTimeout(canceled!);
        this.canceled.delete(reply.id);
        return;
      }
      const request = this.pending.get(reply.id);
      if (!request) return;
      this.pending.delete(reply.id);
      request.dispose();
      if (reply.type === "error") {
        const error = new Error(reply.message);
        error.name = reply.name;
        request.reject(error);
      } else request.resolve(reply);
    };
    worker.onerror = () =>
      this.close(new Error("The dictionary worker could not run"));
    worker.onmessageerror = () =>
      this.close(
        new Error("The dictionary worker could not read this request"),
      );
    this.worker = worker;
    return worker;
  }

  private request(
    input: object,
    timeout: number,
    parent?: AbortSignal,
  ): Promise<WorkerResponse> {
    parent?.throwIfAborted();
    const worker = this.start(),
      id = readerUuid();
    if (this.pending.size >= 32)
      throw new Error("Too many dictionary operations are waiting");
    return new Promise((resolve, reject) => {
      const cancel = (reason: unknown) => {
        const item = this.pending.get(id);
        if (!item) return;
        this.pending.delete(id);
        item.dispose();
        reject(reason);
        worker.postMessage({ type: "cancel", id });
        // A crashed or blocked native operation cannot retain a worker indefinitely.
        this.canceled.set(
          id,
          setTimeout(
            () =>
              this.close(
                new Error("The dictionary worker did not finish canceling"),
              ),
            3000,
          ),
        );
      };
      const abort = () => cancel(parent?.reason);
      const timer = setTimeout(
        () =>
          cancel(
            new DOMException(
              "The dictionary operation took too long",
              "TimeoutError",
            ),
          ),
        timeout,
      );
      parent?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timer);
          parent?.removeEventListener("abort", abort);
        },
      });
      try {
        worker.postMessage({ ...input, id });
      } catch (error) {
        this.pending.get(id)!.dispose();
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async list(signal?: AbortSignal): Promise<PackRecord[]> {
    const result = await this.request(
      { type: "list" },
      LOOKUP_LIMITS.lookupTimeoutMs,
      signal,
    );
    if (result.type !== "packs")
      throw new Error("The dictionary worker returned the wrong result");
    this.records = result.records;
    return result.records;
  }
  async inspect(files: readonly File[], signal?: AbortSignal) {
    const result = await this.request(
      { type: "inspect", files },
      LOOKUP_LIMITS.lookupTimeoutMs,
      signal,
    );
    if (result.type !== "inspected")
      throw new Error("The dictionary worker returned the wrong result");
    return result.metadata;
  }
  async install(
    files: readonly File[],
    language: string,
    signal?: AbortSignal,
  ) {
    if (!isSecureContext || !navigator.storage?.getDirectory)
      throw new Error(
        "Offline dictionaries need Durtal's secure (https) address",
      );
    if (!this.records) await this.list(signal);
    // Called from the user's Add dictionary action after listing packs. This is the actual native answer.
    const persisted =
      this.records?.length === 0
        ? await navigator.storage.persist().catch(() => false)
        : await navigator.storage.persisted().catch(() => false);
    signal?.throwIfAborted();
    const result = await this.request(
      { type: "install", files, language },
      PACK_IMPORT_LIMITS.importTimeoutMs + 5000,
      signal,
    );
    if (result.type !== "installed")
      throw new Error("The dictionary worker returned the wrong result");
    this.records = [...(this.records ?? []), result.record];
    return { record: result.record, persisted };
  }
  async remove(packId: string, signal?: AbortSignal) {
    const result = await this.request(
      { type: "remove", packId },
      LOOKUP_LIMITS.lookupTimeoutMs,
      signal,
    );
    if (result.type !== "removed")
      throw new Error("The dictionary worker returned the wrong result");
    this.records =
      this.records?.filter((record) => record.id !== packId) ?? null;
  }
  async lookup(
    packIds: readonly string[],
    words: readonly string[],
    signal?: AbortSignal,
  ): Promise<PackLookupEntry[]> {
    const result = await this.request(
      { type: "lookup", packIds, words },
      LOOKUP_LIMITS.lookupTimeoutMs,
      signal,
    );
    if (result.type !== "result")
      throw new Error("The dictionary worker returned the wrong result");
    return result.entries;
  }
  close(
    reason: unknown = new DOMException(
      "Dictionary worker closed",
      "AbortError",
    ),
  ) {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.dispose();
      pending.reject(reason);
    }
    this.pending.clear();
    for (const timer of this.canceled.values()) clearTimeout(timer);
    this.canceled.clear();
  }
}
