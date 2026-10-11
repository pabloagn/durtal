// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createReaderInput, type ReaderActions } from "@/lib/reader/input";
it("routes actual speech keys on book documents, blocking repeats, modifiers, editable fields and modal contexts", () => {
  const speech = vi.fn(),
    sentence = vi.fn();
  const noop = () => {};
  const actions: ReaderActions = {
    next: noop,
    prev: noop,
    left: noop,
    right: noop,
    first: noop,
    last: noop,
    toggleBars: noop,
    contents: noop,
    settings: noop,
    fullscreen: noop,
    escape: noop,
    speech,
    sentence,
  };
  let blocked = false;
  const input = createReaderInput({ actions, isBlocked: () => blocked });
  const book = document.implementation.createHTMLDocument("book");
  input.attach(book);
  const press = (
    key: string,
    options: KeyboardEventInit = {},
    target: EventTarget = book,
  ) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  try {
    press("a");
    press(",");
    press(".");
    expect(speech).toHaveBeenCalledOnce();
    expect(sentence.mock.calls).toEqual([["previous"], ["next"]]);
    for (const options of [
      { repeat: true },
      { shiftKey: true },
      { ctrlKey: true },
      { isComposing: true },
    ])
      press("a", options);
    blocked = true;
    press("a");
    blocked = false;
    const field = book.createElement("textarea");
    book.body.append(field);
    press("a", {}, field);
    expect(speech).toHaveBeenCalledOnce();
  } finally {
    input.destroy();
  }
});
