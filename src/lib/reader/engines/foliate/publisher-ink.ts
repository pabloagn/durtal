import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import { adaptTextColour, READER_THEMES } from "../../presentation/themes";
import { compositeColour } from "../../presentation/contrast";
import { speechYield } from "../../speech/dom-sentences";
interface Ink { hex: string; alpha: number }
/** Native computed CSS resolves named colours, inheritance and variables first.
 * Unsupported native spaces fall back to approved theme ink; transparent text stays hidden. */
export function computedPublisherInk(value: string): Ink | null {
  if (/^#[\da-f]{6}$/i.test(value)) return { hex: value.toLowerCase(), alpha: 1 };
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  const srgb = value.match(/^color\(srgb\s+([^)]+)\)$/i);
  if (!match && !srgb) return null;
  const parts = (match?.[1] ?? srgb![1]).replace(/[,/]/g," ").trim().split(/\s+/);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channel = (input: string) => input.endsWith("%") ? parseFloat(input)*2.55 : Number(input)*(srgb ? 255 : 1);
  const rgb = parts.slice(0,3).map(channel), alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3])/100 : Number(parts[3]);
  if (!rgb.every(Number.isFinite) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  return { hex: `#${rgb.map(n => Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,"0")).join("")}`, alpha };
}
/** Mask native foreground only during a synchronous capture slice.
 * Backgrounds, media and font sheets remain installed; restore before yielding.
 * Mask color-scheme too so UA/system colours retain the publisher's source value. */
function maskReaderForeground(doc: Document): (() => void) | undefined {
  const sheet = doc.querySelector<HTMLStyleElement>("style[data-durtal-page-colours]")?.sheet;
  if (!sheet || sheet.disabled) return;
  const declarations: { style: CSSStyleDeclaration; name: string; value: string; priority: string }[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (!("style" in rule)) continue;
    const style = (rule as CSSStyleRule).style;
    for (const name of ["color", "color-scheme"]) {
      const value = style.getPropertyValue(name);
      if (value) declarations.push({ style, name, value, priority: style.getPropertyPriority(name) });
    }
  }
  if (!declarations.length) return;
  const restore = () => {
    for (const { style, name, value, priority } of declarations)
      style.setProperty(name, value, priority);
  };
  try {
    for (const { style, name } of declarations) style.removeProperty(name);
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}
interface SourceInk { ink: Ink | null }
interface Job { owner: AbortController; done: Promise<void> }
/** Read original publisher ink before any writes; separately bounded writes affect colour alone. */
export class PublisherInk {
  #original = new WeakMap<HTMLElement, SourceInk>();
  #jobs = new WeakMap<Document, Job>();
  constructor(private onError: (error: unknown) => void = () => {}) {}
  apply(doc: Document, presentation: ReaderPresentation, lifetime: AbortSignal): void {
    this.#jobs.get(doc)?.owner.abort();
    const owner = new AbortController(), signal = AbortSignal.any([owner.signal,lifetime]);
    const done = this.#apply(doc,presentation,signal);
    this.#jobs.set(doc,{ owner, done });
    void done.catch(error => { if (!signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) this.onError(error); });
  }
  async ready(doc: Document, signal: AbortSignal): Promise<void> {
    for (;;) { const job = this.#jobs.get(doc); if (!job) return;
      try {
        await new Promise<void>((resolve,reject) => {
          signal.throwIfAborted();
          const finish = (error?: unknown) => { clearTimeout(timer); signal.removeEventListener("abort",cancel); if (error) reject(error); else resolve(); };
          const cancel = () => finish(signal.reason ?? new DOMException("Cancelled","AbortError"));
          const timer = setTimeout(() => finish(new Error("Book colours took too long to prepare.")),30000);
          signal.addEventListener("abort",cancel,{ once: true }); job.done.then(() => finish(),finish);
        });
      } catch (error) { if (signal.aborted || this.#jobs.get(doc) === job) throw error; }
      if (this.#jobs.get(doc) === job) return;
    }
  }
  async #apply(doc: Document, p: ReaderPresentation, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); if (!doc.body || !doc.defaultView) return;
    const walker = doc.createTreeWalker(doc.body,4); // SHOW_TEXT, scoped to the opened page.
    const elements: HTMLElement[] = [], seen = new Set<Element>();
    let node: Node | null = null;
    // Never disable font-face or typography sheets; that can invalidate native font layout.
    for (;;) {
      let restoreForeground: (() => void) | undefined;
      let foregroundMasked = false;
      let more = false;
      const started = performance.now();
      try {
        for (let count = 0; count < 128; count++) {
          if (count > 0 && performance.now()-started >= 8) break;
          signal.throwIfAborted(); node = walker.nextNode(); if (!node) break; more = true;
          const element = node.parentElement;
          if (!node.textContent?.trim() || !element || seen.has(element) || element.closest("svg,math,script,style")) continue;
          seen.add(element); const html = element as HTMLElement;
          if (!this.#original.has(html)) {
            if (!foregroundMasked) {
              restoreForeground = maskReaderForeground(doc);
              foregroundMasked = true;
            }
            this.#original.set(html,{ ink: computedPublisherInk(doc.defaultView!.getComputedStyle(html).color) });
          }
          elements.push(html);
        }
      } finally { restoreForeground?.(); }
      if (!more || node === null) break;
      await speechYield(signal);
      const frame = doc.defaultView?.frameElement;
      if (frame && !frame.isConnected) throw new DOMException("Retired book page","AbortError");
    }
    signal.throwIfAborted();
    const colours = new Map<string,string>();
    let started = performance.now();
    for (let index = 0; index < elements.length; index++) {
      signal.throwIfAborted(); const element = elements[index], source = this.#original.get(element)!;
      const ink = source.ink; if (ink?.alpha === 0) continue;
      const original = ink ? compositeColour(ink.hex,READER_THEMES[p.theme].background,ink.alpha) : READER_THEMES[p.theme].text;
      let adapted = colours.get(original); if (!adapted) { adapted = adaptTextColour(original,p); colours.set(original,adapted); }
      element.style.setProperty("color",adapted,"important");
      if ((index+1)%128 === 0 || performance.now()-started >= 8) { await speechYield(signal); started = performance.now(); }
    }
    // Captures stay in WeakMaps; page retirement releases DOM and native jobs through lifetime.
  }
}
