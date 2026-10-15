// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { besideBook, nextInBook, tabbables } from "@/lib/reader/book-tab";

// happy-dom lays nothing out: every element counts as shown unless marked
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.hasAttribute("data-unshown") ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const ids = (els: (HTMLElement | null)[]) => els.map((el) => el?.id ?? null);
const onScreen = (el: HTMLElement) => !el.hasAttribute("data-off");

describe("tabbables", () => {
  it("keeps only controls Tab visits", () => {
    document.body.innerHTML = `
      <a id="a" href="#x">a</a><a id="no-href">b</a>
      <button id="b">b</button><button id="off" disabled>c</button>
      <span id="t" tabindex="0">t</span><span id="minus" tabindex="-1">m</span>
      <div inert><button id="inert">i</button></div>
      <button id="unshown" data-unshown>u</button>
      <input id="hidden" type="hidden" />`;
    expect(ids(tabbables(document))).toEqual(["a", "b", "t"]);
  });
});

describe("nextInBook (SLN-810)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <p><a id="one" href="#1">1</a> <a id="far" href="#f" data-off>far</a> <a id="two" href="#2">2</a></p>`;
  });

  it("starts on the first link on screen, or the last with Shift", () => {
    expect(nextInBook(document, false, onScreen)?.id).toBe("one");
    expect(nextInBook(document, true, onScreen)?.id).toBe("two");
  });

  it("visits the links on screen in order and skips the ones on other pages", () => {
    document.getElementById("one")!.focus();
    expect(nextInBook(document, false, onScreen)?.id).toBe("two");
    document.getElementById("two")!.focus();
    expect(nextInBook(document, true, onScreen)?.id).toBe("one");
  });

  it("gives null once no link is left that way", () => {
    document.getElementById("two")!.focus();
    expect(nextInBook(document, false, onScreen)).toBeNull();
    document.getElementById("one")!.focus();
    expect(nextInBook(document, true, onScreen)).toBeNull();
  });

  it("gives null on a page with no link on it", () => {
    expect(nextInBook(document, false, () => false)).toBeNull();
  });
});

describe("besideBook (SLN-810)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header><button id="back">Back</button><button id="settings">Settings</button></header>
      <main id="reader-book"><button id="inside">in</button></main>
      <div><button id="previous">Previous page</button><button id="next">Next page</button></div>
      <footer><button id="contents">Contents</button></footer>`;
  });

  const book = () => document.getElementById("reader-book")!;

  it("goes to the control after the book, or before it with Shift", () => {
    expect(besideBook(book(), false)?.id).toBe("previous");
    expect(besideBook(book(), true)?.id).toBe("settings");
  });

  it("comes round to the other end when nothing is on that side", () => {
    document.querySelector("header")!.remove();
    expect(besideBook(book(), true)?.id).toBe("contents");
    document.body.innerHTML = `<button id="first">first</button><main id="reader-book"></main>`;
    expect(besideBook(book(), false)?.id).toBe("first");
  });

  it("never picks a control inside the book", () => {
    document.querySelectorAll("header, div, footer").forEach((el) => el.remove());
    expect(besideBook(book(), false)).toBeNull();
  });
});
