import { describe, expect, it, vi } from "vitest";

// recordActivity writes after the action returns; activitySettled waits for those writes (SLN-521)

const { gates, landed } = vi.hoisted(() => ({ gates: [] as (() => void)[], landed: [] as string[] }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      // Each write lands only when the test opens its gate
      values: (row: { eventKey: string }) =>
        new Promise<void>((done) =>
          gates.push(() => {
            landed.push(row.eventKey);
            done();
          }),
        ),
    }),
  },
}));

import { activitySettled, recordActivity } from "@/lib/activity/record";

describe("activitySettled", () => {
  it("resolves only once every write started so far has landed", async () => {
    recordActivity("work", "w1", "work.reading_started");
    recordActivity("work", "w1", "work.reading_finished");
    let settled = false;
    const wait = activitySettled().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    gates.splice(0).forEach((open) => open());
    await wait;
    expect(landed).toEqual(["work.reading_started", "work.reading_finished"]);
    expect(settled).toBe(true);
  });

  it("resolves at once with nothing in flight", async () => {
    await expect(activitySettled()).resolves.toBeUndefined();
  });
});
