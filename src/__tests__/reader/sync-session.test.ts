import { describe, expect, it, vi } from "vitest";
import { createPlaceSync } from "@/lib/reader/sync/session";
import { place } from "./fixtures/places";
const other = place({
  thisDevice: false,
  deviceId: "phone",
  locator: { ...place().locator, sectionIndex: 5 },
  clientUpdatedAt: "2026-10-09T11:00:00Z",
});
function setup(declinedAt = 0) {
  const offer = vi.fn(),
    remember = vi.fn();
  const flush = vi.fn(async () => true),
    read = vi.fn(async () => [other]);
  const sync = createPlaceSync({
    own: place(),
    other,
    declinedAt,
    offer,
    remember,
    flush,
    read,
  });
  return { sync, offer, remember, flush, read };
}
describe("reader sync lifecycle", () => {
  it("Stay survives another open until a strictly newer save", async () => {
    const s = setup();
    s.sync.dismiss();
    expect(s.remember).toHaveBeenCalledWith(Date.parse(other.clientUpdatedAt));
    const reopened = setup(s.remember.mock.calls[0][0]);
    expect(reopened.offer).toHaveBeenLastCalledWith(null);
    await reopened.sync.refresh();
    expect(reopened.offer).toHaveBeenLastCalledWith(null);
    const newer = { ...other, clientUpdatedAt: "2026-10-09T12:00:00Z" };
    reopened.read.mockResolvedValue([newer]);
    await reopened.sync.refresh();
    expect(reopened.offer).toHaveBeenLastCalledWith(newer);
  });
  it.each(["Stay", "Go there", "local turn", "destroy"])(
    "invalidates a pending GET on %s",
    async (intent) => {
      const s = setup();
      let finish!: (rows: (typeof other)[]) => void;
      s.read.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const refresh = s.sync.refresh();
      await Promise.resolve();
      if (intent === "local turn") s.sync.localTurn(place());
      else if (intent === "destroy") s.sync.destroy();
      else s.sync.dismiss();
      const calls = s.offer.mock.calls.length;
      finish([{ ...other, clientUpdatedAt: "2026-10-09T12:00:00Z" }]);
      await refresh;
      expect(s.offer).toHaveBeenCalledTimes(calls);
    },
  );
  it("awaits the queue and coalesces visibility/online requests", async () => {
    const s = setup();
    let finish!: (ok: boolean) => void;
    s.flush.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = s.sync.refresh(),
      second = s.sync.refresh();
    expect(second).toBe(first);
    expect(s.read).not.toHaveBeenCalled();
    finish(true);
    await first;
    expect(s.read).toHaveBeenCalledTimes(1);
  });
  it("keeps reading usable when flush or GET fails", async () => {
    const s = setup();
    s.flush.mockResolvedValueOnce(false);
    await s.sync.refresh();
    expect(s.read).not.toHaveBeenCalled();
    s.read.mockRejectedValueOnce(new Error("offline"));
    await expect(s.sync.refresh()).resolves.toBeUndefined();
    expect(s.offer).toHaveBeenCalledTimes(1);
  });
});
