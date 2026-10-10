/** Pure controls shared by the reviewed harness and bounded local guard tests. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export function readPrivateTarget(envDir: string, expectedHash: string) {
  const base = dotenv.parse(readFileSync(path.join(envDir, ".env")));
  const local = dotenv.parse(readFileSync(path.join(envDir, ".env.local")));
  const url = local.DATABASE_URL ?? base.DATABASE_URL;
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  if (!url || hash(url) !== expectedHash)
    throw new Error("Original pooled URL changed");
  const endpoint = new URL(url);
  if (
    !endpoint.hostname.endsWith(".neon.tech") ||
    !endpoint.hostname.includes("-pooler.") ||
    !["postgres:", "postgresql:"].includes(endpoint.protocol) ||
    !["require", "verify-full"].includes(
      endpoint.searchParams.get("sslmode") ?? "",
    )
  )
    throw new Error("Original TLS Neon pooler required");
  return {
    url,
    urlHash: hash(url),
    fingerprint: hash(
      `${endpoint.hostname}:${endpoint.port || "5432"}${endpoint.pathname}`,
    ).slice(0, 16),
  };
}

export type Phase = "work" | "cleanup";
export interface CleanupReserve {
  seconds: number;
  terminationSeconds: number;
  requests: number;
  downloadBytes: number;
}
export interface ProofLimits {
  seconds: number;
  requests: number;
  downloadBytes: number;
}
export class ProofBudget {
  readonly work = new AbortController();
  readonly cleanup = new AbortController();
  readonly workDeadline: number;
  readonly cleanupDeadline: number;
  requests = 0;
  downloadBytes = 0;
  private readonly timers: ReturnType<typeof setTimeout>[];
  constructor(
    readonly limits: ProofLimits,
    readonly reserve: CleanupReserve,
    hardDeadline = Date.now() + limits.seconds * 1000,
  ) {
    if (
      reserve.seconds <= 0 ||
      reserve.terminationSeconds <= 0 ||
      reserve.seconds + reserve.terminationSeconds >= limits.seconds ||
      reserve.requests <= 0 ||
      reserve.requests >= limits.requests ||
      reserve.downloadBytes <= 0 ||
      reserve.downloadBytes * 2 > limits.downloadBytes ||
      hardDeadline > Date.now() + limits.seconds * 1000 + 1000
    )
      throw new Error("Invalid cleanup reserve");
    this.cleanupDeadline = hardDeadline - reserve.terminationSeconds * 1000;
    this.workDeadline = this.cleanupDeadline - reserve.seconds * 1000;
    this.timers = [
      setTimeout(
        () => this.stopWork(),
        Math.max(0, this.workDeadline - Date.now()),
      ),
      setTimeout(
        () => this.cleanup.abort(),
        Math.max(0, this.cleanupDeadline - Date.now()),
      ),
    ];
  }
  signal(phase: Phase) {
    return phase === "work" ? this.work.signal : this.cleanup.signal;
  }
  stopWork() {
    this.work.abort();
  }
  check(phase: Phase) {
    const deadline =
      phase === "work" ? this.workDeadline : this.cleanupDeadline;
    if (this.signal(phase).aborted || Date.now() >= deadline)
      throw new Error("Proof phase stopped");
  }
  charge(phase: Phase, bytes = 0) {
    this.check(phase);
    const requestLimit =
      this.limits.requests - (phase === "work" ? this.reserve.requests : 0);
    const byteLimit =
      this.limits.downloadBytes -
      (phase === "work" ? this.reserve.downloadBytes : 0);
    if (
      this.requests + 1 > requestLimit ||
      bytes < 0 ||
      this.downloadBytes + bytes > byteLimit
    )
      throw new Error("Proof phase budget exhausted");
    this.requests++;
    this.downloadBytes += bytes;
  }
  async bounded<T>(phase: Phase, operation: () => Promise<T>): Promise<T> {
    this.check(phase);
    const signal = this.signal(phase);
    let reject!: () => void;
    const aborted = new Promise<never>((_, fail) => {
      reject = () => fail(new Error("Proof phase stopped"));
      signal.addEventListener("abort", reject, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(operation), aborted]);
    } finally {
      signal.removeEventListener("abort", reject);
    }
  }
  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.stopWork();
    this.cleanup.abort();
  }
}

export type Captured<T> =
  | { status: "complete"; value: T }
  | {
      status: "incomplete";
      reason: "not_finished" | "failed_or_budget_exhausted";
    };
export interface Snapshot<C, S> {
  catalogue: Captured<C>;
  storage: Captured<S>;
}
export async function collectProof<
  C extends { sha256: string },
  S extends { sha256: string },
  P,
>(options: {
  budget: ProofBudget;
  catalogue: (phase: Phase) => Promise<C>;
  storage: (phase: Phase) => Promise<S>;
  plan: () => Promise<P>;
  finalGuards: () => void;
  onSnapshot: (phase: Phase, snapshot: Snapshot<C, S>) => void;
}) {
  const capture = async <T>(
    phase: Phase,
    operation: () => Promise<T>,
  ): Promise<Captured<T>> => {
    try {
      return {
        status: "complete",
        value: await options.budget.bounded(phase, operation),
      };
    } catch {
      return { status: "incomplete", reason: "failed_or_budget_exhausted" };
    }
  };
  const snapshot = async (phase: Phase) => {
    let value: Snapshot<C, S> = {
      catalogue: { status: "incomplete", reason: "not_finished" },
      storage: { status: "incomplete", reason: "not_finished" },
    };
    options.onSnapshot(phase, value); // Persist incompleteness before any await.
    value = {
      ...value,
      catalogue: await capture(phase, () => options.catalogue(phase)),
    };
    options.onSnapshot(phase, value);
    value = {
      ...value,
      storage: await capture(phase, () => options.storage(phase)),
    };
    options.onSnapshot(phase, value);
    return value;
  };
  let before: Snapshot<C, S> | undefined;
  let after: Snapshot<C, S> | undefined;
  let planned: Captured<P> = { status: "incomplete", reason: "not_finished" };
  let guards = false;
  try {
    before = await snapshot("work");
    if (
      before.catalogue.status === "complete" &&
      before.storage.status === "complete"
    )
      planned = await capture("work", options.plan);
  } finally {
    options.budget.stopWork(); // Late work retains its work token and cannot spend cleanup capacity.
    after = await snapshot("cleanup");
    try {
      options.finalGuards();
      guards = true;
    } catch {
      /* Fails proof without exposing private values. */
    }
  }
  const complete =
    before?.catalogue.status === "complete" &&
    before.storage.status === "complete" &&
    after.catalogue.status === "complete" &&
    after.storage.status === "complete";
  const same = <T extends { sha256: string }>(a: Captured<T>, b: Captured<T>) =>
    a.status === "complete" &&
    b.status === "complete" &&
    a.value.sha256 === b.value.sha256;
  const unchanged =
    !!before &&
    !!after &&
    same(before.catalogue, after.catalogue) &&
    same(before.storage, after.storage);
  const passed =
    complete && unchanged && guards && planned.status === "complete";
  return {
    status: passed ? "passed" : "failed",
    evidenceComplete: !!complete,
    unchanged: !!unchanged,
    zeroMutationVerified: !!passed,
    guards,
    planned,
    before,
    after,
  };
}
