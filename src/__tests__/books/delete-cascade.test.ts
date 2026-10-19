import { describe, expect, it } from "vitest";
import {
  copyDeleteCascadeMessage,
  DELETE_CASCADE_COUNTING,
  keptOrderRefusal,
  workDeleteCascade,
  workDeleteCascadeMessage,
  workDeleteFallback,
} from "@/lib/catalogue/delete-cascade";

describe("workDeleteCascadeMessage", () => {
  it("lists every part with commas and an and", () => {
    expect(workDeleteCascadeMessage({ editions: 2, copies: 1, readings: 3, sessions: 41 })).toBe(
      "This will also delete 2 editions, 1 copy and 3 readings (41 sessions).",
    );
  });
  it("leaves out readings and sessions when there are none", () => {
    expect(workDeleteCascadeMessage({ editions: 2, copies: 3, readings: 0, sessions: 0 })).toBe(
      "This will also delete 2 editions and 3 copies.",
    );
    expect(workDeleteCascadeMessage({ editions: 1, copies: 0, readings: 2, sessions: 0 })).toBe(
      "This will also delete 1 edition and 2 readings.",
    );
    expect(workDeleteCascadeMessage({ editions: 0, copies: 0, readings: 0, sessions: 0 })).toBeUndefined();
  });
  it("writes singulars", () => {
    expect(workDeleteCascadeMessage({ editions: 0, copies: 0, readings: 1, sessions: 1 })).toBe(
      "This will also delete 1 reading (1 session).",
    );
  });
  it("names quotes and notes, with singulars, and leaves out the ones with none (SLN-453)", () => {
    expect(workDeleteCascadeMessage({ editions: 2, copies: 1, readings: 3, sessions: 41, quotes: 12, notes: 2 })).toBe(
      "This will also delete 2 editions, 1 copy, 3 readings (41 sessions), 12 quotes and 2 notes.",
    );
    expect(workDeleteCascadeMessage({ editions: 1, copies: 0, readings: 0, sessions: 0, quotes: 1, notes: 1 })).toBe(
      "This will also delete 1 edition, 1 quote and 1 note.",
    );
    expect(workDeleteCascadeMessage({ editions: 0, copies: 0, readings: 0, sessions: 0, quotes: 0, notes: 3 })).toBe(
      "This will also delete 3 notes.",
    );
  });
  it("names orders with their history, acquisition targets and images (SLN-1112)", () => {
    expect(
      workDeleteCascadeMessage({ editions: 1, copies: 1, readings: 0, sessions: 0, orders: 1, targets: 1, images: 3 }),
    ).toBe("This will also delete 1 edition, 1 copy, 1 order with its status history, 1 acquisition target and 3 images.");
    expect(
      workDeleteCascadeMessage({ editions: 0, copies: 0, readings: 0, sessions: 0, orders: 2, targets: 2, images: 1 }),
    ).toBe("This will also delete 2 orders with their status history, 2 acquisition targets and 1 image.");
    expect(
      workDeleteCascadeMessage({ editions: 1200, copies: 0, readings: 0, sessions: 0 }),
    ).toBe("This will also delete 1,200 editions.");
  });
  it("says linked eBooks return to review, and only when there are some", () => {
    expect(workDeleteCascadeMessage({ editions: 1, copies: 1, readings: 0, sessions: 0, ebooks: 1 })).toBe(
      "This will also delete 1 edition and 1 copy. The linked eBook returns to review; its files, reading positions and annotations are kept.",
    );
    expect(workDeleteCascadeMessage({ editions: 0, copies: 0, readings: 0, sessions: 0, ebooks: 2 })).toBe(
      "The 2 linked eBooks return to review; their files, reading positions and annotations are kept.",
    );
  });
});

describe("workDeleteCascade", () => {
  it("counts while loading, names everything uncounted when the counts can't be read", () => {
    expect(workDeleteCascade(undefined)).toBe(DELETE_CASCADE_COUNTING);
    expect(workDeleteCascade(null)).toBe(workDeleteFallback(false));
    expect(workDeleteCascade(null, true)).toBe(workDeleteFallback(true));
    expect(workDeleteFallback(true)).toContain("orders and acquisition targets");
    expect(workDeleteCascade({ editions: 1, copies: 0, readings: 0, sessions: 0 })).toBe("This will also delete 1 edition.");
  });
});

describe("copyDeleteCascadeMessage", () => {
  it("names what goes, the eBook's return to review, and what stays", () => {
    expect(copyDeleteCascadeMessage({ history: 3, targets: 1, readings: 2, orders: 1, ebook: true })).toBe(
      "This will also delete its status history and its link to 1 acquisition target. Its eBook returns to review; its files, reading positions and annotations are kept. 2 readings and 1 order stay with the book, without this copy.",
    );
    expect(copyDeleteCascadeMessage({ history: 0, targets: 0, readings: 1, orders: 0, ebook: false })).toBe(
      "1 reading stays with the book, without this copy.",
    );
    expect(copyDeleteCascadeMessage({ history: 0, targets: 0, readings: 0, orders: 0, ebook: true })).toBe(
      "Its eBook returns to review; its files, reading positions and annotations are kept.",
    );
    expect(copyDeleteCascadeMessage({ history: 0, targets: 0, readings: 0, orders: 0, ebook: false })).toBeUndefined();
  });
});

describe("keptOrderRefusal", () => {
  it("names the order by its seller and date", () => {
    expect(keptOrderRefusal({ title: "Là-bas", status: "Delivered", venue: "Shakespeare and Company", date: "3 October 2026" })).toBe(
      '"Là-bas" has an order marked Delivered (from Shakespeare and Company, 3 October 2026), which is its acquisition record. Mark the order Returned before deleting the book.',
    );
    expect(keptOrderRefusal({ title: "En route", status: "Received", venue: null, date: null })).toBe(
      '"En route" has an order marked Received, which is its acquisition record. Mark the order Returned before deleting the book.',
    );
  });
});
