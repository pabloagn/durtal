/**
 * Evidence and guardrails for publisher names (tasks 0171, 0172). Pure module.
 *
 * - Loose name keys: two spellings of one house ("New York Review of Books",
 *   "New York Review Books (NYRB)") share a key once accents, punctuation,
 *   company words ("Ltd", "Publishing", "Books") and parentheses are removed.
 * - ISBN publisher prefixes: every ISBN holds the part that names its
 *   publisher (978-1-59017 is NYRB). Its length varies; isbn3 carries the
 *   official ranges.
 */
import ISBN from "isbn3";
import { normalizeSearchText } from "@/lib/utils/search-text";

/** Words that do not tell two houses apart */
const COMPANY_WORDS = new Set([
  "the", "of", "and", "a",
  "limited", "ltd", "plc", "inc", "incorporated", "llc", "llp", "co",
  "company", "corporation", "corp", "group", "gmbh", "ag", "sa", "srl",
  "bv", "nv", "pty", "pvt",
  "publishing", "publishers", "publisher", "publications", "books", "book",
  "press", "uk", "us", "usa",
]);

function looseKey(text: string): string {
  return normalizeSearchText(text)
    .split(" ")
    .filter((w) => w && !COMPANY_WORDS.has(w))
    // "Classics" and "Classic" are one word
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/**
 * Loose keys of a publisher name: the name without company words and
 * without anything in parentheses or after "a division of", plus each
 * parenthesized part on its own ("NYRB" in "New York Review Books (NYRB)").
 */
export function publisherLooseKeys(name: string): string[] {
  const division = /\ba division of\b.*$/i;
  const main = name.replace(division, "").replace(/\(.*?(\)|$)/g, " ");
  const inner = [...name.matchAll(/\(([^)]*)\)?/g)].map((m) => m[1].replace(division, ""));
  return [...new Set([main, ...inner].map(looseKey).filter(Boolean))];
}

/** The ISBN's publisher prefix, as digits and hyphenated ("978-1-59017") */
export interface IsbnPrefix {
  digits: string;
  label: string;
}

export function isbnPrefix(isbn: string | null | undefined): IsbnPrefix | null {
  const clean = isbn?.replace(/[^0-9Xx]/g, "");
  if (!clean) return null;
  const parsed = ISBN.parse(clean);
  if (!parsed?.isbn13h) return null;
  const [prefix, group, publisher] = parsed.isbn13h.split("-");
  return { digits: prefix + group + publisher, label: `${prefix}-${group}-${publisher}` };
}

/** "978159017" → "978-1-59017" (a stored rule, shown to the reader) */
export function isbnPrefixLabel(digits: string): string {
  // Any full ISBN that starts with the prefix hyphenates the same way
  const body = digits.padEnd(12, "0").slice(0, 12);
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return isbnPrefix(body + ((10 - (sum % 10)) % 10))?.label ?? digits;
}

// ── Guardrails for automatic decisions (task 0172) ──────────────────────────
// Metadata sources send distributors, platforms, placeholders and cut-off
// text as "publisher". Automatic decisions accept a name only when none of
// these apply; everything else waits for a person.

const PLACEHOLDER = /^(unknown|unknown publisher|n\/?a|na|none|various|publisher|not specified|unspecified|s\.? ?n\.?|\[s\.? ?n\.?\]|sine nomine|self|author|tbd|test|null|undefined)$/i;
const PLATFORM = /\b(createspace|create space|independently published|self[- ]?published|kindle direct|kdp|lulu|blurb|lightning source|ingramspark|iuniverse|authorhouse|xlibris|trafford|smashwords|draft2digital|books on demand|bookbaby|amazon|audible|google books)\b/i;
const DISTRIBUTOR = /\b(distribut\w*|publishing services|publisher services|book sales|wholesale\w*|ingram|baker (&|and) taylor|gardners|bertrams|national book network|consortium|perseus|turnaround|publishers group)\b/i;
const PARENT = /\b(division of|imprint of|an imprint|subsidiary of|part of|c\/o)\b/i;
const ADDRESS = /(https?:|www\.|@|\.(com|net|org|co\.uk)\b)/i;
const CUT_OFF = /(\b(of|and|the|for|by|&|a)|[,:;\-/(])\s*$/i;
/** Labels metadata sources put on other publishers' books */
const FOREIGN_LABEL = /^(courier corporation|national geographic books|penguin random house llc|random house publishing services)$/i;

function balanced(text: string) {
  let depth = 0;
  for (const c of text) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Why a publisher name from a metadata source must not be decided
 * automatically, or null when it looks like a plain publisher name.
 * `authors` are the book's authors: a publisher named after its author is
 * usually self-published.
 */
export function publisherNameProblem(
  name: string,
  authors: string[] = [],
): string | null {
  const text = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  const digits = text.replace(/[^0-9]/g, "").length;
  if (letters < 2) return "Not a name";
  if (text.length > 80) return "Too long to be a name";
  if (digits > text.length * 0.3) return "Mostly numbers";
  if (ADDRESS.test(text)) return "Looks like a web or email address";
  if (PLACEHOLDER.test(text)) return "A placeholder, not a publisher";
  if (PLATFORM.test(text)) return "A self-publishing or print-on-demand platform";
  if (DISTRIBUTOR.test(text)) return "Looks like a distributor";
  if (FOREIGN_LABEL.test(text))
    return "A parent or distributor label that sources put on other publishers' books";
  if (PARENT.test(text)) return "Names a parent company";
  if (!balanced(text) || CUT_OFF.test(text) || /^[^\p{L}\p{N}]/u.test(text))
    return "Looks cut off";
  if (/\s:\s|;|\//.test(text)) return "Holds more than one name or a place";
  const own = normalizeSearchText(text);
  if (authors.some((a) => normalizeSearchText(a) === own))
    return "Same as the author: may be self-published";
  return null;
}

const CORPORATE_SUFFIX = /[\s,]+(limited|ltd\.?|plc|inc\.?|incorporated|llc|llp|gmbh|co\.?|corp\.?|corporation|pty\.?( ltd\.?)?)$/i;

/**
 * The name of a house created from source text: no corporate suffix ("Ltd"),
 * no trailing punctuation, and capital initials for text in all capitals.
 */
export function cleanPublisherName(name: string): string {
  const trail = /[\s,.;:]+$/;
  let text = name.trim().replace(/\s+/g, " ").replace(trail, "");
  for (let i = 0; i < 2; i++)
    text = text.replace(CORPORATE_SUFFIX, "").replace(trail, "");
  if (text === text.toUpperCase() && /\p{L}{2}/u.test(text))
    text = text
      .toLowerCase()
      .replace(/(^|[\s\-'’(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
  return text;
}

/** Words too common to tie two publishers together on their own */
const GENERIC_WORDS = new Set([
  "university", "modern", "open", "text", "city", "classic", "library",
  "house", "edition", "world", "international", "american", "british",
  "national", "royal", "little", "great", "first", "free", "black", "white",
  "golden", "silver", "north", "south", "east", "west", "central", "general",
  "academic", "literary", "media", "review", "print", "paper", "paperback",
]);

/** Two-word places that many unrelated publishers carry */
const PLACE_PAIRS = new Set([
  "new york", "los angeles", "san francisco", "new jersey", "new zealand",
  "united state", "united kingdom", "city university",
]);

/**
 * Whether two loose keys may name one publisher family: they share a
 * two-word phrase ("random house" in "Random House Worlds" and "Penguin
 * Random House"), or they start with the same distinctive word
 * ("Bloomsbury Paperbacks", "Bloomsbury Publishing").
 */
export function relatedPublisherKeys(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const wa = a.split(" "),
    wb = b.split(" ");
  const pairs = (w: string[]) =>
    new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
  const pa = pairs(wa);
  for (const pair of pairs(wb))
    if (pa.has(pair) && !PLACE_PAIRS.has(pair)) return true;
  const lead = wa[0];
  return lead.length >= 4 && !GENERIC_WORDS.has(lead) && lead === wb[0];
}

/** The first house key related to `key`, or null */
export function relatedPublisherKey(
  key: string,
  houseKeys: string[],
): string | null {
  return houseKeys.find((other) => relatedPublisherKeys(key, other)) ?? null;
}

/**
 * Whether an edition title can be the same book as the work title: one holds
 * the other ("Dubliners: A Norton Critical Edition"), or at least half of the
 * shorter title's words are shared. A metadata source that answers with
 * another book fails this.
 */
export function sameBookTitle(edition: string, work: string): boolean {
  const x = normalizeSearchText(edition),
    y = normalizeSearchText(work);
  if (!x || !y || x.includes(y) || y.includes(x)) return true;
  const words = (t: string) => new Set(t.split(" ").filter((w) => w.length > 2));
  const a = words(x),
    b = words(y);
  if (!a.size || !b.size) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.min(a.size, b.size) >= 0.5;
}

/** A stable, unique slug for a house: its name and the start of its id */
export function publisherSlug(name: string, id: string): string {
  return `${
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "publisher"
  }-${id.slice(0, 8)}`;
}
