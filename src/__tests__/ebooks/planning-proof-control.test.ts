import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectProof,
  ProofBudget,
  readPrivateTarget,
} from "../../../scripts/qa/ebook-proof-control";

const folders: string[] = [];
const budgets: ProofBudget[] = [];
const snapshot = { sha256: "same" };
const makeBudget = () => {
  const budget = new ProofBudget(
    { seconds: 2, requests: 6, downloadBytes: 8 },
    { seconds: 1, terminationSeconds: 0.1, requests: 2, downloadBytes: 4 },
  );
  budgets.push(budget);
  return budget;
};
afterEach(() => {
  for (const budget of budgets.splice(0)) budget.dispose();
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true });
  vi.useRealTimers();
});

it("derives the live target from local private precedence independently of a historical loopback plan", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "proof-target-"));
  folders.push(dir);
  const live =
    "postgresql://fake:private@ep-proof-pooler.eu-north-1.aws.neon.tech/live?sslmode=require";
  writeFileSync(
    path.join(dir, ".env"),
    "DATABASE_URL=postgresql://old@localhost/disposable\n",
  );
  writeFileSync(path.join(dir, ".env.local"), `DATABASE_URL=${live}\n`);
  const expected = createHash("sha256").update(live).digest("hex");
  const target = readPrivateTarget(dir, expected);
  expect(target.fingerprint).toBe(
    createHash("sha256")
      .update("ep-proof-pooler.eu-north-1.aws.neon.tech:5432/live")
      .digest("hex")
      .slice(0, 16),
  );
  expect(target.urlHash).toBe(expected);
  expect(() => readPrivateTarget(dir, "0".repeat(64))).toThrow("URL changed");
  writeFileSync(
    path.join(dir, ".env.local"),
    "DATABASE_URL=postgresql://old@localhost/disposable\n",
  );
  expect(() =>
    readPrivateTarget(
      dir,
      createHash("sha256")
        .update("postgresql://old@localhost/disposable")
        .digest("hex"),
    ),
  ).toThrow("Neon pooler required");
});

it("reserves requests and bytes atomically and denies late work cleanup capacity", () => {
  const budget = makeBudget();
  budget.charge("work", 4);
  expect(() => budget.charge("work", 1)).toThrow("budget exhausted");
  expect(budget.requests).toBe(1);
  for (let i = 0; i < 3; i++) budget.charge("work");
  expect(() => budget.charge("work")).toThrow("budget exhausted");
  budget.stopWork();
  expect(() => budget.charge("work")).toThrow("phase stopped");
  budget.charge("cleanup", 4);
  budget.charge("cleanup");
  expect(budget.requests).toBe(6);
  expect(budget.downloadBytes).toBe(8);
  expect(() => budget.charge("cleanup")).toThrow("budget exhausted");
});

it("refuses a reserve that cannot fit both complete byte inventories", () => {
  expect(
    () =>
      new ProofBudget(
        { seconds: 2, requests: 6, downloadBytes: 7 },
        { seconds: 1, terminationSeconds: 0.1, requests: 2, downloadBytes: 4 },
      ),
  ).toThrow("Invalid cleanup reserve");
});

describe("after capture from finally", () => {
  it("attempts both after components even when the before catalogue fails", async () => {
    const calls: string[] = [];
    const plan = vi.fn(async () => "planned");
    const proof = await collectProof({
      budget: makeBudget(),
      catalogue: async (phase) => {
        calls.push(`${phase}:catalogue`);
        if (phase === "work") throw new Error("private failure");
        return snapshot;
      },
      storage: async (phase) => {
        calls.push(`${phase}:storage`);
        return snapshot;
      },
      plan,
      finalGuards: () => {},
      onSnapshot: () => {},
    });
    expect(calls).toEqual([
      "work:catalogue",
      "work:storage",
      "cleanup:catalogue",
      "cleanup:storage",
    ]);
    expect(plan).not.toHaveBeenCalled();
    expect(proof.after?.catalogue.status).toBe("complete");
    expect(proof.after?.storage.status).toBe("complete");
    expect(proof.evidenceComplete).toBe(false);
    expect(proof.zeroMutationVerified).toBe(false);
  });

  it("preserves complete after evidence on planning failure while failing acceptance", async () => {
    const proof = await collectProof({
      budget: makeBudget(),
      catalogue: async () => snapshot,
      storage: async () => snapshot,
      plan: async () => {
        throw new Error("private failure");
      },
      finalGuards: () => {},
      onSnapshot: () => {},
    });
    expect(proof.evidenceComplete).toBe(true);
    expect(proof.unchanged).toBe(true);
    expect(proof.status).toBe("failed");
    expect(proof.zeroMutationVerified).toBe(false);
  });

  it("uses reserved cleanup capacity after work requests are exhausted", async () => {
    const budget = makeBudget();
    const proof = await collectProof({
      budget,
      catalogue: async (phase) => {
        budget.charge(phase);
        if (phase === "work") budget.charge(phase);
        return snapshot;
      },
      storage: async (phase) => {
        budget.charge(phase);
        if (phase === "work") budget.charge(phase);
        return snapshot;
      },
      plan: async () => {
        budget.charge("work");
        return "planned";
      },
      finalGuards: () => {},
      onSnapshot: () => {},
    });
    expect(budget.requests).toBe(6);
    expect(proof.evidenceComplete).toBe(true);
    expect(proof.zeroMutationVerified).toBe(false);
  });

  it("cancels timed-out work and captures after evidence without awaiting a hung read", async () => {
    vi.useFakeTimers();
    const budget = makeBudget();
    const seen: string[] = [];
    const pending = collectProof({
      budget,
      catalogue: async (phase) => {
        if (phase === "work") return new Promise<typeof snapshot>(() => {});
        seen.push("after catalogue");
        return snapshot;
      },
      storage: async (phase) => {
        seen.push(`${phase} storage`);
        return snapshot;
      },
      plan: async () => "planned",
      finalGuards: () => {},
      onSnapshot: (phase, value) => {
        if (phase === "cleanup" && value.catalogue.status === "incomplete")
          seen.push("persist after incomplete");
      },
    });
    await vi.advanceTimersByTimeAsync(901);
    const proof = await pending;
    expect(seen).toContain("persist after incomplete");
    expect(seen).toContain("after catalogue");
    expect(seen).toContain("cleanup storage");
    expect(proof.after?.catalogue.status).toBe("complete");
    expect(proof.zeroMutationVerified).toBe(false);
    expect(() => budget.charge("work")).toThrow("phase stopped");
  });

  it("continues to the after storage even if the after catalogue fails", async () => {
    const storage = vi.fn(async () => snapshot);
    const proof = await collectProof({
      budget: makeBudget(),
      catalogue: async (phase) => {
        if (phase === "cleanup") throw new Error("external failure");
        return snapshot;
      },
      storage,
      plan: async () => "planned",
      finalGuards: () => {},
      onSnapshot: () => {},
    });
    expect(storage).toHaveBeenCalledWith("cleanup");
    expect(proof.after?.storage.status).toBe("complete");
    expect(proof.evidenceComplete).toBe(false);
    expect(proof.zeroMutationVerified).toBe(false);
  });

  it("persists explicit incomplete after evidence at the hard cleanup deadline", async () => {
    vi.useFakeTimers();
    const updates: string[] = [];
    const pending = collectProof({
      budget: makeBudget(),
      catalogue: async (phase) =>
        phase === "cleanup" ? new Promise<typeof snapshot>(() => {}) : snapshot,
      storage: async () => snapshot,
      plan: async () => "planned",
      finalGuards: () => {},
      onSnapshot: (phase, value) => {
        if (phase === "cleanup")
          updates.push(`${value.catalogue.status}:${value.storage.status}`);
      },
    });
    await vi.advanceTimersByTimeAsync(1901);
    const proof = await pending;
    expect(updates.length).toBeGreaterThan(1);
    expect(updates.at(-1)).toBe("incomplete:incomplete");
    expect(proof.evidenceComplete).toBe(false);
    expect(proof.zeroMutationVerified).toBe(false);
  });

  it("fails acceptance for changed fingerprints or final guards", async () => {
    const changed = await collectProof({
      budget: makeBudget(),
      catalogue: async (phase) => ({ sha256: phase }),
      storage: async () => snapshot,
      plan: async () => "planned",
      finalGuards: () => {},
      onSnapshot: () => {},
    });
    expect(changed.evidenceComplete).toBe(true);
    expect(changed.unchanged).toBe(false);
    expect(changed.zeroMutationVerified).toBe(false);
    const guards = await collectProof({
      budget: makeBudget(),
      catalogue: async () => snapshot,
      storage: async () => snapshot,
      plan: async () => "planned",
      finalGuards: () => {
        throw new Error("source changed");
      },
      onSnapshot: () => {},
    });
    expect(guards.unchanged).toBe(true);
    expect(guards.zeroMutationVerified).toBe(false);
  });
});
