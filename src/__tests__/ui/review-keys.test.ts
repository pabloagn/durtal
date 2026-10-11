// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { reviewKeyAllowed } from "@/hooks/use-review-keys";

describe("review-only keyboard guards", () => {
  it("accepts ordinary review keys and refuses unrelated keys", () => {
    expect(reviewKeyAllowed(new KeyboardEvent("keydown", { key: "j" }), false)).toBe(true);
    expect(reviewKeyAllowed(new KeyboardEvent("keydown", { key: "f" }), false)).toBe(false);
  });
  it.each([{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }])("refuses guarded key %j", (guard) => {
    expect(reviewKeyAllowed(new KeyboardEvent("keydown", { key: "a", ...guard }), false)).toBe(false);
  });
  it("refuses typing targets, dialogs and pending operations", () => {
    const input = document.createElement("input"); const event = new KeyboardEvent("keydown", { key: "n" });
    Object.defineProperty(event, "target", { value: input });
    expect(reviewKeyAllowed(event, false)).toBe(false);
    expect(reviewKeyAllowed(new KeyboardEvent("keydown", { key: "n" }), true)).toBe(false);
  });
  it("does not take an already handled key", () => {
    const event = new KeyboardEvent("keydown", { key: "x", cancelable: true }); event.preventDefault();
    expect(reviewKeyAllowed(event, false)).toBe(false);
  });
});
