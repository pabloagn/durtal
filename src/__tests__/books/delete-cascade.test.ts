import { describe, expect, it } from "vitest";
import { BULK_DELETE_CASCADE, workDeleteCascadeMessage } from "@/components/books/delete-cascade";

describe("workDeleteCascadeMessage", () => {
  it("lists every part with commas and an and", () => {
    expect(workDeleteCascadeMessage({ editions: 2, instances: 1, readings: 3, sessions: 41 })).toBe(
      "This will also delete 2 editions, 1 instance and 3 readings (41 sessions).",
    );
  });
  it("leaves out readings and sessions when there are none", () => {
    expect(workDeleteCascadeMessage({ editions: 2, instances: 3, readings: 0, sessions: 0 })).toBe(
      "This will also delete 2 editions and 3 instances.",
    );
    expect(workDeleteCascadeMessage({ editions: 1, instances: 0, readings: 2, sessions: 0 })).toBe(
      "This will also delete 1 edition and 2 readings.",
    );
    expect(workDeleteCascadeMessage({ editions: 0, instances: 0, readings: 0, sessions: 0 })).toBeUndefined();
  });
  it("writes singulars", () => {
    expect(workDeleteCascadeMessage({ editions: 0, instances: 0, readings: 1, sessions: 1 })).toBe(
      "This will also delete 1 reading (1 session).",
    );
  });
  it("names the reading history in the bulk delete", () => {
    expect(BULK_DELETE_CASCADE).toBe(
      "This will permanently delete all editions, instances, and media associated with the selected works, and their reading history.",
    );
  });
});
