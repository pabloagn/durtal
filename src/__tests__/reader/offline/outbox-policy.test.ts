import { describe, expect, it } from "vitest";
import {
  annotationAcknowledgments,
  coalescePositions,
  matchesClaim,
  OUTBOX_CLAIM_MS,
  planReplayClaim,
  reconcileBlocked,
  releaseClaim,
  replayDelay,
  replayOutcome,
  type OutboxRow,
} from "@/lib/reader/offline/outbox-policy";
import { annotations, DEVICE, NOW, OTHER, position } from "./fixtures";
const options = {
  visible: true,
  reachable: true,
  currentDeviceId: DEVICE,
  nowMs: NOW,
  token: "claim-a",
  mode: "foreground" as const,
};
const claim = (rows: OutboxRow[], overrides: Partial<typeof options> = {}) =>
  planReplayClaim(rows, { ...options, ...overrides });

describe("bounded original milestone and latest", () => {
  it("keeps a high-water original, interleaved annotation and latest backwards move in order", () => {
    const rows = [
      position(1, 0.2),
      position(2, 0.6),
      annotations(3),
      position(4, 0.4),
      position(5, 0.3),
    ];
    const planned = coalescePositions(rows);
    expect(planned.keep.map((row) => row.seq)).toEqual([2, 3, 5]);
    expect(planned.removeSeqs).toEqual([1, 4]);
    expect(planned.keep[0]).toBe(rows[1]);
    expect(planned.keep[2]).toBe(rows[4]);
  });
  it("bounds each file/device pair independently and leaves claimed/blocked rows alone", () => {
    const protectedRow = {
      ...position(1, 0.9),
      state: "claimed" as const,
      claim: { token: "busy", expiresAt: NOW + 1 },
    };
    const blocked = { ...position(2, 0.8), state: "blocked" as const };
    const rows = [
      protectedRow,
      blocked,
      position(3, 0.7),
      position(4, 0.6),
      position(5, 0.5),
      position(6, 0.9, { deviceId: OTHER }),
      position(7, 0.1, { fileId: OTHER }),
    ];
    expect(coalescePositions(rows).keep.map((row) => row.seq)).toEqual([
      1, 2, 3, 5, 6, 7,
    ]);
  });
  it("uses original timestamp precision, not delayed enqueue order, to choose latest", () => {
    const rows = [
      position(1, 0.8, { time: "2027-01-15T08:00:00.123455Z" }),
      position(2, 0.3, { time: "2027-01-15T09:00:00.123456+01:00" }),
      position(3, 0.2, { time: "2027-01-15T08:00:00.123454Z" }),
    ];
    expect(coalescePositions(rows).keep.map((row) => row.seq)).toEqual([1, 2]);
  });
  it("a new maximum that is also latest needs only one waiting mutation", () => {
    expect(
      coalescePositions([
        position(1, 0.2),
        position(2, 0.4),
        position(3, 0.8),
      ]).keep.map((row) => row.seq),
    ).toEqual([3]);
  });
  it("retains annotation order and the true maximum across a long sequence", () => {
    const rows = Array.from({ length: 400 }, (_, index) =>
      index % 7 === 0
        ? annotations(index + 1)
        : position(index + 1, ((index * 31) % 101) / 100),
    );
    const result = coalescePositions(rows).keep;
    expect(result.filter((row) => row.mutation.kind === "annotations")).toEqual(
      rows.filter((row) => row.mutation.kind === "annotations"),
    );
    const positions = result.filter((row) => row.mutation.kind === "position");
    expect(positions).toHaveLength(2);
    expect(
      positions.some(
        (row) =>
          row.mutation.kind === "position" &&
          row.mutation.body.locator.totalProgression === 1,
      ),
    ).toBe(true);
  });
});

describe("claim and exact acknowledgment policies", () => {
  it("claims the head, preserves its timestamp, and rejects stale body/revision/token/device acknowledgments", () => {
    const original = position(1, 0.6);
    const result = claim([original]);
    if (result.kind !== "claim") throw new Error("Expected claim");
    const row = result.rows[0],
      reference = result.references[0];
    expect(result.body).toEqual(original.mutation.body);
    expect(matchesClaim(row, reference)).toBe(true);
    for (const changed of [
      { ...reference, token: "old" },
      { ...reference, revision: 2 },
      { ...reference, wireJson: "{}" },
      { ...reference, deviceId: OTHER },
    ])
      expect(matchesClaim(row, changed)).toBe(false);
    expect(releaseClaim(row, { ...reference, token: "old" })).toBe(row);
    expect(releaseClaim(row, reference)).toMatchObject({
      state: "waiting",
      claim: null,
      attempts: 1,
    });
    expect(original.state).toBe("waiting");
  });
  it("a live claim prevents another request and a stale claim receives a new token", () => {
    const result = claim([position(1, 0.6)]);
    if (result.kind !== "claim") throw new Error("Expected claim");
    expect(claim(result.rows)).toEqual({ kind: "stop", reason: "busy" });
    const reclaimed = claim(result.rows, {
      nowMs: NOW + OUTBOX_CLAIM_MS,
      token: "claim-b",
    });
    if (reclaimed.kind !== "claim") throw new Error("Expected reclaimed claim");
    expect(matchesClaim(reclaimed.rows[0], result.references[0])).toBe(false);
  });
  it.each([401, 403])(
    "keeps the head blocked after authentication refusal %i across replay triggers",
    (status) => {
      const original = position(1, 0.6),
        next = annotations(2);
      const result = claim([original, next]);
      if (result.kind !== "claim") throw new Error("Expected claim");
      const blocked = releaseClaim(
        result.rows[0],
        result.references[0],
        replayOutcome(status) === "blocked",
      );
      expect(blocked).toMatchObject({
        state: "blocked",
        claim: null,
        attempts: 1,
      });
      expect(blocked.mutation).toBe(original.mutation);
      for (const trigger of [
        { ...options, token: "visibility" },
        { ...options, token: "reachability", nowMs: NOW + 300_000 },
        { ...options, token: "device", currentDeviceId: OTHER },
        {
          ...options,
          token: "lifecycle",
          visible: false,
          mode: "lifecycle" as const,
        },
      ])
        expect(planReplayClaim([next, blocked], trigger)).toEqual({
          kind: "stop",
          reason: "blocked",
        });
      expect(blocked.state).toBe("blocked");
    },
  );
  it("explicit reconciliation restores the original head without changing its order or body", () => {
    const original = position(1, 0.6),
      next = annotations(2);
    const result = claim([original, next]);
    if (result.kind !== "claim") throw new Error("Expected claim");
    const blocked = releaseClaim(result.rows[0], result.references[0], true);
    const reference = { ...result.references[0], attempts: blocked.attempts };
    const waiting = reconcileBlocked(blocked, reference, DEVICE);
    expect(waiting).toEqual({ ...blocked, state: "waiting" });
    expect(waiting.mutation).toBe(original.mutation);
    const resumed = claim([next, waiting], { token: "after-reconciliation" });
    if (resumed.kind !== "claim") throw new Error("Expected reconciled claim");
    expect(resumed.rows.map((row) => row.seq)).toEqual([1]);
    expect(resumed.json).toBe(result.json);
    expect(matchesClaim(resumed.rows[0], result.references[0])).toBe(false);
    expect(blocked.state).toBe("blocked");
  });
  it("refuses stale reconciliation, changed mutations and unresolved device identity", () => {
    const result = claim([position(1, 0.6)]);
    if (result.kind !== "claim") throw new Error("Expected claim");
    const blocked = releaseClaim(result.rows[0], result.references[0], true);
    const reference = { ...result.references[0], attempts: blocked.attempts };
    for (const changed of [
      { ...reference, seq: 2 },
      { ...reference, operationId: "old" },
      { ...reference, revision: 2 },
      { ...reference, ebookId: OTHER },
      { ...reference, fileId: OTHER },
      { ...reference, deviceId: OTHER },
      { ...reference, wireJson: "{}" },
      { ...reference, attempts: 0 },
    ])
      expect(reconcileBlocked(blocked, changed, DEVICE)).toBe(blocked);
    for (const device of [null, OTHER])
      expect(reconcileBlocked(blocked, reference, device)).toBe(blocked);
    expect(reconcileBlocked(result.rows[0], reference, DEVICE)).toBe(
      result.rows[0],
    );
    const waiting = reconcileBlocked(blocked, reference, DEVICE);
    const retried = claim([waiting], { token: "retry" });
    if (retried.kind !== "claim") throw new Error("Expected retry claim");
    const blockedAgain = releaseClaim(
      retried.rows[0],
      retried.references[0],
      true,
    );
    expect(reconcileBlocked(blockedAgain, reference, DEVICE)).toBe(
      blockedAgain,
    );
  });
  it("does not skip a head belonging to a missing/changed device", () => {
    const rows = [position(1, 0.6, { deviceId: OTHER }), position(2, 0.4)];
    expect(claim(rows)).toEqual({
      kind: "stop",
      reason: "device_identity_changed",
    });
    expect(
      claim(rows, { currentDeviceId: null } as unknown as Partial<
        typeof options
      >),
    ).toEqual({ kind: "stop", reason: "device_identity_missing" });
    expect(claim(rows, { visible: false })).toEqual({
      kind: "stop",
      reason: "hidden",
    });
    expect(claim(rows, { reachable: false })).toEqual({
      kind: "stop",
      reason: "unreachable",
    });
  });
  it("batches only consecutive distinct annotations up to 100, with original timestamps", () => {
    const result = claim([
      annotations(1, { count: 70 }),
      annotations(2, { count: 30, deleting: true }),
      annotations(3),
      position(4, 0.4),
    ]);
    if (result.kind !== "claim" || !("upserts" in result.body))
      throw new Error("Expected annotation claim");
    expect(result.rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(result.body.upserts).toHaveLength(70);
    expect(result.body.deletes).toHaveLength(30);
    expect(result.body.upserts[0].clientUpdatedAt).toBe(
      annotations(1).mutation.kind === "annotations" &&
        new Date(NOW + 1).toISOString(),
    );
  });
  it("does not reorder dependent edits, non-batchable deletes or positions", () => {
    for (const rows of [
      [annotations(1, { sameId: 7 }), annotations(2, { sameId: 7 })],
      [annotations(1, { batchable: false }), annotations(2)],
      [annotations(1), position(2, 0.5), annotations(3)],
      [annotations(1), annotations(2, { deviceId: OTHER })],
    ]) {
      const result = claim(rows);
      expect(
        result.kind === "claim" && result.rows.map((row) => row.seq),
      ).toEqual([1]);
    }
  });
  it("uses UTF-8 byte budgets and retains a large lifecycle head for foreground replay", () => {
    const rows = [
      annotations(1, { note: "界".repeat(22_000) }),
      annotations(2),
    ];
    expect(
      planReplayClaim(rows, { ...options, visible: false, mode: "lifecycle" }),
    ).toEqual({ kind: "stop", reason: "lifecycle_body_too_large" });
    expect(claim(rows).kind).toBe("claim");
  });
  it("rejects corrupt ledger identities instead of selecting ambiguous entries", () => {
    expect(() => claim([position(1, 0.5), position(1, 0.6)])).toThrow(
      "Invalid outbox",
    );
  });
});

describe("replay response and backoff", () => {
  it.each([200, 201, 204])("acknowledges position success %i", (status) =>
    expect(replayOutcome(status)).toBe("acknowledge"),
  );
  it.each([400, 404, 409, 422])(
    "retains a visible permanent refusal %i",
    (status) => expect(replayOutcome(status)).toBe("reject"),
  );
  it.each([401, 403])("blocks authentication refusal %i", (status) =>
    expect(replayOutcome(status)).toBe("blocked"),
  );
  it.each([null, 408, 429, 500, 502, 503, 504])(
    "retries transient failure %s",
    (status) => expect(replayOutcome(status)).toBe("retry"),
  );
  it("keeps typed device mismatch durable despite its HTTP 409", () =>
    expect(replayOutcome(409, "device_identity_changed")).toBe("blocked"));
  it("plans 30s/1m/2m/5m with no hidden timer and bounded Retry-After", () => {
    expect([0, 1, 2, 3, 30].map((n) => replayDelay(n, true))).toEqual([
      30_000, 60_000, 120_000, 300_000, 300_000,
    ]);
    expect(replayDelay(0, false)).toBeNull();
    expect(replayDelay(0, true, 120_000)).toBe(120_000);
    expect(replayDelay(0, true, 1_000_000)).toBe(300_000);
  });
});

describe("annotation acknowledgments", () => {
  it("requires item results even on a 2xx and surfaces ignored tombstones", () => {
    expect(replayOutcome(200, undefined, "annotations")).toBe(
      "inspect_annotations",
    );
    const result = claim([annotations(1), annotations(2)]);
    if (result.kind !== "claim" || !("upserts" in result.body))
      throw new Error("Expected annotations");
    const ids = result.body.upserts.map((item) => String(item.id));
    const outcomes = [
      { id: ids[0], kind: "applied" as const },
      {
        id: ids[1],
        kind: "ignored" as const,
        reason: "Deleted on another device",
      },
    ];
    const acks = annotationAcknowledgments(result.references, outcomes);
    expect(acks[0].ignored).toEqual([]);
    expect(acks[1].ignored).toEqual([outcomes[1]]);
    for (const malformed of [
      [],
      outcomes.slice(1),
      [outcomes[0], outcomes[0]],
      [...outcomes, { id: OTHER, kind: "applied" as const }],
    ])
      expect(() =>
        annotationAcknowledgments(result.references, malformed),
      ).toThrow("Incomplete");
  });
});
