// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublisherInk, computedPublisherInk } from "@/lib/reader/engines/foliate/publisher-ink";
import { preparePageInk } from "@/lib/reader/engines/foliate/page-ink-preparation";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { adaptTextColour, themeColours } from "@/lib/reader/presentation/themes";
import { bookCSS } from "@/lib/reader/presentation/book-css";
import { dispatchPreparedLoad, ownedDocumentLoad, waitForDocumentLoad } from "@/vendor/foliate-js/load-preparation.js";
const frames: HTMLIFrameElement[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); frames.splice(0).forEach(frame => frame.remove()); });
function page() {
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { visibility: "hidden", width: "640px", height: "480px" });
  document.body.append(frame); frames.push(frame);
  const doc = frame.contentDocument!;
  doc.body.style.color = "rgb(120,0,0)";
  doc.body.style.fontSize = "21px";
  doc.body.innerHTML = "<p>Inherited ink</p>".repeat(260);
  doc.querySelectorAll("p")[128].setAttribute("style", "color:rgba(0,0,0,0)");
  const publisher = doc.createElement("style");
  publisher.textContent = "p:nth-child(2) { color:rgb(0,0,120); } @font-face { font-family: Publisher; src: local(Georgia); }";
  doc.head.append(publisher);
  return { frame, doc, publisher };
}
describe("publisher ink in owned load preparation", () => {
  it("captures native inherited/selector/transparent ink before theme installation and publishes the latest policy", async () => {
    vi.useFakeTimers();
    const { frame, doc, publisher } = page();
    const native = doc.defaultView!.getComputedStyle.bind(doc.defaultView);
    const compute = vi.spyOn(doc.defaultView!, "getComputedStyle").mockImplementation((element, pseudo) => {
      expect(doc.querySelector("style[data-durtal-page-colours]")).toBeNull();
      expect(frame.style.visibility).toBe("hidden");
      expect(publisher.sheet!.disabled).not.toBe(true);
      return native(element, pseudo);
    });
    const ink = new PublisherInk(), owner = new AbortController();
    let policy = PRESENTATION_DEFAULTS.desktop;
    const install = vi.fn(() => {
      ink.apply(doc, policy, owner.signal);
      const style = doc.createElement("style");
      style.setAttribute("data-durtal-page-colours", "");
      style.textContent = bookCSS(policy, themeColours(policy)).colours;
      doc.head.append(style);
    });
    const target = new EventTarget();
    target.addEventListener("load", event => {
      const detail = (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail;
      detail.waitUntil(preparePageInk(ink, doc, owner.signal, install));
    });
    let prepared = false;
    const loading = dispatchPreparedLoad(target, { doc, index: 0, signal: owner.signal }).then(() => { prepared = true; });
    expect(prepared).toBe(false); expect(install).not.toHaveBeenCalled();
    policy = { ...policy, theme: "paper" };
    await Promise.all([loading, vi.runAllTimersAsync()]);
    expect(prepared).toBe(true); expect(install).toHaveBeenCalledOnce();
    expect(compute).toHaveBeenCalledTimes(260);
    expect(computedPublisherInk((doc.querySelector("p") as HTMLElement).style.color)?.hex).toBe(adaptTextColour("#780000", policy));
    expect(computedPublisherInk((doc.querySelectorAll("p")[1] as HTMLElement).style.color)?.hex).toBe(adaptTextColour("#000078", policy));
    expect(computedPublisherInk((doc.querySelectorAll("p")[128] as HTMLElement).style.color)?.alpha).toBe(0);
    expect(frame.style.visibility).toBe("hidden");
    expect(frame.style.width).toBe("640px"); expect(frame.style.height).toBe("480px");
    expect(doc.body.style.fontSize).toBe("21px"); expect(publisher.sheet!.disabled).not.toBe(true);
  });
  it("cancels hidden document preparation before any theme or adapted ink can be installed", async () => {
    vi.useFakeTimers();
    const { frame, doc } = page();
    const opening = new AbortController(), load = new AbortController();
    const signal = AbortSignal.any([opening.signal, load.signal]);
    const install = vi.fn(), ink = new PublisherInk();
    const pending = expect(preparePageInk(ink, doc, signal, install)).rejects.toHaveProperty("name", "AbortError");
    load.abort();
    await pending;
    expect(install).not.toHaveBeenCalled();
    expect(doc.querySelector("style[data-durtal-page-colours]")).toBeNull();
    expect((doc.querySelector("p") as HTMLElement).style.color).toBe("");
    expect(frame.style.visibility).toBe("hidden");
    expect(opening.signal.aborted).toBe(false);
  });
  it("propagates the original native source-colour failure without installing a theme", async () => {
    const { doc } = page();
    const error = new Error("native source failure"), install = vi.fn();
    vi.spyOn(doc.defaultView!, "getComputedStyle").mockImplementation(() => { throw error; });
    await expect(preparePageInk(new PublisherInk(), doc, new AbortController().signal, install)).rejects.toBe(error);
    expect(install).not.toHaveBeenCalled();
  });
  it("holds the load for all registered preparation and rejects late registration", async () => {
    const target = new EventTarget();
    let finish!: () => void, waitUntil!: (promise: Promise<void>) => void;
    const slow = new Promise<void>(resolve => { finish = resolve; });
    target.addEventListener("load", event => {
      waitUntil = (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail.waitUntil;
      waitUntil(Promise.resolve()); waitUntil(slow);
    });
    let done = false;
    const loading = dispatchPreparedLoad(target, {}).then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false);
    expect(() => waitUntil(Promise.resolve())).toThrow();
    finish(); await loading; expect(done).toBe(true);
  });
  it("preserves a preparation rejection as the load failure", async () => {
    const target = new EventTarget(), error = new Error("preparation failure");
    target.addEventListener("load", event => (event as CustomEvent<{ waitUntil: (promise: Promise<void>) => void }>).detail.waitUntil(Promise.reject(error)));
    await expect(dispatchPreparedLoad(target, {})).rejects.toBe(error);
  });
  it("settles a destroyed load even when the iframe never emits load", async () => {
    const owner = new AbortController(), setup = vi.fn();
    const ready = ownedDocumentLoad(owner.signal, setup);
    expect(setup).toHaveBeenCalledOnce();
    owner.abort();
    await expect(ready).resolves.toBeUndefined();
    const closed = new AbortController(); closed.abort();
    const neverStart = vi.fn();
    await expect(ownedDocumentLoad(closed.signal, neverStart)).resolves.toBeUndefined();
    expect(neverStart).not.toHaveBeenCalled();
  });
  it("preserves a genuine load error when its owner is aborted during cleanup", async () => {
    const owner = new AbortController(), error = new Error("load failure");
    const ready = ownedDocumentLoad(owner.signal, (_finish: () => void, fail: (error: unknown) => void) => {
      fail(error); owner.abort();
    });
    await expect(ready).rejects.toBe(error);
  });
  it("cached navigation waits for a replacement load rather than the retired readiness", async () => {
    let finishFirst!: () => void, finishSecond!: () => void;
    const first = new Promise<void>(resolve => { finishFirst = resolve; });
    const second = new Promise<void>(resolve => { finishSecond = resolve; });
    const view = { ready: first };
    let arrived = false;
    const waiting = waitForDocumentLoad(view).then(() => { arrived = true; });
    view.ready = second; finishFirst();
    await Promise.resolve(); await Promise.resolve();
    expect(arrived).toBe(false);
    finishSecond(); await waiting; expect(arrived).toBe(true);
  });
});
