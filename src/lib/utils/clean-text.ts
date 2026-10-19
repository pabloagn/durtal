/**
 * Text as typed or pasted, ready to store (SLN-1393). Pure module.
 *
 * A title or name copied from a web page or an e-book can carry characters
 * that show nothing: a soft hyphen, a zero-width space, a byte order mark,
 * bidi marks. Kept, they make "Ver\u00adschwinden" a different title from
 * "Verschwinden", so search and duplicate checks miss it. The zero-width
 * joiners (U+200C, U+200D) stay: Persian, Indic scripts and emoji need them.
 * So does the Mongolian vowel separator (U+180E), which shapes the letters
 * around it. Direction marks go: they change nothing a reader sees in a title.
 * The result is in NFC, so a decomposed "é" and a composed one are equal.
 */
const INVISIBLE = /[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;

export function cleanText(text: string): string {
  return text.replace(INVISIBLE, "").normalize("NFC");
}
