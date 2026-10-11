import type { TranslatorAvailability } from "./translate";
import { MAX_TRANSLATION_CHARACTERS } from "./candidates";
import { LOOKUP_LIMITS } from "./policy";
interface DeviceTranslator {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface TranslatorFactory {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorAvailability>;
  create(options: { sourceLanguage: string; targetLanguage: string; signal: AbortSignal;
    monitor?(monitor: EventTarget): void }): Promise<DeviceTranslator>;
}
/** Native feature detection only. https://developer.chrome.com/docs/ai/translator-api */
function nativeTranslator(): TranslatorFactory | null {
  if (typeof self === "undefined" || !("Translator" in self)) return null;
  const api = (self as typeof self & { Translator?: TranslatorFactory }).Translator;
  return api && typeof api.availability === "function" && typeof api.create === "function" ? api : null;
}
async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export class BrowserLookupTranslator {
  private pairs = new Map<string, DeviceTranslator>();
  private closed = false;
  async availability(source: string, target: string, signal: AbortSignal): Promise<TranslatorAvailability | null> {
    if (this.closed) return null;
    const api = nativeTranslator();
    if (!api) return null;
    if (this.pairs.has(source + ":" + target)) return "available";
    const value = await bounded(api.availability({ sourceLanguage: source, targetLanguage: target }), signal);
    return ["available", "downloadable", "downloading", "unavailable"].includes(value) ? value : null;
  }
  /** Call synchronously from Download's click: no availability await consumes activation. */
  async translate(source: string, target: string, text: string, signal: AbortSignal,
    progress?: (value: number) => void): Promise<string> {
    if (this.closed || !text.trim() || text.length > MAX_TRANSLATION_CHARACTERS)
      throw new Error("Select at most 1,000 characters to translate");
    signal.throwIfAborted();
    const api = nativeTranslator();
    if (!api) throw new Error("Translation on this device is unavailable");
    const key = source + ":" + target;
    let translator = this.pairs.get(key);
    if (!translator) {
      const created = api.create({
        sourceLanguage: source, targetLanguage: target, signal,
        monitor: monitor => {
          monitor.addEventListener("downloadprogress", event => {
            if (!signal.aborted && !this.closed) {
              const loaded = (event as Event & { loaded: number }).loaded;
              if (Number.isFinite(loaded)) progress?.(Math.max(0, Math.min(1, loaded)));
            }
          }, { signal });
        },
      });
      // A late native result after cancellation must release its model/session.
      void created.then(value => { if (signal.aborted || this.closed) value.destroy(); }).catch(() => {});
      translator = await bounded(created, signal);
      if (this.closed || signal.aborted) { translator.destroy(); signal.throwIfAborted(); throw new Error("Lookup closed"); }
      if (this.pairs.size >= LOOKUP_LIMITS.translatorPairs) {
        const oldest = this.pairs.keys().next().value!;
        this.pairs.get(oldest)!.destroy(); this.pairs.delete(oldest);
      }
      this.pairs.set(key, translator);
    }
    const current = translator;
    const abort = () => { current.destroy(); if (this.pairs.get(key) === current) this.pairs.delete(key); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await bounded(current.translate(text, { signal }), signal);
      if (result.length > 10000) throw new Error("The translation is too long");
      this.pairs.delete(key); this.pairs.set(key, current);
      return result;
    } catch (error) { abort(); throw error; }
    finally { signal.removeEventListener("abort", abort); }
  }
  close() { this.closed = true; for (const value of this.pairs.values()) value.destroy(); this.pairs.clear(); }
}
