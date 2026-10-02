/**
 * Capitalizes a book title. English titles get title case: every word starts
 * with a capital except articles, short conjunctions and short prepositions
 * in the middle ("The Man Without Qualities", "Far from the Madding Crowd").
 * Titles in other languages use sentence case, where a capital can mark a
 * name, so only safe changes are made there: the first word gets a capital,
 * articles and prepositions get a small letter, other words stay as typed.
 * Pure module, usable on server and client.
 */

/** Small in an English title, except as the first or last word of a clause */
const ENGLISH_MINOR = new Set([
  "a", "an", "the",
  "and", "but", "or", "nor", "for", "as",
  "at", "by", "from", "in", "into", "of", "on", "onto", "per", "to", "upon",
  "via", "vs", "with",
  // Name particles: "Simone de Beauvoir", "Mies van der Rohe"
  "de", "del", "della", "des", "di", "du", "van", "von", "der",
]);

/** Also small as a later part of a compound: "Auto-da-Fé", "Jack-o'-Lantern" */
const COMPOUND_MINOR = new Set([...ENGLISH_MINOR, "da", "à", "o'"]);

/** Words that mark a title as English */
const ENGLISH_MARKERS = new Set([
  "the", "of", "and", "to", "with", "from", "for", "is", "are", "was", "were",
  "on", "at", "by", "my", "your", "his", "her", "its", "our", "their", "this",
  "that", "what", "how", "why", "who", "when", "where", "not", "be", "into",
  "upon", "about",
]);

/** Words that mark a title as Spanish, French, Italian, Portuguese or German */
const FOREIGN_MARKERS = new Set([
  "el", "los", "las", "del", "y", "una", "que", "por", "para", "sobre", "como",
  "le", "les", "des", "du", "et", "une", "au", "aux", "sur", "avec", "pas",
  "ne", "dans", "pour", "est", "qui", "la",
  "il", "gli", "della", "delle", "dello", "degli", "dei", "nel", "nella", "che",
  "dos", "das", "uma",
  "und", "mit", "ein", "eine", "auf", "nicht", "ist", "dem", "zum", "zur",
]);

/** Small in the middle of a title in those languages */
const FOREIGN_MINOR = new Set([
  ...FOREIGN_MARKERS,
  "de", "a", "e", "o", "en", "un", "al", "lo", "der", "die", "von", "van",
  "di", "da", "do", "in", "con", "sin", "per", "ou", "se", "si", "no",
]);

/** Roman numerals that are also names or words: Li Bai, Xi, Liv */
const NOT_ROMAN = new Set(["li", "xi", "ci", "liv"]);

/** A word that ends a clause: the next word starts a subtitle */
const CLAUSE_END = /[:?!][)\]"'”’»]*$/u;

/** A mark between words that starts a subtitle or a second title */
const CLAUSE_BREAK = /^[-—–/:]+$/u;

export function capitalizeTitle(
  title: string,
  /** The form's language code: it decides when the words do not */
  language?: string | null,
): string {
  const text = title.replace(/\s+/g, " ").trim();
  const letters = text.replace(/\P{L}/gu, "");
  if (!letters) return text;

  const english = isEnglishTitle(text, language);
  // A title in capitals shows no names or acronyms: start from small letters
  const shouting =
    letters.length > 1 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase();
  const parts = (shouting ? text.toLowerCase() : text).split(/(\s|—|–)/);

  const words: { index: number; start: boolean; end: boolean }[] = [];
  let afterBreak = true;
  let previous = { word: "", trail: "" };
  parts.forEach((part, index) => {
    if (/[\p{L}\p{N}]/u.test(part)) {
      const [, core, trail] = splitWord(part);
      const word = core.toLowerCase();
      // "Infinite Jest A Novel": a typed capital article after a noun starts
      // a subtitle that has no colon
      const subtitle =
        !shouting &&
        words.length > 0 &&
        /^(A|An|The)$/.test(core) &&
        !ENGLISH_MINOR.has(previous.word);
      if (subtitle) words[words.length - 1].end = true;
      const end = CLAUSE_END.test(part);
      words.push({ index, start: afterBreak || subtitle, end });
      // "Justine, or The Misfortunes of Virtue": a second title
      afterBreak =
        end ||
        (word === "or" && (trail.startsWith(",") || /[,;]$/.test(previous.trail)));
      previous = { word, trail };
    } else if (CLAUSE_BREAK.test(part)) {
      if (words.length) words[words.length - 1].end = true;
      afterBreak = true;
    }
  });
  words[words.length - 1].end = true;

  for (const { index, start, end } of words) {
    parts[index] = english
      ? englishWord(parts[index], start || end, !shouting)
      : foreignWord(parts[index], start);
  }
  return parts.join("");
}

function isEnglishTitle(text: string, language?: string | null): boolean {
  let score = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (ENGLISH_MARKERS.has(word)) score++;
    else if (FOREIGN_MARKERS.has(word)) score--;
  }
  if (score !== 0) return score > 0;
  return !language || language === "en";
}

/** Splits "(Anomaly)," into "(", "Anomaly" and ")," */
function splitWord(token: string): [string, string, string] {
  const [, lead, core, trail] = token.match(
    /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}.]*)$/u,
  )!;
  return [lead, core, trail];
}

function englishWord(token: string, edge: boolean, keepCaps: boolean) {
  const [lead, core, trail] = splitWord(token);
  const compound = core.includes("-");
  // In a compound the first part is always a capital: "Out-of-Print"
  const cased = core
    .split("-")
    .map((part, i) => {
      if (i > 0) return englishPart(part, COMPOUND_MINOR, keepCaps);
      return englishPart(part, edge || compound ? null : ENGLISH_MINOR, keepCaps);
    })
    .join("-");
  return lead + cased + trail;
}

function englishPart(part: string, minor: Set<string> | null, keepCaps: boolean) {
  if (keepCaps && isDeliberate(part)) return part;
  const plain = part.toLowerCase();
  if (isRoman(plain) || /^(\p{L}\.){2,}$/u.test(plain)) return plain.toUpperCase();
  if (minor?.has(plain.replace(/\.$/, ""))) return plain;
  return capitalize(plain);
}

function foreignWord(token: string, start: boolean): string {
  const [lead, core, trail] = splitWord(token);
  const plain = core.toLowerCase();
  let cased = core;
  if (isRoman(plain)) cased = plain.toUpperCase();
  // "L'Étranger": the article and the word after it
  else if (start)
    cased = capitalize(core).replace(/^([LD]['’])(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  else if (FOREIGN_MINOR.has(plain)) cased = plain;
  return lead + cased + trail;
}

/**
 * Capitals the typer chose on purpose: "McCarthy", "iPhone", "USA", "H.P.",
 * "1Q84". A small word in capitals ("THE") is not one.
 */
function isDeliberate(part: string): boolean {
  if (/\p{N}/u.test(part)) return true;
  const letters = part.replace(/\P{L}/gu, "");
  if (/\p{Ll}/u.test(letters) && /\p{Lu}/u.test(letters.slice(1))) return true;
  return (
    letters.length > 1 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase() &&
    !ENGLISH_MINOR.has(letters.toLowerCase())
  );
}

/** Volume and part numbers: "II", "XIV" */
function isRoman(word: string): boolean {
  return (
    word.length > 1 &&
    !NOT_ROMAN.has(word) &&
    /^c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(word)
  );
}

function capitalize(word: string): string {
  return word.replace(/^\p{L}/u, (c) => c.toUpperCase());
}
