/** Keep each initial's combining marks and supplementary characters intact. */
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
export function nameInitials(name: string): string {
  const words = name.normalize("NFC").replace(/[^\p{L}\p{M}\s]/gu, " ").trim().split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const first = (word: string) => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? "?";
  if (!words.length) return "?";
  return first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "");
}
