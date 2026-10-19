import { readerSessionSchema } from "@/lib/validations/reader-tracking";
import type { ReaderSittingWire } from "./reader-controller";

/** Where a saved sitting that no longer reads is kept, per device and e-book */
export const READER_SITTING_RECOVERY_PREFIX = "durtal:tracker-recovery:v1:";

/** Separate from the reader's positions/annotation outbox: these are tracker receipts.
 * A beacon's boolean is never an acknowledgement. The exact cumulative snapshot
 * stays on disk until a decoded server acknowledgement covers its revision.
 */
export function createReaderSittingQueue(options: {
  ebookId: string; deviceId: string; timeZone: string;
  storage: Storage;
  fetch?: typeof fetch;
  beacon?: (url: string, data: Blob) => boolean;
  failed(error: unknown): void;
  retired(sitting: ReaderSittingWire): void;
  acknowledged?(sitting: ReaderSittingWire): void;
  /** Saved sittings that could not be read, kept under the recovery prefix */
  setAside?(count: number): void;
}) {
  const prefix = `durtal:tracker:v1:${options.deviceId}:${options.ebookId}:`;
  const recovery = `${READER_SITTING_RECOVERY_PREFIX}${options.deviceId}:${options.ebookId}:`;
  const url = `/api/reader/${options.ebookId}/session?device=${encodeURIComponent(options.deviceId)}`;
  const pending = new Map<string, ReaderSittingWire>();
  const doFetch = options.fetch ?? fetch;
  let flight: Promise<void> | null = null;
  let disposed = false;
  const schema = readerSessionSchema(options.timeZone);
  const fields = new Set(Object.keys(schema.shape));
  const decode = (text: string): ReaderSittingWire => {
    const raw: unknown = JSON.parse(text);
    // A field a later release no longer sends is left out, not a reason to lose the sitting
    const known = raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => fields.has(key))) : raw;
    const parsed = schema.parse(known);
    return { ...parsed, startedAt: parsed.startedAt.toISOString(), endedAt: parsed.endedAt.toISOString() };
  };
  // One entry that can't be read moves to the recovery key, kept and never
  // silently erased; the rest load and send as usual (SLN-1231).
  const keys: string[] = [], kept: string[] = [];
  for (let n = 0; n < options.storage.length; n++) {
    const key = options.storage.key(n);
    if (key?.startsWith(prefix)) keys.push(key);
    else if (key?.startsWith(recovery)) kept.push(key);
  }
  let setAside = 0;
  for (const key of keys) {
    const text = options.storage.getItem(key);
    if (!text) continue;
    try {
      const item = decode(text);
      pending.set(item.sittingId, item);
    } catch {
      setAside++;
      try {
        options.storage.setItem(`${recovery}${key.slice(prefix.length)}`, text);
        options.storage.removeItem(key);
      } catch {
        // Full storage: the entry stays where it is, and is set aside again next time
      }
    }
  }
  if (setAside) options.setAside?.(setAside);
  // A sitting set aside by another release may read in this one: it goes back
  // in the queue. One that still doesn't read stays, and isn't counted again.
  for (const key of kept) {
    const text = options.storage.getItem(key);
    if (!text) continue;
    let item: ReaderSittingWire;
    try { item = decode(text); } catch { continue; }
    const current = pending.get(item.sittingId);
    try {
      if (!current || current.revision < item.revision) {
        options.storage.setItem(prefix + item.sittingId, text);
        pending.set(item.sittingId, item);
      }
      options.storage.removeItem(key);
    } catch {
      // Full storage: it stays set aside, and is tried again next time
    }
  }

  const storedRevision = (text: string) => { try { return decode(text).revision; } catch { return null; } };
  async function send() {
    for (const item of [...pending.values()]) {
      if (disposed) return;
      const response = await doFetch(url, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(item), keepalive: true });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
        throw new Error("Reading has not synced. The sitting is saved on this device.");
      const value: unknown = await response.json();
      if (!value || typeof value !== "object") throw new Error("Invalid sitting acknowledgement");
      const ack = value as { sittingId?: unknown; revision?: unknown; status?: unknown };
      if (ack.sittingId !== item.sittingId || !Number.isInteger(ack.revision) ||
        !["saved", "replayed", "retired"].includes(String(ack.status)) ||
        (ack.status !== "retired" && (ack.revision as number) < item.revision))
        throw new Error("Invalid sitting acknowledgement");
      const current = pending.get(item.sittingId);
      if (current && (ack.status === "retired" || current.revision <= (ack.revision as number))) {
        // Read before deletion: a newer revision written by this tab must survive.
        const stored = options.storage.getItem(prefix + item.sittingId);
        if (stored && storedRevision(stored) === current.revision) options.storage.removeItem(prefix + item.sittingId);
        pending.delete(item.sittingId);
      }
      if (ack.status === "retired") options.retired(item);
      else options.acknowledged?.(item);
    }
  }
  function flush() {
    if (disposed) return Promise.resolve();
    if (flight) return flight;
    flight = send().then(() => true, (error: unknown) => { options.failed(error); return false; }).then((ok) => {
      flight = null;
      if (ok && pending.size && !disposed) void flush();
    });
    return flight;
  }
  return {
    flush,
    push(item: Readonly<ReaderSittingWire>, beacon = false) {
      if (disposed) throw new Error("Reader sitting queue is closed");
      if (!pending.has(item.sittingId) && pending.size >= 64) throw new Error("Too many unsynced sittings. Reconnect before continuing tracking.");
      const previous = pending.get(item.sittingId);
      if (previous && previous.revision >= item.revision) return;
      options.storage.setItem(prefix + item.sittingId, JSON.stringify(item));
      pending.set(item.sittingId, { ...item });
      if (beacon && options.beacon) options.beacon(url, new Blob([JSON.stringify(item)], { type: "application/json" }));
      else void flush();
    },
    get pending() { return pending.size; },
    dispose() { disposed = true; },
  };
}
