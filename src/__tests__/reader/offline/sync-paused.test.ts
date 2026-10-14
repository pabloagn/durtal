import { describe, expect, it } from "vitest";
import { PAUSED_AFTER_ATTEMPTS, syncPaused } from "@/lib/reader/offline/sync-paused";

const row = (state: "waiting" | "claimed" | "blocked", attempts = 0) => ({ state, attempts });

describe("whether reader sync is paused (SLN-668)", () => {
  it("is not paused with nothing to send", () => {
    expect(syncPaused([], true)).toBe(false);
  });
  it("is paused behind a blocked head", () => {
    expect(syncPaused([row("blocked"), row("waiting")], true)).toBe(true);
  });
  it("is paused once the head has failed to send several times", () => {
    expect(syncPaused([row("waiting", PAUSED_AFTER_ATTEMPTS - 1)], true)).toBe(false);
    expect(syncPaused([row("waiting", PAUSED_AFTER_ATTEMPTS)], true)).toBe(true);
  });
  it("is not paused while the head is being sent", () => {
    expect(syncPaused([row("claimed", PAUSED_AFTER_ATTEMPTS)], true)).toBe(false);
  });
  it("is not paused offline, where the queue waits for the network", () => {
    expect(syncPaused([row("blocked")], false)).toBe(false);
  });
  it("looks at the head only", () => {
    expect(syncPaused([row("waiting"), row("blocked")], true)).toBe(false);
  });
});
