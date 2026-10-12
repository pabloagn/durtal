import { describe, expect, it } from "vitest";
import {
  deviceReplayPolicy,
  OFFLINE_STORES,
  planLegacyImport,
  recordVersionPolicy,
  validateMutation,
} from "@/lib/reader/offline/mutations";
import { annotations, DEVICE, FILE, NOW, OTHER, position } from "./fixtures";

describe("immutable durable mutation boundary", () => {
  it("retains exact timestamp/locator payload and isolates caller mutations", () => {
    const input = JSON.parse(JSON.stringify(position(1, 0.6).mutation));
    input.body.clientUpdatedAt = "2027-01-15T09:00:00.123456+01:00";
    const parsed = validateMutation(input, {
      nowMs: Date.parse("2027-01-15T10:00:00Z"),
    });
    expect(parsed).toEqual(input);
    expect(Object.isFrozen(parsed.body)).toBe(true);
    input.body.locator.totalProgression = 0.2;
    expect(
      parsed.kind === "position" && parsed.body.locator.totalProgression,
    ).toBe(0.6);
  });
  it("refuses mismatched file identity, unknown fields, malformed versions and future clocks", () => {
    const original = position(1, 0.6).mutation;
    expect(() =>
      validateMutation({ ...original, fileId: OTHER }, { nowMs: NOW }),
    ).toThrow("file identity");
    expect(() =>
      validateMutation({ ...original, signedUrl: "secret" }, { nowMs: NOW }),
    ).toThrow();
    expect(() =>
      validateMutation({ ...original, v: 2 }, { nowMs: NOW }),
    ).toThrow();
    expect(() => validateMutation(original, { nowMs: NOW - 400_000 })).toThrow(
      "future",
    );
  });
  it("requires the annotation owner's validator and preserves all operation kinds", () => {
    const original = annotations(1).mutation;
    expect(() => validateMutation(original, { nowMs: NOW })).toThrow(
      "owner validation",
    );
    expect(() =>
      validateMutation(original, { nowMs: NOW, annotations: () => false }),
    ).toThrow();
    const parsed = validateMutation(original, {
      nowMs: NOW,
      annotations: (body) => body.upserts.length === 1,
    });
    expect(parsed).toEqual(original);
    if (parsed.kind !== "annotations") throw new Error("Expected annotations");
    expect(parsed.body.upserts[0].clientUpdatedAt).toBe(
      original.kind === "annotations" &&
        original.body.upserts[0].clientUpdatedAt,
    );
  });
  it("refuses empty, oversized and repeated annotation bodies", () => {
    const original = annotations(1).mutation;
    if (original.kind !== "annotations")
      throw new Error("Expected annotations");
    for (const body of [
      { upserts: [], deletes: [] },
      { upserts: Array(101).fill(original.body.upserts[0]), deletes: [] },
      { upserts: original.body.upserts, deletes: original.body.upserts },
    ]) {
      expect(() =>
        validateMutation(
          { ...original, body },
          { nowMs: NOW, annotations: () => true },
        ),
      ).toThrow();
    }
  });
  it("has exactly the approved five stores; newer records stay unsupported", () => {
    expect(OFFLINE_STORES).toEqual([
      "downloads",
      "positions",
      "annotations",
      "outbox",
      "rejected",
    ]);
    expect(recordVersionPolicy({ v: 1 })).toBe("supported");
    expect(recordVersionPolicy({ v: 2 })).toBe("unsupported");
    expect(recordVersionPolicy({ v: 0 })).toBe("invalid");
    expect(recordVersionPolicy(null)).toBe("invalid");
  });
  it("blocks missing/replaced devices while accepting UUID case equivalence", () => {
    expect(deviceReplayPolicy(DEVICE, DEVICE.toUpperCase())).toBe("ready");
    expect(deviceReplayPolicy(DEVICE, null)).toBe("device_identity_missing");
    expect(deviceReplayPolicy(DEVICE, "bad")).toBe("device_identity_missing");
    expect(deviceReplayPolicy(DEVICE, OTHER)).toBe("device_identity_changed");
  });
});

describe("guarded legacy import planning", () => {
  it("imports trustworthy originals, recognizes committed copies, preserves unknowns/collisions", () => {
    const a = position(1, 0.6).mutation,
      b = position(2, 0.4).mutation;
    const changed = { ...a, fileId: FILE.toUpperCase() };
    const sources = [
      { key: "a", value: a },
      { key: "b", value: b },
      { key: "unreadable", value: null },
      { key: "collision", value: changed },
    ];
    const result = planLegacyImport(sources, [a], (value) => value);
    expect(result.imports).toEqual([{ key: "b", mutation: b }]);
    expect(result.alreadyCommitted).toEqual(["a"]);
    expect(result.preserved).toEqual(["unreadable", "collision"]);
    expect(sources).toHaveLength(4);
  });
  it("decoder failure or missing original device never guesses a new identity", () => {
    const malformed = { ...position(1, 0.6).mutation, deviceId: "" };
    const result = planLegacyImport(
      [{ key: "broken", value: malformed }],
      [],
      (value) => value,
    );
    expect(result.preserved).toEqual(["broken"]);
    expect(
      planLegacyImport([{ key: "x", value: null }], [], () => {
        throw new Error("Unknown schema");
      }).preserved,
    ).toEqual(["x"]);
  });
  it("rejects duplicate source keys rather than choosing an arbitrary record", () => {
    expect(() =>
      planLegacyImport(
        [
          { key: "x", value: null },
          { key: "x", value: null },
        ],
        [],
        () => null,
      ),
    ).toThrow("Duplicate");
  });
});
