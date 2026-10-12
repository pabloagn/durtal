import { READER_FONT_FILES } from "./fonts";

const CACHE_READ_TIMEOUT_MS = 2000;
/** Engine-owned URLs let srcdoc use verified cache bytes read by its controlled parent. */
export function createManagedReaderFontAssets(origin: string, options: {
  match?: (url: string) => Promise<Response | undefined>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
} = {}) {
  const base = new URL(origin).origin;
  const available = !!options.match || typeof caches !== "undefined";
  const match = options.match ?? ((url: string) => caches.match(url));
  const create = options.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revoke = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  const urls = new Map<string, string>();
  let disposed = false;
  let pending: { css: string; controller: AbortController; promise: Promise<string> } | null = null;
  function references(css: string) {
    const selected = new Map<string, typeof READER_FONT_FILES[number]>();
    for (const found of css.matchAll(/url\("([^"\n]+)"\)/g)) {
      const url = new URL(found[1], base);
      const file = READER_FONT_FILES.find(face => face.path === url.pathname);
      // Publisher/embedded/unused legacy resources are not declared reader assets.
      if (!file || url.origin !== base) continue;
      if (url.search || url.hash || url.username || url.password) throw new Error("Invalid reader font asset URL");
      selected.set(found[1], file);
    }
    return selected;
  }
  function rewrite(css: string) {
    for (const [original, file] of references(css)) {
      const url = urls.get(file.path);
      if (url) css = css.replaceAll(`url("${original}")`, `url("${url}")`);
    }
    return css;
  }
  function ready(css: string): string | null {
    if (disposed) throw new DOMException("Reader fonts disposed", "AbortError");
    return !available || [...references(css).values()].every(file => urls.has(file.path)) ? rewrite(css) : null;
  }
  function cancelPending() { pending?.controller.abort(); pending = null; }
  function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(new DOMException("Reader fonts retired", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); reject(new Error("Font cache read timed out")); }, CACHE_READ_TIMEOUT_MS);
      signal.addEventListener("abort", cancel, { once: true });
      work.then(value => { clearTimeout(timer); signal.removeEventListener("abort", cancel); resolve(value); }, error => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(error); });
      if (signal.aborted) cancel();
    });
  }
  async function prepare(css: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (disposed) throw new DOMException("Reader fonts disposed", "AbortError");
    const selected = [...new Map([...references(css).values()].map(file => [file.path, file])).values()].filter(file => !urls.has(file.path));
    if (!available || !selected.length) return rewrite(css);
    if (pending?.css === css) return pending.promise;
    cancelPending();
    const controller = new AbortController(), cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const task = { css, controller, promise: null as unknown as Promise<string> }; pending = task;
    task.promise = (async () => {
      const created: { path: string; url: string }[] = [];
      try {
        const verified = await Promise.all(selected.map(async file => {
          try {
            const cached = await bounded((async () => {
              controller.signal.throwIfAborted();
              const response = await match(new URL(file.path, base).href);
              if (!response || response.status !== 200 || response.redirected) return null;
              const bytes = await response.arrayBuffer();
              controller.signal.throwIfAborted();
              if (bytes.byteLength !== file.bytes) return null;
              const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
              controller.signal.throwIfAborted();
              return hash === file.sha256 ? { file, bytes } : null;
            })(), controller.signal);
            return cached;
          } catch {
            controller.signal.throwIfAborted();
            // A miss/invalid/denied/slow cache preserves normal browser Unicode demand.
            return null;
          }
        }));
        controller.signal.throwIfAborted();
        if (disposed || pending !== task) throw new DOMException("Reader fonts retired", "AbortError");
        for (const entry of verified) {
          if (!entry) continue;
          const url = create(new Blob([entry.bytes], { type: "font/woff2" }));
          created.push({ path: entry.file.path, url });
          if (disposed || controller.signal.aborted) throw new DOMException("Reader fonts retired", "AbortError");
        }
        for (const item of created) urls.set(item.path, item.url);
        return rewrite(css);
      } catch (error) {
        controller.abort(); for (const item of created) revoke(item.url); throw error;
      } finally {
        signal.removeEventListener("abort", cancel); if (pending === task) pending = null;
      }
    })();
    return task.promise;
  }
  return { ready, prepare, cancelPending, dispose() {
    if (disposed) return;
    disposed = true; cancelPending(); for (const url of urls.values()) revoke(url); urls.clear();
  } };
}
