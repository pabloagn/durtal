// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { besideBook, enterBook, entersBook, nextInBook, tabbables } from "@/lib/reader/book-tab";

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

describe("entering the book from a bar (SLN-826)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header><button id="back">Back</button><button id="full">Full screen</button></header>
      <div id="book"><span id="inside" tabindex="0">page</span></div>
      <button id="prev">Previous page</button><button id="next">Next page</button>
      <footer><button id="contents">Contents</button></footer>`;
  });
  const book = () => document.getElementById("book")!;
  const el = (id: string) => document.getElementById(id)!;

  it("is the next stop from the top bar's last control, or from the first after the book with Shift", () => {
    expect(entersBook(book(), el("full"), false)).toBe(true);
    expect(entersBook(book(), el("prev"), true)).toBe(true);
  });

  it("is not the next stop from anywhere else", () => {
    expect(entersBook(book(), el("back"), false)).toBe(false);
    expect(entersBook(book(), el("full"), true)).toBe(false);
    expect(entersBook(book(), el("prev"), false)).toBe(false);
    expect(entersBook(book(), el("contents"), false)).toBe(false);
    expect(entersBook(book(), el("contents"), true)).toBe(false);
    expect(entersBook(book(), el("inside"), false)).toBe(false);
  });

  it("is the next stop when nothing lies between the control and the book", () => {
    document.body.innerHTML = `<button id="full">Full screen</button><div id="book"></div>`;
    expect(entersBook(book(), el("full"), false)).toBe(true);
    expect(entersBook(book(), el("full"), true)).toBe(false);
  });
});

describe("enterBook (SLN-826)", () => {
  const section = (html: string) => {
    const doc = document.implementation.createHTMLDocument("section");
    doc.body.innerHTML = html;
    return doc;
  };

  it("lands on the screen's first link going forward and its last going back, across the drawn sections", () => {
    const one = section(`<a id="c1-far" href="#a" data-off>far</a><a id="c1-on" href="#b">on</a>`);
    const two = section(`<a id="c2-on" href="#c">on</a><a id="c2-far" href="#d" data-off>far</a>`);
    expect(enterBook([one, two], false, onScreen)?.id).toBe("c1-on");
    expect(enterBook([one, two], true, onScreen)?.id).toBe("c2-on");
  });

  it("gives null when every link is in another chapter or further on", () => {
    const one = section(`<a id="far" href="#a" data-off>far</a>`);
    expect(enterBook([one], false, onScreen)).toBeNull();
    expect(enterBook([one], true, onScreen)).toBeNull();
    expect(enterBook([], false, onScreen)).toBeNull();
  });
});
