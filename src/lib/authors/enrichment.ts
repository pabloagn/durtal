/**
 * Author enrichment (pure): which Wikidata person is the catalogue's author,
 * and what may be filled from it. A person counts only when the name fits
 * and nothing the catalogue knows contradicts it; a match needs evidence
 * (one of the author's books, or dates that agree). Only empty fields are
 * filled. Values that disagree are reported, never overwritten, except a
 * year before Christ stored without its sign.
 *
 * Images are never read or written: posters, backgrounds and photos are
 * chosen by hand (AUTHOR_FILL_COLUMNS holds every column a run may write).
 */
import { normalizeSearchText } from "@/lib/utils/search-text";
import { computeZodiacSign } from "@/lib/utils/zodiac";
import type {
  LabelItem,
  PersonItem,
  PlaceItem,
  WikidataTime,
  WorkHit,
} from "@/lib/authors/wikidata";

export type Gender = "male" | "female";

/**
 * Every authors column an enrichment run may write. Names, slugs, photos,
 * media and the metadata source are not among them.
 */
export const AUTHOR_FILL_COLUMNS = [
  "birth_year",
  "birth_month",
  "birth_day",
  "birth_year_is_approximate",
  "birth_year_gregorian",
  "death_year",
  "death_month",
  "death_day",
  "death_year_is_approximate",
  "death_year_gregorian",
  "zodiac_sign",
  "gender",
  "nationality_id",
  "birth_place_id",
  "death_place_id",
  "real_name",
  "website",
  "open_library_key",
  "goodreads_id",
  "bio",
] as const;
export type AuthorFillColumn = (typeof AUTHOR_FILL_COLUMNS)[number];

export interface CatalogueDate {
  year: number | null;
  month: number | null;
  day: number | null;
  approximate: boolean;
  gregorian: number | null;
}

export interface AuthorEvidence {
  id: string;
  slug: string | null;
  name: string;
  sortName: string | null;
  firstName: string | null;
  lastName: string | null;
  realName: string | null;
  aliases: string[];
  gender: Gender | null;
  /** ISO 3166-1 alpha-2 */
  nationality: string | null;
  birth: CatalogueDate;
  death: CatalogueDate;
  birthPlaceId: string | null;
  deathPlaceId: string | null;
  bio: string | null;
  website: string | null;
  openLibraryKey: string | null;
  goodreadsId: string | null;
  zodiacSign: string | null;
  works: { title: string; year: number | null }[];
}

// ── Names ───────────────────────────────────────────────────────────────────

const HONORIFIC = /^(sir|dame|saint|st|lord|lady|dr|rev|father)\.?\s+/i;
const PARTICLES = new Set([
  "de", "del", "della", "di", "da", "das", "dos", "do", "du", "des", "la",
  "le", "van", "von", "der", "den", "ten", "y", "e", "al", "el", "bin", "ibn",
]);

const invert = (s: string | null) => {
  const parts = (s ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : null;
};

/** The forms of the author's name to search for and to compare with */
export function nameForms(a: AuthorEvidence): string[] {
  const raw = [
    a.name,
    invert(a.name),
    a.realName,
    invert(a.sortName),
    a.firstName && a.lastName ? `${a.firstName} ${a.lastName}` : null,
    ...a.aliases,
  ];
  const forms: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r) continue;
    const clean = r.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
    for (const f of [clean, clean.replace(HONORIFIC, "")]) {
      const k = normalizeSearchText(f);
      if (k && !seen.has(k)) {
        seen.add(k);
        forms.push(f);
      }
    }
  }
  return forms;
}

const words = (k: string) => k.split(" ").filter(Boolean);
const sortedKey = (k: string) => [...words(k)].sort().join(" ");
const coreKey = (k: string) =>
  words(k).filter((w) => w.length > 1 && !PARTICLES.has(w)).join(" ");

/** Same family name; every given name of the shorter fits one of the other, initials too */
function initialsFit(a: string, b: string): boolean {
  const x = words(a),
    y = words(b);
  if (x.length < 2 || y.length < 2 || x.at(-1) !== y.at(-1)) return false;
  const [few, many] = x.length <= y.length ? [x, y] : [y, x];
  const fits = (u: string, v: string) =>
    u === v || (u.length === 1 && v.startsWith(u)) || (v.length === 1 && u.startsWith(v));
  let j = 0;
  for (const u of few.slice(0, -1)) {
    while (j < many.length - 1 && !fits(u, many[j])) j++;
    if (j >= many.length - 1) return false;
    j++;
  }
  return true;
}

/**
 * How well a Wikidata name fits the author's: 4 the label is a form of the
 * name; 3 an alias is, or the same words in another order, or the same
 * without particles and initials; 2 the same family name with fitting given
 * names or initials; 1 a one-word name that is the family name; -1 none.
 */
export function nameRank(forms: string[], label: string | null, aliases: string[]): number {
  const fk = forms.map(normalizeSearchText).filter(Boolean);
  const lk = label ? normalizeSearchText(label) : "";
  const ak = aliases.map(normalizeSearchText).filter(Boolean);
  if (lk && fk.includes(lk)) return 4;
  if (ak.some((a) => fk.includes(a))) return 3;
  const names = [lk, ...ak].filter(Boolean);
  if (names.some((n) => fk.some((f) => sortedKey(f) === sortedKey(n)))) return 3;
  if (names.some((n) => fk.some((f) => coreKey(f).includes(" ") && coreKey(f) === coreKey(n))))
    return 3;
  if (names.some((n) => fk.some((f) => initialsFit(f, n)))) return 2;
  if (names.some((n) => fk.some((f) => !f.includes(" ") && f.length > 3 && words(n).at(-1) === f)))
    return 1;
  return -1;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** Julian day number of a civil date in the Julian or the Gregorian calendar */
export function dayNumber(year: number, month: number, day: number, julian: boolean): number {
  const y = year < 0 ? year + 1 : year; // civil to astronomical: 1 BC is year 0
  const a = Math.floor((14 - month) / 12);
  const yy = y + 4800 - a;
  const mm = month + 12 * a - 3;
  const base = day + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4);
  return julian
    ? base - 32083
    : base - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/** The Gregorian civil date of a Julian day number */
export function gregorianDate(jdn: number) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const y = 100 * b + d - 4800 + Math.floor(m / 10);
  return {
    year: y <= 0 ? y - 1 : y,
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/**
 * The Gregorian year of a Julian-calendar date, where it is certain: from a
 * full date, or from a month that no calendar shift can move to another
 * year. Null for a Gregorian date (its year is already Gregorian).
 */
export function gregorianYear(t: WikidataTime): number | null {
  if (!t.julian) return null;
  if (t.precision >= 11 && t.month && t.day)
    return gregorianDate(dayNumber(t.year, t.month, t.day, true)).year;
  if (t.precision === 10 && t.month && t.month >= 2 && t.month <= 11) return t.year;
  return null;
}

/** Whether two Wikidata dates can be the same day */
function compatible(a: WikidataTime, b: WikidataTime): boolean {
  if (a.precision >= 11 && b.precision >= 11 && a.month && a.day && b.month && b.day)
    return (
      dayNumber(a.year, a.month, a.day, a.julian) === dayNumber(b.year, b.month, b.day, b.julian)
    );
  const coarsest = Math.min(a.precision, b.precision);
  if (coarsest >= 9) {
    if (a.year !== b.year) return false;
    // A month can differ between the two calendars near its ends
    return !(a.month && b.month && a.julian === b.julian && a.month !== b.month);
  }
  if (coarsest === 8) return Math.floor(a.year / 10) === Math.floor(b.year / 10);
  const century = (y: number) => (y > 0 ? Math.ceil(y / 100) : -Math.ceil(-y / 100));
  return century(a.year) === century(b.year);
}

/** The earliest year a date allows: a decade's first year, a century's */
const earliestYear = (t: WikidataTime) =>
  t.precision >= 8 ? t.year : t.precision === 7 ? t.year - 100 : t.year - 1000;

const yearLabel = (y: number) => (y < 0 ? `${-y} BC` : String(y));

/**
 * The date to use among Wikidata's best statements. With a catalogue year,
 * the statement that agrees with it (if any). Without one, the most precise
 * statement when all can be the same day; statements that disagree are a
 * conflict and give nothing.
 */
export function chooseTime(
  times: WikidataTime[],
  catalogueYear: number | null,
): { time: WikidataTime | null; conflict: boolean } {
  if (!times.length) return { time: null, conflict: false };
  // Equal precision: the Gregorian date from 1583, the Julian before
  const usual = (t: WikidataTime) => t.julian === (t.year < 1583);
  const ordered = [...times].sort(
    (a, b) => b.precision - a.precision || Number(usual(b)) - Number(usual(a)),
  );
  if (catalogueYear !== null) {
    const agreeing = ordered.filter(
      (t) =>
        t.year === catalogueYear ||
        (t.year < 0 && -t.year === catalogueYear) ||
        gregorianYear(t) === catalogueYear,
    );
    if (agreeing.length) return { time: agreeing[0], conflict: false };
  }
  const all = ordered.every((t) => ordered.every((u) => compatible(t, u)));
  if (all) return { time: ordered[0], conflict: false };
  // Statements that differ only in the day (or the month) still agree on the
  // year: that much is certain (Gogol's two calendars, two reported days)
  const precise = ordered.filter((t) => t.precision >= 9);
  const years = new Set(precise.map((t) => t.year));
  if (precise.length === ordered.length && years.size === 1) {
    const months = new Set(precise.map((t) => (t.julian ? `j${t.month}` : `g${t.month}`)));
    const sameMonth = months.size === 1 && precise.every((t) => t.month !== null);
    return {
      time: {
        year: precise[0].year,
        month: sameMonth ? precise[0].month : null,
        day: null,
        precision: sameMonth ? 10 : 9,
        julian: precise[0].julian,
        circa: precise.some((t) => t.circa),
      },
      conflict: false,
    };
  }
  return { time: null, conflict: true };
}

export interface DateFill {
  year?: number;
  month?: number;
  day?: number;
  approximate?: true;
  gregorian?: number;
}

export interface DatePlan {
  /** The Wikidata statement used */
  time: WikidataTime | null;
  fill: DateFill;
  /** exact: the same year; near: within a year, or within the slack of a circa date */
  agree: "exact" | "near" | "differs" | "unknown";
  /** The day of the month agrees (true) or not (false); null when unknown */
  dayAgrees: boolean | null;
  corrections: string[];
  disagreements: string[];
  notes: string[];
}

export function planDate(
  kind: "birth" | "death",
  cat: CatalogueDate,
  times: WikidataTime[],
): DatePlan {
  const plan: DatePlan = {
    time: null,
    fill: {},
    agree: "unknown",
    dayAgrees: null,
    corrections: [],
    disagreements: [],
    notes: [],
  };
  const { time, conflict } = chooseTime(times, cat.year);
  if (conflict) {
    plan.notes.push(
      `Wikidata gives ${kind} dates that disagree (${times.map((t) => yearLabel(t.year)).join(", ")}); none taken`,
    );
    return plan;
  }
  if (!time) return plan;
  plan.time = time;
  if (time.precision < 8) {
    plan.notes.push(`Wikidata gives only the ${kind} century (${yearLabel(time.year)}); none taken`);
    return plan;
  }
  const approx = time.circa || time.precision < 9;
  const month = time.precision >= 10 ? time.month : null;
  const day = time.precision >= 11 ? time.day : null;
  if (day !== null && cat.day !== null) plan.dayAgrees = day === cat.day;

  if (cat.year === null) {
    plan.fill.year = time.year;
    if (approx) plan.fill.approximate = true;
    const g = gregorianYear(time);
    if (g !== null && cat.gregorian === null) plan.fill.gregorian = g;
    if (plan.dayAgrees === false) {
      plan.disagreements.push(
        `${kind} day: catalogue ${cat.day}, Wikidata ${day} (${month}/${day}/${yearLabel(time.year)}); only the year taken`,
      );
      return plan;
    }
    if (month !== null && cat.month === null) plan.fill.month = month;
    if (day !== null && cat.day === null) plan.fill.day = day;
    return plan;
  }

  const signFixed = time.year < 0 && -time.year === cat.year;
  const sameYear = time.year === cat.year || signFixed || gregorianYear(time) === cat.year;
  if (!sameYear) {
    const diff = Math.abs(time.year - cat.year);
    plan.agree = diff <= 1 || ((approx || cat.approximate) && diff <= 5) ? "near" : "differs";
    plan.disagreements.push(
      `${kind} year: catalogue ${yearLabel(cat.year)}, Wikidata ${yearLabel(time.year)}${approx ? " (circa)" : ""}`,
    );
    return plan;
  }
  plan.agree = approx || cat.approximate ? "near" : "exact";
  if (signFixed) {
    plan.fill.year = time.year;
    plan.corrections.push(
      `${kind} year ${cat.year} is ${yearLabel(time.year)}: a year before Christ is stored as a negative number`,
    );
  }
  const g = gregorianYear(time);
  if (g !== null && cat.gregorian === null && time.year === (plan.fill.year ?? cat.year))
    plan.fill.gregorian = g;
  // Month and day only from the statement whose year is the catalogue's
  if (time.year !== cat.year && !signFixed) return plan;
  if (plan.dayAgrees === false) {
    plan.disagreements.push(`${kind} day: catalogue ${cat.day}, Wikidata ${day}`);
    return plan;
  }
  if (cat.month !== null && month !== null && cat.month !== month) {
    plan.disagreements.push(`${kind} month: catalogue ${cat.month}, Wikidata ${month}`);
    return plan;
  }
  if (cat.month === null && month !== null) plan.fill.month = month;
  if (cat.day === null && day !== null && (cat.month ?? month) === month) plan.fill.day = day;
  return plan;
}

// ── Gender, countries, occupations ──────────────────────────────────────────

const GENDER: Record<string, Gender> = {
  Q6581097: "male",
  Q6581072: "female",
  Q2449503: "male", // trans man
  Q1052281: "female", // trans woman
};

/** P21 when every value is male or female and they agree; null otherwise */
export function personGender(p: PersonItem): Gender | null {
  const g = p.genders.map((id) => GENDER[id]);
  if (!g.length || g.some((v) => !v)) return null;
  return new Set(g).size === 1 ? g[0] : null;
}

const DEMONYMS: [RegExp, string][] = [
  [/\bamerican\b/i, "US"], [/\b(british|english|scottish|welsh)\b/i, "GB"],
  [/\birish\b/i, "IE"], [/\bcanadian\b/i, "CA"], [/\baustralian\b/i, "AU"],
  [/\bnew zealand\b/i, "NZ"], [/\bfrench\b/i, "FR"], [/\bgerman\b/i, "DE"],
  [/\baustrian\b/i, "AT"], [/\bswiss\b/i, "CH"], [/\bitalian\b/i, "IT"],
  [/\bspanish\b/i, "ES"], [/\bcatalan\b/i, "ES"], [/\bportuguese\b/i, "PT"],
  [/\bdutch\b/i, "NL"], [/\b(belgian|flemish)\b/i, "BE"], [/\bdanish\b/i, "DK"],
  [/\bnorwegian\b/i, "NO"], [/\bswedish\b/i, "SE"], [/\bfinnish\b/i, "FI"],
  [/\bicelandic\b/i, "IS"], [/\bpolish\b/i, "PL"], [/\bczech\b/i, "CZ"],
  [/\bslovak\b/i, "SK"], [/\bhungarian\b/i, "HU"], [/\bromanian\b/i, "RO"],
  [/\bbulgarian\b/i, "BG"], [/\bserbian\b/i, "RS"], [/\bcroatian\b/i, "HR"],
  [/\bslovene|slovenian\b/i, "SI"], [/\bbosnian\b/i, "BA"], [/\balbanian\b/i, "AL"],
  [/\bgreek\b/i, "GR"], [/\bturkish\b/i, "TR"], [/\brussian\b/i, "RU"],
  [/\bukrainian\b/i, "UA"], [/\bbelarusian\b/i, "BY"], [/\blithuanian\b/i, "LT"],
  [/\blatvian\b/i, "LV"], [/\bestonian\b/i, "EE"], [/\barmenian\b/i, "AM"],
  [/\bisraeli\b/i, "IL"], [/\blebanese\b/i, "LB"], [/\bsyrian\b/i, "SY"],
  [/\biraqi\b/i, "IQ"], [/\biranian\b/i, "IR"], [/\begyptian\b/i, "EG"],
  [/\bmoroccan\b/i, "MA"], [/\balgerian\b/i, "DZ"], [/\btunisian\b/i, "TN"],
  [/\bnigerian\b/i, "NG"], [/\bkenyan\b/i, "KE"], [/\bghanaian\b/i, "GH"],
  [/\bsenegalese\b/i, "SN"], [/\bsouth african\b/i, "ZA"], [/\bmalian\b/i, "ML"],
  [/\bjapanese\b/i, "JP"], [/\bchinese\b/i, "CN"], [/\b(south )?korean\b/i, "KR"],
  [/\btaiwanese\b/i, "TW"], [/\bvietnamese\b/i, "VN"], [/\bindian\b/i, "IN"],
  [/\bpakistani\b/i, "PK"], [/\bmexican\b/i, "MX"], [/\bguatemalan\b/i, "GT"],
  [/\bsalvadoran\b/i, "SV"], [/\bhonduran\b/i, "HN"], [/\bnicaraguan\b/i, "NI"],
  [/\bcuban\b/i, "CU"], [/\bpuerto rican\b/i, "PR"], [/\bcolombian\b/i, "CO"],
  [/\bvenezuelan\b/i, "VE"], [/\becuadorian\b/i, "EC"], [/\bperuvian\b/i, "PE"],
  [/\bbolivian\b/i, "BO"], [/\bchilean\b/i, "CL"], [/\bargentin(e|ian)\b/i, "AR"],
  [/\buruguayan\b/i, "UY"], [/\bparaguayan\b/i, "PY"], [/\bbrazilian\b/i, "BR"],
  [/\bkuwaiti\b/i, "KW"], [/\bjamaican\b/i, "JM"], [/\bqu[eé]b[eé]cois\b/i, "CA"],
];

/**
 * The one country a description's demonym names ("Colombian novelist").
 * "German-language Czech writer" names a language, not a country; a
 * description that names two countries ("Russian-American") gives none.
 */
export function describedCountry(description: string | null): string | null {
  if (!description) return null;
  const text = description.replace(/\b[\w-]+-(language|speaking)\b/gi, " ");
  const found = new Set(DEMONYMS.filter(([re]) => re.test(text)).map(([, c]) => c));
  return found.size === 1 ? [...found][0] : null;
}

/** Countries that exist today (a code, not dissolved), by alpha-2 */
export function modernCountries(ids: string[], places: Record<string, PlaceItem | null>): string[] {
  return [
    ...new Set(
      ids
        .map((id) => places[id])
        .filter((c): c is PlaceItem => !!c?.alpha2 && c.dissolved === null)
        .map((c) => c.alpha2!.toUpperCase()),
    ),
  ];
}

/** The country of a place today, by alpha-2 */
export function placeCountry(id: string | undefined, places: Record<string, PlaceItem | null>) {
  const p = id ? places[id] : null;
  return p ? (modernCountries(p.countries, places)[0] ?? null) : null;
}

/**
 * The nationality to fill: the one citizenship that is a country today, or,
 * failing that, the description's demonym. Several countries today give
 * none unless the description names one of them. Nothing for antiquity.
 */
export function personNationality(
  p: PersonItem,
  places: Record<string, PlaceItem | null>,
): string | null {
  const lived = [...p.births, ...p.deaths].map((t) => t.year);
  if (lived.length && Math.min(...lived) < 500) return null;
  const modern = modernCountries(p.citizenships, places);
  const described = describedCountry(p.description);
  // "Russian writer" with Polish citizenship: the two disagree, so neither
  if (described && modern.length && !modern.includes(described)) return null;
  if (modern.length === 1) return modern[0];
  if (modern.length > 1) return described;
  return described;
}

/**
 * Whether the person's nationality is the author's. A citizenship of today or
 * the description's demonym can disagree; a birthplace can only agree, since
 * borders move (Bruno Schulz was born in Austria-Hungary, in today's Ukraine).
 */
export function nationalityCheck(
  alpha2: string,
  p: PersonItem,
  places: Record<string, PlaceItem | null>,
): { agrees: boolean; stated: string[] } {
  const stated = new Set(modernCountries(p.citizenships, places));
  const described = describedCountry(p.description);
  if (described) stated.add(described);
  const born = placeCountry(p.birthPlaces[0], places);
  return { agrees: stated.has(alpha2) || born === alpha2, stated: [...stated] };
}

// Writers: writer, novelist, poet, essayist, playwright, screenwriter,
// journalist, philosopher, historian, translator, literary critic, short story
// writer, author, children's writer, science fiction writer, prosaist,
// autobiographer, theologian, diarist, literary scholar
const WRITERS = new Set([
  "Q36180", "Q6625963", "Q49757", "Q11774202", "Q214917", "Q28389", "Q1930187",
  "Q4964182", "Q201788", "Q333634", "Q4263842", "Q15949613", "Q482980",
  "Q4853732", "Q18844224", "Q12144794", "Q18814623", "Q1234713", "Q2526255",
  "Q17167049",
]);
// Scholars: university teacher, scientist, psychologist, sociologist,
// economist, physician, mathematician, art historian, classical scholar
const SCHOLARS = new Set([
  "Q1622272", "Q901", "Q212980", "Q2306091", "Q188094", "Q39631", "Q170790",
  "Q1792450", "Q16267607",
]);
const WRITER_TEXT =
  /\b(writer|novelist|poet|author|philosopher|essayist|playwright|dramatist|journalist|historian|critic|translator|theologian|chronicler|diarist|classicist|man of letters)\b/i;
const SCHOLAR_TEXT = /\b(scholar|professor|scientist|academic|researcher|orientalist|psychologist|physician)\b/i;

export const isWriter = (p: PersonItem) =>
  p.occupations.some((o) => WRITERS.has(o)) || WRITER_TEXT.test(p.description ?? "");
export const isLiterary = (p: PersonItem) =>
  isWriter(p) || p.occupations.some((o) => SCHOLARS.has(o)) || SCHOLAR_TEXT.test(p.description ?? "");

// ── Works ───────────────────────────────────────────────────────────────────

const TITLE_FILLER = new Set([
  "complete", "collected", "selected", "the", "a", "an", "novel", "stories",
  "volume", "vol", "i", "ii", "iii", "iv", "1", "2", "3", "4", "edition", "new",
  "translation", "annotated", "unabridged", "classics",
]);

function titleKeys(title: string): string[] {
  // "…, Volumes 1 to 6", "…, Volume I": one book whatever the volume
  const clean = title.replace(/,?\s+vol(ume)?s?\.?\s+[\divxlc]+(\s+(to|and|-)\s+[\divxlc]+)?\s*$/i, "");
  const full = normalizeSearchText(clean);
  const head = normalizeSearchText(clean.split(/[:;]| - /)[0]);
  const bare = full.replace(/\s+a (novel|memoir|novella)$/, "");
  return [...new Set([full, head, bare].filter(Boolean))];
}

const STOP = new Set([
  "the", "a", "an", "and", "of", "on", "in", "to", "for", "with", "from", "by",
  "at", "la", "le", "les", "el", "los", "las", "der", "die", "das", "des",
  "del", "di", "du", "de", "y", "et", "und",
]);
const significant = (k: string) =>
  new Set(words(k).filter((w) => w.length > 2 && !STOP.has(w) && !TITLE_FILLER.has(w)));

/**
 * Whether two titles name one book: equal; one holds the other with only
 * filler left ("Complete Maus"); or every word that counts in the shorter is
 * in the longer, two words at least ("The Bridge Over the Drina", "The
 * Bridge on the Drina").
 */
export function sameTitle(a: string, b: string): boolean {
  const ka = titleKeys(a),
    kb = titleKeys(b);
  for (const x of ka)
    for (const y of kb) {
      if (x === y) return true;
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (` ${long} `.includes(` ${short} `)) {
        const rest = words(` ${long} `.replace(` ${short} `, " "));
        if (words(short).length >= 2 || rest.every((w) => TITLE_FILLER.has(w))) return true;
      }
      const [sx, sy] = [significant(x), significant(y)];
      const [few, many] = sx.size <= sy.size ? [sx, sy] : [sy, sx];
      if (few.size >= 2 && [...few].every((w) => many.has(w))) return true;
    }
  return false;
}

/** The author's catalogue titles that are among the person's works */
export function matchedWorks(
  catalogue: { title: string }[],
  works: WorkHit[],
  notable: (LabelItem | null)[],
): string[] {
  const names = [
    ...works.flatMap((w) => [w.label, ...w.aliases]),
    ...notable.map((n) => n?.label ?? null),
  ].filter((n): n is string => !!n);
  return [...new Set(catalogue.filter((c) => names.some((n) => sameTitle(c.title, n))).map((c) => c.title))];
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  label: string | null;
  description: string | null;
  rank: number;
  level: "high" | "medium" | "low" | "held" | "excluded";
  score: number;
  /** Rule the person out */
  hard: string[];
  /** Stop an automatic match; a person decides */
  soft: string[];
  evidence: string[];
  works: string[];
}

export interface PlanContext {
  people: Record<string, PersonItem | null>;
  places: Record<string, PlaceItem | null>;
  labels: Record<string, LabelItem | null>;
  works: Record<string, WorkHit[]>;
  /** Every person the searches found for this author */
  candidates: string[];
  review?: AuthorReviewDecision;
}

export interface AuthorReviewDecision {
  /** Readable name of the author the slug belongs to */
  name: string;
  /** The Wikidata person, when the rules held the author back */
  accept?: string;
  /** No Wikidata person is this author */
  reject?: true;
  /** Another author (by slug) is the same person; they are merged by hand */
  duplicateOf?: string;
  /** Facts not filled, because research found Wikidata's wrong */
  skip?: (keyof AuthorFill)[];
  /**
   * A sort name (and its name parts) research found broken; written only
   * from here. A display name changes in the app, which also renews slugs.
   */
  rename?: Partial<Record<AuthorNameColumn, string>>;
  /** Values research found wrong (checked against a second source), put right */
  correct?: AuthorCorrection;
  note: string;
}

export interface AuthorCorrection {
  birth?: { year?: number; month?: number; day?: number };
  death?: { year?: number; month?: number; day?: number };
  /** ISO 3166-1 alpha-2 */
  nationality?: string;
}

/** The catalogue's facts with a review's corrections in place */
function corrected(a: AuthorEvidence, c: AuthorCorrection | undefined): AuthorEvidence {
  if (!c) return a;
  return {
    ...a,
    birth: { ...a.birth, ...c.birth },
    death: { ...a.death, ...c.death },
    nationality: c.nationality ?? a.nationality,
  };
}

function describeCorrection(a: AuthorEvidence, c: AuthorCorrection, note: string): string[] {
  const out: string[] = [];
  for (const kind of ["birth", "death"] as const)
    for (const [k, v] of Object.entries(c[kind] ?? {}))
      out.push(`${kind} ${k} ${a[kind][k as "year" | "month" | "day"] ?? "empty"} → ${v} (${note})`);
  if (c.nationality) out.push(`nationality ${a.nationality ?? "empty"} → ${c.nationality} (${note})`);
  return out;
}

/** Name columns a review may put right: never filled from Wikidata, never the display name */
export const AUTHOR_NAME_COLUMNS = ["sort_name", "first_name", "last_name"] as const;
export type AuthorNameColumn = (typeof AUTHOR_NAME_COLUMNS)[number];

export function evaluate(a: AuthorEvidence, p: PersonItem, ctx: PlanContext, forms: string[]): Candidate {
  const rank = nameRank(forms, p.label, p.aliases);
  const c: Candidate = {
    id: p.id,
    label: p.label,
    description: p.description,
    rank,
    level: "low",
    score: rank,
    hard: [],
    soft: [],
    evidence: [],
    works: [],
  };
  if (!p.classes.includes("Q5")) c.hard.push("not a person on Wikidata");
  if (rank < 1) c.hard.push("the name does not fit");

  const gender = personGender(p);
  if (a.gender && gender && a.gender !== gender) c.hard.push(`gender: catalogue ${a.gender}, Wikidata ${gender}`);
  else if (a.gender && gender) {
    c.evidence.push("gender agrees");
    c.score += 1;
  }

  const birth = planDate("birth", a.birth, p.births);
  const death = planDate("death", a.death, p.deaths);
  for (const [kind, d] of [["birth", birth], ["death", death]] as const) {
    if (d.agree === "differs") c.hard.push(...d.disagreements);
    else if (d.agree === "near") c.soft.push(...d.disagreements);
    else if (d.agree === "exact") {
      c.evidence.push(`${kind} year agrees`);
      c.score += 3;
    }
    if (d.dayAgrees === true) {
      c.evidence.push(`${kind} day agrees`);
      c.score += 2;
    } else if (d.dayAgrees === false && d.agree !== "differs") c.soft.push(`${kind} day differs`);
  }

  // No one writes a book before they are about twelve
  const born = Math.min(...p.births.map(earliestYear));
  const earliest = Math.min(...a.works.map((w) => w.year ?? Infinity));
  if (Number.isFinite(born) && Number.isFinite(earliest) && earliest < born + 12)
    c.hard.push(`a book from ${yearLabel(earliest)} predates this person (born ${yearLabel(born)})`);

  if (a.nationality) {
    const { agrees, stated } = nationalityCheck(a.nationality, p, ctx.places);
    if (agrees) {
      c.evidence.push("nationality agrees");
      c.score += 2;
    } else if (stated.length)
      c.soft.push(`nationality: catalogue ${a.nationality}, Wikidata ${stated.join("/")}`);
  }

  c.works = matchedWorks(
    a.works,
    ctx.works[p.id] ?? [],
    p.notableWorks.map((id) => ctx.labels[id] ?? null),
  );
  if (c.works.length) {
    c.evidence.push(`wrote ${c.works.map((t) => `“${t}”`).join(", ")}`);
    c.score += 5;
  }
  if (isWriter(p)) c.score += 1;

  const exact = (d: DatePlan) => d.agree === "exact";
  const nat = c.evidence.includes("nationality agrees");
  // One of the author's books, or two dates that agree, prove the person:
  // a nationality or a day that differs is then reported, not a doubt
  const strong =
    (c.works.length > 0 && rank >= 1) ||
    (rank >= 2 && exact(birth) && (exact(death) || birth.dayAgrees === true)) ||
    (rank >= 2 && exact(death) && death.dayAgrees === true);
  if (c.hard.length) c.level = "excluded";
  else if (strong) c.level = "high";
  else if (c.soft.length) c.level = "held";
  else if (rank >= 2 && exact(birth) && nat) c.level = "high";
  else if (rank >= 2 && exact(death) && nat) c.level = "high";
  else if (rank >= 3) c.level = "medium";
  return c;
}

export interface AuthorFill {
  birth?: DateFill;
  death?: DateFill;
  zodiacSign?: string;
  gender?: Gender;
  nationality?: string;
  birthPlace?: string;
  deathPlace?: string;
  realName?: string;
  website?: string;
  openLibraryKey?: string;
  goodreadsId?: string;
  bio?: string;
}

export interface AuthorMatch {
  id: string;
  label: string | null;
  confidence: "high" | "medium" | "reviewed";
}

export interface AuthorPlan {
  match: AuthorMatch | null;
  candidates: Candidate[];
  /** Why a person must decide */
  held: string[];
  fill: AuthorFill;
  /** Values a review put right (written over the old ones) */
  correct: AuthorCorrection;
  /** Wrong values put right, with the reason */
  corrections: string[];
  /** Values that differ from Wikidata's; not changed */
  disagreements: string[];
  notes: string[];
}

/** A fact the catalogue already holds that agrees: a year, a day, the nationality */
const hasFact = (c: Candidate) =>
  c.evidence.some((e) => /year agrees|nationality agrees|day agrees/.test(e));

/** Picks the person, or holds the author for review */
export function chooseMatch(
  a: AuthorEvidence,
  ctx: PlanContext,
): Pick<AuthorPlan, "match" | "candidates" | "held"> {
  const forms = nameForms(a);
  const candidates = ctx.candidates
    .map((id) => ctx.people[id])
    .filter((p): p is PersonItem => !!p)
    .map((p) => evaluate(a, p, ctx, forms))
    .filter((c) => c.rank >= 1)
    .sort((x, y) => y.score - x.score);
  const r = ctx.review;
  if (r?.duplicateOf)
    return { match: null, candidates, held: [`the same person as ${r.duplicateOf}; merge them by hand (${r.note})`] };
  if (r?.reject) return { match: null, candidates, held: [`refused on review: ${r.note}`] };
  if (r?.accept) {
    const p = ctx.people[r.accept];
    if (!p) return { match: null, candidates, held: [`reviewed item ${r.accept} could not be read`] };
    return { match: { id: p.id, label: p.label, confidence: "reviewed" }, candidates, held: [] };
  }
  const high = candidates.filter((c) => c.level === "high");
  if (high.length === 1 || (high.length > 1 && high[0].score >= high[1].score + 3))
    return { match: { id: high[0].id, label: high[0].label, confidence: "high" }, candidates, held: [] };
  if (high.length > 1)
    return {
      match: null,
      candidates,
      held: [`several people fit: ${high.map((c) => `${c.label} (${c.id})`).join(", ")}`],
    };
  // Medium: the one writer whose name fits well, or the only person whose
  // name fits well with a fact the catalogue holds; nothing else fits as well
  const close = candidates.filter((c) => c.rank >= 3 && c.level !== "excluded");
  const writers = close.filter((c) => isWriter(ctx.people[c.id]!));
  const pick =
    writers.length === 1 && writers[0].level === "medium"
      ? writers[0]
      : close.length === 1 && close[0].level === "medium" && hasFact(close[0])
        ? close[0]
        : null;
  if (pick) return { match: { id: pick.id, label: pick.label, confidence: "medium" }, candidates, held: [] };
  const open = candidates.filter((c) => c.level !== "excluded");
  return {
    match: null,
    candidates,
    held: open.length
      ? open.map((c) => `${c.label} (${c.id}), ${c.description ?? "no description"}: ${[...c.soft, ...c.evidence].join("; ") || "no evidence"}`)
      : [],
  };
}

// ── What is filled ──────────────────────────────────────────────────────────

const LATIN = /^[\p{Script=Latin}\p{M}\s.'’\-,()]+$/u;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const BUILDING =
  /\b(hospital|building|house|palace|manor|estate|castle|farm|street|church|monastery|abbey|prison|hotel|clinic|sanatorium|asylum|apartment|villa|residence|mansion)\b/i;

/** The place itself, or the town it is in when it is a building ("hospital in Russia") */
export function settlementOf(
  id: string | undefined,
  places: Record<string, PlaceItem | null>,
): string | undefined {
  let at = id;
  for (let step = 0; step < 3 && at; step++) {
    const p = places[at];
    if (!p || !BUILDING.test(p.description ?? "")) return at;
    const parent = p.within.find((w) => places[w]);
    if (!parent) return at;
    at = parent;
  }
  return at;
}

/** The places a place lies in, nearest first */
function ancestors(id: string, places: Record<string, PlaceItem | null>): string[] {
  const out: string[] = [];
  let at = places[id];
  for (let step = 0; step < 8 && at; step++) {
    const next = at.within.find((w) => places[w] && !out.includes(w));
    if (!next) break;
    out.push(next);
    at = places[next];
  }
  return out;
}

/**
 * One place among Wikidata's: the only one, or the most precise when every
 * other one contains it (Rathgar and Dublin give Rathgar). Two places apart
 * give none.
 */
export function pickPlace(list: string[], places: Record<string, PlaceItem | null>): string | null {
  const read = list.filter((id) => places[id]);
  if (read.length !== list.length || !read.length) return null;
  if (read.length === 1) return read[0];
  return read.find((x) => read.every((y) => y === x || ancestors(x, places).includes(y))) ?? null;
}

/** "Aracataca, Colombia": a place and its country today */
export function placeLabel(id: string | undefined, places: Record<string, PlaceItem | null>) {
  const p = id ? places[id] : null;
  if (!p?.label) return null;
  const country = p.countries.map((c) => places[c]).find((c) => c?.alpha2 && c.dissolved === null);
  return country?.label && country.label !== p.label ? `${p.label}, ${country.label}` : p.label;
}

/** "428 BC", "AD 27", "1927" */
const bioYear = (y: number) => (y < 0 ? `${-y} BC` : y < 1000 ? `AD ${y}` : String(y));

function lifeClause(verb: string, place: string | null, year: number | null, approx: boolean) {
  if (!place && year === null) return null;
  const when = year === null ? "" : ` ${approx ? "around" : "in"} ${bioYear(year)}`;
  // "in Aracataca, Colombia, in 1927"
  const where = place ? ` in ${place}${when && place.includes(",") ? "," : ""}` : "";
  return `${verb}${where}${when}`;
}

/**
 * A short About text from Wikidata facts only: the description, where and
 * when the person was born and died, their notable works and movements.
 * Years come from the catalogue's dates after the fill, so the text and
 * the dates on the page always agree. Null when only the description is known.
 */
export function authorBio(
  p: PersonItem,
  ctx: Pick<PlanContext, "places" | "labels">,
  life: { birthYear: number | null; birthApprox: boolean; deathYear: number | null; deathApprox: boolean },
): string | null {
  const parts: string[] = [];
  const description = (p.description ?? "")
    .replace(/\s*\([^)]*\d[^)]*\)\s*$/, "")
    .trim();
  const generic = /^(human|person|writer|author|people)$/i.test(description) || /wikimedia/i.test(description);
  if (description && !generic) parts.push(escapeHtml(`${capitalize(description)}.`));
  const facts: string[] = [];
  const where = (id: string | undefined) => {
    const at = settlementOf(id, ctx.places);
    // "Born in Paris", not "in 16th arrondissement of Paris"
    const p = at ? ctx.places[at] : null;
    const city = p && /\barrondissement\b/i.test(p.label ?? "") ? p.within.find((w) => ctx.places[w]) : undefined;
    return placeLabel(city ?? at, ctx.places);
  };
  const born = lifeClause("Born", where(p.birthPlaces[0]), life.birthYear, life.birthApprox);
  const died = lifeClause("died", where(p.deathPlaces[0]), life.deathYear, life.deathApprox);
  if (born || died)
    facts.push(escapeHtml(`${born ?? capitalize(died!)}${born && died ? `; ${died}` : ""}.`));
  const works = p.notableWorks
    .map((id) => ctx.labels[id]?.label)
    .filter((l): l is string => !!l && !/^Q\d+$/.test(l))
    .slice(0, 3)
    .map((l) => `<em>${escapeHtml(l)}</em>`);
  if (works.length)
    facts.push(`Notable works include ${works.length > 1 ? `${works.slice(0, -1).join(", ")} and ${works.at(-1)}` : works[0]}.`);
  const movements = p.movements
    .map((id) => ctx.labels[id]?.label)
    .filter((l): l is string => !!l)
    .slice(0, 2)
    .map(escapeHtml);
  if (movements.length) facts.push(`Associated with ${movements.join(" and ")}.`);
  if (!facts.length) return null;
  return `<p>${[...parts, ...facts].join(" ")}</p>`;
}

/** What the match fills, from empty fields only, and what disagrees */
export function planFill(
  a: AuthorEvidence,
  p: PersonItem,
  ctx: Pick<PlanContext, "places" | "labels">,
  skip: Set<keyof AuthorFill> = new Set(),
): Pick<AuthorPlan, "fill" | "corrections" | "disagreements" | "notes"> {
  const fill: AuthorFill = {};
  const birth = planDate("birth", a.birth, p.births);
  const death = planDate("death", a.death, p.deaths);
  if (Object.keys(birth.fill).length) fill.birth = birth.fill;
  if (Object.keys(death.fill).length) fill.death = death.fill;
  const corrections = [...birth.corrections, ...death.corrections];
  const disagreements = [...birth.disagreements, ...death.disagreements];
  const notes = [...birth.notes, ...death.notes];

  let month = a.birth.month ?? birth.fill.month ?? null;
  let day = a.birth.day ?? birth.fill.day ?? null;
  // The sign follows the Sun: a Julian date is read in the Gregorian calendar
  const t = birth.time;
  if (t?.julian && t.month && t.day && birth.fill.month && (birth.fill.day || a.birth.day === t.day)) {
    const g = gregorianDate(dayNumber(t.year, t.month, t.day, true));
    month = g.month;
    day = g.day;
  }
  if (!a.zodiacSign && month && day) {
    const sign = computeZodiacSign(month, day);
    if (sign) fill.zodiacSign = sign;
  }

  const gender = personGender(p);
  if (!a.gender && gender) fill.gender = gender;
  else if (a.gender && gender && gender !== a.gender)
    disagreements.push(`gender: catalogue ${a.gender}, Wikidata ${gender}`);

  const nationality = personNationality(p, ctx.places);
  if (!a.nationality && nationality) fill.nationality = nationality;
  else if (a.nationality) {
    const { agrees, stated } = nationalityCheck(a.nationality, p, ctx.places);
    if (!agrees && stated.length)
      disagreements.push(`nationality: catalogue ${a.nationality}, Wikidata ${stated.join("/")}`);
  }

  for (const [key, list, current] of [
    ["birthPlace", p.birthPlaces, a.birthPlaceId],
    ["deathPlace", p.deathPlaces, a.deathPlaceId],
  ] as const) {
    if (current) continue;
    const chosen = pickPlace(list, ctx.places);
    if (chosen) fill[key] = settlementOf(chosen, ctx.places);
    else if (list.length > 1) notes.push(`Wikidata gives ${list.length} ${key === "birthPlace" ? "birthplaces" : "places of death"}; none taken`);
  }

  if (!a.realName) {
    const forms = nameForms(a).map(normalizeSearchText);
    const latin = p.birthNames.filter((n) => LATIN.test(n.text));
    const pick = latin.find((n) => n.language === "en") ?? latin[0];
    if (pick && !forms.includes(normalizeSearchText(pick.text))) fill.realName = pick.text.trim();
  }

  const website = p.websites.find((w) => /^https?:\/\//i.test(w));
  if (!a.website && website) fill.website = website;
  const ol = p.openLibrary.find((k) => /^OL\d+A$/.test(k));
  if (!a.openLibraryKey && ol) fill.openLibraryKey = `/authors/${ol}`;
  const gr = p.goodreads.find((k) => /^\d+$/.test(k));
  if (!a.goodreadsId && gr) fill.goodreadsId = gr;

  for (const key of skip) delete fill[key];
  if (!a.bio && !skip.has("bio")) {
    const year = (cat: CatalogueDate, f?: DateFill) => f?.year ?? cat.year;
    const bio = authorBio(skip.has("birthPlace") || skip.has("deathPlace") ? { ...p, birthPlaces: skip.has("birthPlace") ? [] : p.birthPlaces, deathPlaces: skip.has("deathPlace") ? [] : p.deathPlaces } : p, ctx, {
      birthYear: year(a.birth, fill.birth),
      birthApprox: a.birth.year !== null ? a.birth.approximate : !!fill.birth?.approximate,
      deathYear: year(a.death, fill.death),
      deathApprox: a.death.year !== null ? a.death.approximate : !!fill.death?.approximate,
    });
    if (bio) fill.bio = bio;
  }
  return { fill, corrections, disagreements, notes };
}

export function planAuthor(a: AuthorEvidence, ctx: PlanContext): AuthorPlan {
  const chosen = chooseMatch(a, ctx);
  if (!chosen.match)
    return { ...chosen, fill: {}, correct: {}, corrections: [], disagreements: [], notes: [] };
  const skip = new Set(ctx.review?.skip ?? []);
  const correct = ctx.review?.correct;
  // Corrected values count as the catalogue's: nothing is filled over them
  const planned = planFill(corrected(a, correct), ctx.people[chosen.match.id]!, ctx, skip);
  if (skip.size) planned.notes.push(`${[...skip].join(", ")} not filled: ${ctx.review!.note}`);
  if (correct) planned.corrections.push(...describeCorrection(a, correct, ctx.review!.note));
  return { ...chosen, ...planned, correct: correct ?? {} };
}

// ── Places ──────────────────────────────────────────────────────────────────

export interface PlaceLevel {
  qid: string;
  name: string;
  type: string;
}

const VILLAGE = new Set(["Q532", "Q5084", "Q3558970", "Q2514025"]);
const TOWN = new Set(["Q3957", "Q15127012", "Q1867183"]);
const DISTRICT = new Set(["Q123705", "Q2983893", "Q702842", "Q1434401", "Q24398318"]);

function leafType(p: PlaceItem) {
  if (p.classes.some((c) => VILLAGE.has(c))) return "village";
  if (p.classes.some((c) => TOWN.has(c))) return "town";
  if (p.classes.some((c) => DISTRICT.has(c))) return "district";
  return "city";
}

/**
 * The rows a place needs, country first: its country today, its top
 * administrative region, then the place. The region is the last unit
 * before the country on the "located in" path ("England" for London).
 */
export function placeChain(
  qid: string,
  places: Record<string, PlaceItem | null>,
): { levels: PlaceLevel[]; alpha2: string | null; fullName: string } | null {
  const leaf = places[qid];
  if (!leaf?.label) return null;
  const country = leaf.countries
    .map((c) => places[c])
    .find((c): c is PlaceItem => !!c?.alpha2 && c.dissolved === null && !!c.label);
  if (country?.id === leaf.id)
    return { levels: [{ qid, name: leaf.label, type: "country" }], alpha2: leaf.alpha2, fullName: leaf.label };
  let region: PlaceItem | null = null;
  let at: PlaceItem | null = leaf;
  const seen = new Set([leaf.id]);
  for (let step = 0; step < 8 && at; step++) {
    const next: PlaceItem | null = at.within.map((w) => places[w] ?? null).find((w) => !!w) ?? null;
    if (!next || seen.has(next.id) || next.alpha2 || next.id === country?.id) break;
    seen.add(next.id);
    if (next.label) region = next;
    at = next;
  }
  const levels: PlaceLevel[] = [];
  if (country) levels.push({ qid: country.id, name: country.label!, type: "country" });
  if (region && region.label !== leaf.label) levels.push({ qid: region.id, name: region.label!, type: "region" });
  levels.push({ qid, name: leaf.label, type: leafType(leaf) });
  return {
    levels,
    alpha2: country?.alpha2?.toUpperCase() ?? null,
    fullName: [...levels].reverse().map((l) => l.name).join(", "),
  };
}

// ── The row written ─────────────────────────────────────────────────────────

export type AuthorRow = Record<AuthorFillColumn, string | number | boolean | null>;

/**
 * The author's row after the fill: only the columns a run may write, with
 * filled values over empty ones. A year's missing minus sign is the one
 * value that replaces another.
 */
export function nextAuthorRow(
  before: AuthorRow,
  fill: AuthorFill,
  resolved: {
    nationalityId: string | null;
    birthPlaceId: string | null;
    deathPlaceId: string | null;
    bio: string | null;
  },
  correct: Omit<AuthorCorrection, "nationality"> & { nationalityId?: string | null } = {},
): AuthorRow {
  const next: AuthorRow = { ...before };
  const date = (prefix: "birth" | "death", f?: DateFill) => {
    if (!f) return;
    if (f.year !== undefined) next[`${prefix}_year`] = f.year;
    if (f.month !== undefined && before[`${prefix}_month`] === null) next[`${prefix}_month`] = f.month;
    if (f.day !== undefined && before[`${prefix}_day`] === null) next[`${prefix}_day`] = f.day;
    if (f.approximate && before[`${prefix}_year`] === null) next[`${prefix}_year_is_approximate`] = true;
    if (f.gregorian !== undefined && before[`${prefix}_year_gregorian`] === null)
      next[`${prefix}_year_gregorian`] = f.gregorian;
  };
  date("birth", fill.birth);
  date("death", fill.death);
  const empty = (column: AuthorFillColumn, value: string | null | undefined) => {
    if (value && before[column] === null) next[column] = value;
  };
  empty("zodiac_sign", fill.zodiacSign);
  empty("gender", fill.gender);
  empty("nationality_id", resolved.nationalityId);
  empty("birth_place_id", resolved.birthPlaceId);
  empty("death_place_id", resolved.deathPlaceId);
  empty("real_name", fill.realName);
  empty("website", fill.website);
  empty("open_library_key", fill.openLibraryKey);
  empty("goodreads_id", fill.goodreadsId);
  empty("bio", resolved.bio);
  // Reviewed corrections are written over the old values
  for (const kind of ["birth", "death"] as const) {
    const c = correct[kind];
    if (c?.year !== undefined) next[`${kind}_year`] = c.year;
    if (c?.month !== undefined) next[`${kind}_month`] = c.month;
    if (c?.day !== undefined) next[`${kind}_day`] = c.day;
  }
  if (correct.nationalityId) next.nationality_id = correct.nationalityId;
  return next;
}
