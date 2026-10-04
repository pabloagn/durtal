import { describe, it, expect } from "vitest";
import {
  decodeActivityCursor,
  encodeActivityCursor,
} from "@/lib/activity/cursor";

describe("activity cursor", () => {
  it("round-trips a microsecond timestamp and id", () => {
    const cursor = {
      createdAt: "2026-10-03 17:31:23.856123+00",
      id: "4a9e9404-6c91-41cd-9bbf-8bcceea388b8",
    };
    expect(decodeActivityCursor(encodeActivityCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed values", () => {
    expect(decodeActivityCursor("")).toBeNull();
    expect(decodeActivityCursor("2026-10-03T17:31:23.856Z")).toBeNull();
    expect(decodeActivityCursor("|abc")).toBeNull();
    expect(decodeActivityCursor("2026-10-03|")).toBeNull();
  });
});
