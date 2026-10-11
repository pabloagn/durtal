import { speechLanguage } from "./voices";

/** Pure policies; DOM walking, sentence segmentation and PDF access remain adapter-owned. */
export interface SentenceSpan {
  start: number;
  end: number;
}
export type SentenceStart =
  | { kind: "locator"; offset: number }
  | { kind: "visible"; start: number; end: number };

/** Locator: containing sentence, else the next. Visible: first intersecting sentence. */
export function firstSpeechSentence(
  spans: Iterable<SentenceSpan>,
  from: SentenceStart,
): number | null {
  const start = from.kind === "locator" ? from.offset : from.start;
  if (
    !Number.isFinite(start) ||
    start < 0 ||
    (from.kind === "visible" &&
      (!Number.isFinite(from.end) || from.end <= start))
  )
    return null;
  let index = 0;
  for (const span of spans) {
    if (
      Number.isFinite(span.start) &&
      Number.isFinite(span.end) &&
      span.start >= 0 &&
      span.end > span.start
    ) {
      if (
        from.kind === "locator"
          ? span.end > start
          : span.end > start && span.start < from.end
      )
        return index;
      if (from.kind === "visible" && span.start >= from.end) return null;
    }
    index++;
  }
  return null;
}

export interface SpeechNodePolicy {
  tag: string;
  epubTypes?: string;
  role?: string;
  noteReference?: boolean;
  referencedNoteAside?: boolean;
  rejectedAncestor?: boolean;
}
const EXCLUDED_TYPES = new Set([
  "footnote",
  "endnote",
  "rearnote",
  "pagebreak",
]);
const EXCLUDED_ROLES = new Set([
  "doc-noteref",
  "doc-footnote",
  "doc-endnote",
  "doc-pagebreak",
]);
const tokens = (value: string | undefined) => value?.trim().split(/\s+/) ?? [];
export function excludeSpeechNode(node: SpeechNodePolicy): boolean {
  const tag = node.tag.toLowerCase();
  return (
    !!node.rejectedAncestor ||
    !!node.noteReference ||
    (tag === "aside" && !!node.referencedNoteAside) ||
    ["rt", "rp", "script", "style"].includes(tag) ||
    tokens(node.epubTypes).some((type) => EXCLUDED_TYPES.has(type)) ||
    tokens(node.role).some((role) => EXCLUDED_ROLES.has(role))
  );
}

/** Only accepted text nodes enter this function; image attributes never do. */
export function speechText(
  parts: Iterable<{ text: string; excluded: boolean }>,
): string {
  let text = "";
  for (const part of parts) if (!part.excluded) text += part.text;
  return text.replace(/\s+/g, " ").trim();
}
export function speechSectionIsLinear(linear: string | undefined): boolean {
  return linear !== "no";
}

/** Automatic movement is real progress, never evidence of human activity. */
export const SPEECH_MOVEMENT_POLICY = Object.freeze({
  origin: "speech" as const,
  savePosition: true,
  humanActivity: false,
  samplePace: false,
  confirmCompletion: false,
});

/** Ancestors arrive nearest first, including the text node's own element. */
export function speechBlockLanguage(
  ancestors: Iterable<{ lang?: string | null; xmlLang?: string | null }>,
  bookLanguage: string | null,
): string {
  for (const ancestor of ancestors) {
    const lang =
      speechLanguage(ancestor.xmlLang) ?? speechLanguage(ancestor.lang);
    if (lang) return lang;
  }
  return speechLanguage(bookLanguage) ?? "und";
}

export const SPEECH_EXTRACTION_LIMITS = Object.freeze({
  residentSections: 2,
  previousSentences: 1,
  nextSentences: 1,
  sliceMs: 8,
  sliceNodes: 128,
});
