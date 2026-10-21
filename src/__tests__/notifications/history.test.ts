// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAll,
  getEntries,
  markRead,
  record,
  remove,
  REPEAT_MS,
  resetForTests,
  STORAGE_KEY,
  subscribe,
} from "@/lib/notifications/history";

// The notification history (SLN-567): errors and warnings, read or unread,
// kept in this browser.

const T = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  resetForTests();
  vi.restoreAllMocks();
});

describe("the notification history", () => {
  it("keeps the newest first, unread, and in this browser's storage", () => {
    record({ id: "p:1", kind: "error", title: "Could not save" }, T);
    record({ id: "p:2", kind: "warning", title: "Cover skipped", description: "No image at that address" }, T + 1);
    expect(getEntries().map((e) => [e.title, e.read, e.count])).toEqual([
      ["Cover skipped", false, 1],
      ["Could not save", false, 1],
    ]);
    resetForTests();
    expect(getEntries().map((e) => e.id)).toEqual(["p:2", "p:1"]);
  });

  it("updates the entry of a toast that changes, and marks it unread again", () => {
    record({ id: "p:1", kind: "warning", title: "Uploading slowly" }, T);
    markRead(["p:1"]);
    record({ id: "p:1", kind: "error", title: "Upload failed" }, T + 5);
    expect(getEntries()).toEqual([
      expect.objectContaining({ id: "p:1", kind: "error", title: "Upload failed", read: false, count: 1, at: T + 5 }),
    ]);
  });

  // SLN-1460: a toast shown again under its id, with the same words, was dropped
  it("counts the same toast shown again with the same words, unread, latest time, at the top", () => {
    record({ id: "p:1", kind: "error", title: "Could not update the favourite" }, T);
    record({ id: "p:2", kind: "warning", title: "Other" }, T + 1);
    markRead(["p:1", "p:2"]);
    record({ id: "p:1", kind: "error", title: "Could not update the favourite" }, T + 5 * REPEAT_MS);
    expect(getEntries()).toEqual([
      expect.objectContaining({ id: "p:1", count: 2, read: false, at: T + 5 * REPEAT_MS }),
      expect.objectContaining({ id: "p:2", count: 1, read: true }),
    ]);
  });

  it("counts the same message again soon after on one entry", () => {
    record({ id: "p:1", kind: "error", title: "Could not save" }, T);
    record({ id: "p:2", kind: "error", title: "Could not save" }, T + REPEAT_MS - 1);
    expect(getEntries().map((e) => [e.title, e.count])).toEqual([["Could not save", 2]]);
    // Later, or after another message, it is a new entry
    record({ id: "p:3", kind: "error", title: "Could not save" }, T + 3 * REPEAT_MS);
    record({ id: "p:4", kind: "warning", title: "Other" }, T + 3 * REPEAT_MS);
    record({ id: "p:5", kind: "error", title: "Could not save" }, T + 3 * REPEAT_MS);
    expect(getEntries().map((e) => e.count)).toEqual([1, 1, 1, 2]);
  });

  it("keeps every notification across years and reloads until explicitly removed", () => {
    for (let i = 0; i < 75; i++)
      record({ id: `p:${i}`, kind: "error", title: `Error ${i}` }, T + i);
    record({ id: "p:new", kind: "success", title: "Later" }, T + 2 * 365 * 86400000);
    resetForTests();
    expect(getEntries()).toHaveLength(76);
    expect(getEntries().at(-1)?.title).toBe("Error 0");
    markRead(["p:0"]);
    expect(getEntries()).toHaveLength(76);
    remove("p:0");
    expect(getEntries()).toHaveLength(75);
  });

  it("marks read only the entries named, removes one, and clears all", () => {
    record({ id: "p:1", kind: "error", title: "One" }, T);
    record({ id: "p:2", kind: "error", title: "Two" }, T + 1);
    record({ id: "p:3", kind: "error", title: "Three" }, T + 2);
    markRead(["p:2"]);
    expect(getEntries().map((e) => e.read)).toEqual([false, true, false]);
    remove("p:3");
    expect(getEntries().map((e) => e.id)).toEqual(["p:2", "p:1"]);
    clearAll();
    expect(getEntries()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([]);
  });

  it("tells its listeners, and follows another tab's changes", () => {
    const listener = vi.fn();
    const stop = subscribe(listener);
    record({ id: "p:1", kind: "error", title: "One" }, T);
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: "q:1", kind: "warning", title: "From another tab", description: null, at: Date.now(), count: 1, read: false },
    ]));
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(getEntries().map((e) => e.title)).toEqual(["From another tab"]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores unreadable storage, and keeps working when storage refuses", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getEntries()).toEqual([]);
    resetForTests();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 1 }, "x", null]));
    expect(getEntries()).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    record({ id: "p:1", kind: "error", title: "Kept for this page" }, T);
    expect(getEntries().map((e) => e.title)).toEqual(["Kept for this page"]);
  });
});
