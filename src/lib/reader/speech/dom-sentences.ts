import {
  excludeSpeechNode,
  speechBlockLanguage,
  SPEECH_EXTRACTION_LIMITS,
} from "./segmentation-policy";

const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre,div,body";
const abort = (signal: AbortSignal) => signal.throwIfAborted();
/** Owned, abortable yielding; no persistent idle loop. */
export function speechYield(signal: AbortSignal): Promise<void> {
  abort(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, 0);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
function accepted(node: Text) {
  for (
    let element = node.parentElement;
    element;
    element = element.parentElement
  ) {
    if (
      element.hasAttribute("hidden") ||
      element.getAttribute("aria-hidden") === "true" ||
      excludeSpeechNode({
        tag: element.localName,
        epubTypes:
          element.getAttribute("epub:type") ??
          element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ??
          undefined,
        role: element.getAttribute("role") ?? undefined,
      })
    )
      return false;
  }
  return true;
}
function language(node: Text, fallback: string | null) {
  const ancestors: { lang: string | null; xmlLang: string | null }[] = [];
  for (
    let element = node.parentElement;
    element;
    element = element.parentElement
  )
    ancestors.push({
      lang: element.getAttribute("lang"),
      xmlLang: element.getAttribute("xml:lang"),
    });
  return speechBlockLanguage(ancestors, fallback);
}
export interface DomSpeechSentence {
  range: Range;
  text: string;
  lang: string;
}
/** Real text-node ranges, segmented per block/language; no image alt or ruby readings. */
export async function* domSpeechSentences(
  doc: Document,
  fallback: string | null,
  signal: AbortSignal,
): AsyncGenerator<DomSpeechSentence> {
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, 4);
  let nodes: Text[] = [],
    starts: number[] = [],
    raw = "",
    block: Element | null = null,
    lang = "und";
  let visited = 0,
    slice = performance.now();
  const point = (offset: number): [Text, number] => {
    let at = starts.length - 1;
    while (at > 0 && starts[at] >= offset) at--;
    return [nodes[at], Math.min(nodes[at].length, offset - starts[at])];
  };
  async function* flush(): AsyncGenerator<DomSpeechSentence> {
    if (!raw.trim()) return;
    const segmenter = new Intl.Segmenter(lang === "und" ? undefined : lang, {
      granularity: "sentence",
    });
    for (const sentence of segmenter.segment(raw)) {
      abort(signal);
      const text = sentence.segment.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const from =
        sentence.index + (sentence.segment.match(/^\s*/)?.[0].length ?? 0);
      const to = sentence.index + sentence.segment.trimEnd().length;
      const range = doc.createRange();
      range.setStart(...point(from));
      range.setEnd(...point(to));
      yield { range, text, lang };
      if (
        ++visited >= SPEECH_EXTRACTION_LIMITS.sliceNodes ||
        performance.now() - slice >= SPEECH_EXTRACTION_LIMITS.sliceMs
      ) {
        await speechYield(signal);
        visited = 0;
        slice = performance.now();
      }
    }
  }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    abort(signal);
    const text = node as Text;
    if (accepted(text)) {
      const nextBlock =
        text.parentElement?.closest(BLOCKS) ?? doc.documentElement;
      const nextLang = language(text, fallback);
      if (nextBlock !== block || nextLang !== lang) {
        yield* flush();
        nodes = [];
        starts = [];
        raw = "";
        block = nextBlock;
        lang = nextLang;
      }
      // Pathological single blocks fail visibly instead of allocating unbounded mappings.
      if (raw.length + text.length > 1_000_000)
        throw new Error("This text block is too large to read aloud.");
      starts.push(raw.length);
      nodes.push(text);
      raw += text.data;
    }
    if (
      ++visited >= SPEECH_EXTRACTION_LIMITS.sliceNodes ||
      performance.now() - slice >= SPEECH_EXTRACTION_LIMITS.sliceMs
    ) {
      await speechYield(signal);
      visited = 0;
      slice = performance.now();
    }
  }
  yield* flush();
}
