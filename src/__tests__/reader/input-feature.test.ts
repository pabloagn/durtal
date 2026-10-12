// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createReaderInput,
  getReaderShortcuts,
  registerReaderFeatureKey,
  registerReaderKey,
} from "@/lib/reader/input";
describe("owned marking shortcuts", () => {
  it("retains reserved plugin keys and refuses a different feature owner", () => {
    expect(() => registerReaderKey("b", vi.fn())).toThrow("reserves");
    expect(() => registerReaderFeatureKey("b", vi.fn(), 12)).toThrow(
      "does not own",
    );
    expect(() => registerReaderFeatureKey("arrowright", vi.fn(), 3)).toThrow(
      "does not own",
    );
  });
  it("publishes Marking metadata and obeys selection, widgets and modal ownership", () => {
    let selection = false,
      blocked = false;
    const mark = vi.fn(),
      bookmark = vi.fn();
    const input = createReaderInput({
      actions: {
        next: vi.fn(),
        prev: vi.fn(),
        left: vi.fn(),
        right: vi.fn(),
        first: vi.fn(),
        last: vi.fn(),
        toggleBars: vi.fn(),
        contents: vi.fn(),
        settings: vi.fn(),
        fullscreen: vi.fn(),
        escape: vi.fn(),
      },
      hasSelection: () => selection,
      isBlocked: () => blocked,
    });
    const detach = input.attach(document);
    const removeMark = registerReaderFeatureKey("1", mark, 11);
    const removeBookmark = registerReaderFeatureKey("b", bookmark, 11);
    try {
      expect(getReaderShortcuts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "1",
            group: "Marking",
            context: "selection",
            issue: 11,
          }),
        ]),
      );
      const press = (key: string, target: EventTarget = document) =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      press("1");
      expect(mark).not.toHaveBeenCalled();
      selection = true;
      press("1");
      expect(mark).toHaveBeenCalledTimes(1);
      press("b");
      expect(bookmark).toHaveBeenCalledTimes(1);
      const field = document.createElement("textarea");
      document.body.append(field);
      press("b", field);
      field.remove();
      blocked = true;
      press("1");
      press("b");
      expect(mark).toHaveBeenCalledTimes(1);
      expect(bookmark).toHaveBeenCalledTimes(1);
    } finally {
      removeMark();
      removeBookmark();
      detach();
      input.destroy();
    }
    expect(getReaderShortcuts().some((item) => item.key === "1")).toBe(false);
  });
});
