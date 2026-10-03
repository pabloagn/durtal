/**
 * Publisher enrichment rules (SLN-330). A Wikidata item is taken for a
 * publishing house only when it is a kind of publisher, its name is the
 * house's name, and nothing the catalogue knows contradicts it: the country
 * text, the publication countries of the house's books, and the ISBN
 * registration groups of those books. Only empty fields are filled. Pure
 * module.
 */
import ISBN from "isbn3";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { publisherLooseKeys } from "@/lib/publishers/names";
import {
  resolveCountry,
  splitCountries,
  type countryLookup,
} from "@/lib/utils/countries";
import type { WikidataItem } from "@/lib/publishers/wikidata";

/** Wikidata classes a publishing house is an instance of, or a subclass of */
export const PUBLISHER_ROOTS = new Set([
  "Q2085381", // publisher
  "Q2608849", // imprint
]);

export interface HouseEvidence {
  id: string;
  name: string;
  kind: string;
  country: string | null;
  countryId: string | null;
  website: string | null;
  description: string | null;
  parent: string | null;
  grandparent: string | null;
  aliases: string[];
  /** Books of the house and the houses below it; `direct` when linked to this house itself */
  editions: {
    isbn: string | null;
    country: string | null;
    year?: number | null;
    direct?: boolean;
  }[];
}

export interface Match {
  id: string;
  confidence: "high" | "medium";
  /** The facts used, kept as provenance */
  facts: {
    label: string | null;
    description: string | null;
    countries: string[];
    founded: number | null;
    dissolved: number | null;
    headquarters: string | null;
    website: string | null;
    parents: string[];
    enwiki: string | null;
  };
}

export interface HousePlan {
  match: Match | null;
  /** What supports the match */
  evidence: string[];
  /** Why no match was taken */
  held: string[];
  /** Wikidata and the catalogue disagree; nothing changes */
  conflicts: string[];
  fill: { country?: string; website?: string; description?: string };
}

export interface PlanContext {
  candidates: WikidataItem[];
  items: Record<string, WikidataItem>;
  publisherClasses: Set<string>;
  countryLookup: ReturnType<typeof countryLookup>;
}

const ENGLISH = ["US", "GB", "CA", "AU", "NZ", "IE", "ZA", "IN", "SG"];
const FRENCH = ["FR", "BE", "CH", "CA", "LU", "MC"];
const GERMAN = ["DE", "AT", "CH", "LI"];

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => names.of(code) ?? null;
  } catch {
    return () => null;
  }
})();

/** Words that end many publisher names and that Wikidata labels often drop */
const TRAILING = /\s+(books|publishing|publishers|publications|press|company|limited|ltd|group|editions)$/i;

/**
 * The texts to search Wikidata for. Its search only finds labels that start
 * with the text, so the short form ("Tin House" for "Tin House Books") and,
 * for a bare name, the name with "Books" or "Press" are searched too.
 */
export function searchTexts(h: Pick<HouseEvidence, "name" | "aliases">) {
  const bare = h.name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const inner = [...h.name.matchAll(/\(([^)]{4,})\)/g)].map((m) => m[1]);
  let short = bare;
  while (TRAILING.test(short)) short = short.replace(TRAILING, "");
  const extra = short === bare && !/\s/.test(bare) ? [`${bare} Books`, `${bare} Press`] : [];
  const seen = new Set<string>();
  return [h.name, bare, ...inner, ...h.aliases, short, ...extra]
    .filter((t) => {
      const k = normalizeSearchText(t);
      if (!k || k.length < 3 || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

/** Countries (ISO alpha-2) an ISBN's registration group can belong to */
export function isbnCountries(
  isbn: string | null,
  lookup: PlanContext["countryLookup"],
  alpha2Of: (id: string) => string | null,
): string[] | null {
  if (!isbn) return null;
  const group = ISBN.parse(isbn.replace(/[^0-9Xx]/g, ""))?.groupname;
  if (!group) return null;
  if (group === "English language") return ENGLISH;
  if (group === "French language") return FRENCH;
  if (group === "German language") return GERMAN;
  const id =
    resolveCountry(group, lookup) ?? resolveCountry(group.split(",")[0], lookup);
  const code = id ? alpha2Of(id) : null;
  return code ? [code] : null;
}

/** Typing errors in Wikidata descriptions, corrected in the About text */
const ABOUT_CORRECTIONS: [string, string][] = [["Penguine Random House", "Penguin Random House"]];

/** "American book publishing company" + facts → the About text */
export function aboutText(
  facts: Match["facts"],
): string | null {
  const sentences: string[] = [];
  // "publisher" or "imprint" alone tells the reader nothing new
  const generic = /^(a |an )?(book |publishing )?(publisher|publishing (house|company)|imprint|company|business)$/i;
  if (facts.description && !generic.test(facts.description.trim())) {
    const d = facts.description.trim().replace(/\.$/, "");
    sentences.push(d.charAt(0).toUpperCase() + d.slice(1) + ".");
  }
  // A street address or a building is not a place a reader needs
  const hq =
    facts.headquarters &&
    !/\d|\b(building|tower|avenue|street|broadway|university)\b/i.test(facts.headquarters)
      ? facts.headquarters
      : null;
  const mentioned = (t: string) =>
    !!facts.description &&
    normalizeSearchText(facts.description).includes(normalizeSearchText(t));
  // A description that already gives the founding or the place keeps its own
  // ("founded in 1836": Routledge's inception says 1851)
  const says = (re: RegExp) => !!facts.description && re.test(facts.description);
  // Headquarters are where a house is now, not where it began
  if (facts.founded && !says(/\bfounded\b/i)) sentences.push(`Founded in ${facts.founded}.`);
  if (hq && !mentioned(hq) && !says(/\bbased\b/i))
    sentences.push(facts.dissolved ? `It was based in ${hq}.` : `Based in ${hq}.`);
  if (facts.dissolved) sentences.push(`Closed in ${facts.dissolved}.`);
  if (!sentences.length) return null;
  let text = sentences.join(" ");
  for (const [wrong, right] of ABOUT_CORRECTIONS) text = text.replaceAll(wrong, right);
  return text;
}

function nameKeys(names: string[]) {
  const strong = new Set<string>();
  const loose = new Set<string>();
  for (const n of names) {
    const k = normalizeSearchText(n.replace(/\s*\([^)]*\)\s*/g, " "))
      // "U of Minnesota Press" is "University of Minnesota Press"
      .replace(/\bu of\b/g, "university of");
    if (k) {
      strong.add(k);
      // "AKPress" and "AK Press"
      strong.add(k.replace(/ /g, ""));
    }
    for (const l of publisherLooseKeys(n)) if (l) loose.add(l);
  }
  return { strong, loose };
}
const meets = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));
/** Two loose keys name one house: equal, or one is the other plus words ("city light" and "city light bookstore") */
const related = (a: Set<string>, b: Set<string>) =>
  [...a].some((x) =>
    [...b].some((y) => x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)),
  );

/**
 * How well an item's names fit the house: 4 its label is the house's name;
 * 3 its label is an alias of the house, or one of its aliases is the name;
 * 2 an alias of each meets; 1 the label is a close form of a name (loose
 * key); 0 only an alias is close, which a stray alias can cause ("Random
 * House Publishing Group" on Dell Publishing).
 */
export function nameRank(
  house: { name: string; aliases: string[] },
  item: { label: string | null; aliases: string[] },
): number {
  const name = nameKeys([house.name]);
  const aliases = nameKeys(house.aliases);
  const label = nameKeys(item.label ? [item.label] : []);
  const theirs = nameKeys(item.aliases);
  if (meets(name.strong, label.strong)) return 4;
  if (meets(aliases.strong, label.strong) || meets(name.strong, theirs.strong)) return 3;
  if (meets(aliases.strong, theirs.strong)) return 2;
  const ours = new Set([...name.loose, ...aliases.loose]);
  if (related(ours, label.loose)) return 1;
  return related(ours, theirs.loose) ? 0 : -1;
}

/** Countries a description names: "American publisher" → US */
const DEMONYMS: [RegExp, string][] = [
  [/\b(american|u\.?s\.?)\b/i, "US"],
  [/\b(british|english|scottish|welsh|uk)\b/i, "GB"],
  [/\birish\b/i, "IE"],
  [/\bcanadian\b/i, "CA"],
  [/\baustralian\b/i, "AU"],
  [/\b(new zealand)\b/i, "NZ"],
  [/\bindian\b/i, "IN"],
  [/\bfrench\b/i, "FR"],
  [/\bgerman\b/i, "DE"],
  [/\bdutch\b/i, "NL"],
  [/\bbelgian\b/i, "BE"],
  [/\bspanish\b/i, "ES"],
  [/\bitalian\b/i, "IT"],
  [/\bmexican\b/i, "MX"],
  [/\bjapanese\b/i, "JP"],
  [/\bczech\b/i, "CZ"],
  [/\bswedish\b/i, "SE"],
  [/\bsouth african\b/i, "ZA"],
];
export function describedCountries(description: string | null): string[] {
  if (!description) return [];
  // "Anglo-American" names two countries; take neither as a fact
  if (/anglo-american/i.test(description)) return [];
  const found = DEMONYMS.filter(([re]) => re.test(description)).map(([, c]) => c);
  return found.length === 1 ? found : [];
}

/**
 * A person's research: take this item or no item, whatever the rules say,
 * and the house's country when Wikidata has none.
 */
export type ReviewDecision = {
  accept?: string;
  reject?: true;
  /** Filled only when the house has no country */
  country?: string;
  note: string;
};

export function planHouse(
  h: HouseEvidence,
  ctx: PlanContext & {
    alpha2Of: (id: string) => string | null;
    review?: ReviewDecision;
  },
): HousePlan {
  const plan: HousePlan = { match: null, evidence: [], held: [], conflicts: [], fill: {} };
  const researched = () => {
    if (ctx.review?.country && !h.country && !plan.fill.country) {
      plan.fill.country = ctx.review.country;
      plan.evidence.push(`country researched: ${ctx.review.note}`);
    }
    return plan;
  };
  if (ctx.review?.reject) {
    plan.held.push(`reviewed: no item (${ctx.review.note})`);
    return researched();
  }
  const alpha2 = (text: string | null) => {
    const id = text ? resolveCountry(text, ctx.countryLookup) : null;
    return id ? ctx.alpha2Of(id) : null;
  };
  const stated = new Set(
    splitCountries(h.country)
      .map(alpha2)
      .filter((c): c is string => !!c),
  );
  // The books: their publication countries and ISBN groups
  const published = new Map<string, number>();
  for (const e of h.editions) {
    const c = alpha2(e.country);
    if (c) published.set(c, (published.get(c) ?? 0) + 1);
  }
  const [top] = [...published.entries()].sort((a, b) => b[1] - a[1]);
  const majority =
    top && top[1] >= 2 && top[1] / [...published.values()].reduce((s, n) => s + n, 0) >= 0.6
      ? top[0]
      : null;
  const groups = h.editions
    .map((e) => isbnCountries(e.isbn, ctx.countryLookup, ctx.alpha2Of))
    .filter((g): g is string[] => !!g);
  const isbnAllowed = groups.length ? new Set(groups.flat()) : null;
  const parents = nameKeys([h.parent, h.grandparent].filter((p): p is string => !!p));
  const years = h.editions
    .filter((e) => e.direct !== false)
    .map((e) => e.year)
    .filter((y): y is number => !!y);
  const newest = years.length ? Math.max(...years) : null;

  type Fit = {
    item: WikidataItem;
    rank: number;
    countries: Set<string>;
    /** The countries come from the description, not from P17 */
    described: boolean;
    parent: boolean;
    /** Filed as a publisher, not only described as one */
    byClass: boolean;
  };
  const fits: Fit[] = [];
  const seen = new Set<string>();
  const reviewed = ctx.review?.accept ?? null;
  for (const item of ctx.candidates) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (reviewed && item.id !== reviewed) continue;
    const rank = nameRank(h, item);
    if (rank < 0) continue;
    // A person is never a publishing house, even "British publisher" Peter Owen
    if (item.classes.includes("Q5")) continue;
    // Some publishers are filed only as a business; their description says
    // what they are. Taken only when the name itself matches, and only when
    // no item filed as a publisher fits (see below).
    const byClass = item.classes.some((c) => ctx.publisherClasses.has(c));
    const byDescription =
      !byClass && rank >= 3 && /\b(publish\w*|imprint)\b/i.test(item.description ?? "");
    if (!byClass && !byDescription) continue;
    const fromP17 = item.countries
      .map((c) => ctx.items[c]?.alpha2)
      .filter((c): c is string => !!c);
    const countries = new Set(fromP17.length ? fromP17 : describedCountries(item.description));
    const parentNames = item.parents.map((p) => ctx.items[p]?.label ?? "").filter(Boolean);
    const parent = parents.loose.size > 0 && meets(parents.loose, nameKeys(parentNames).loose);
    if (rank === 0 && !parent && !reviewed) continue;
    const who = `${item.label ?? item.id} (${item.id})`;
    // Anything the catalogue knows that contradicts the item rules it out.
    // A country the catalogue states outranks where its copies were printed.
    const statedAgrees = stated.size > 0 && meets(stated, countries);
    if (!reviewed) {
      if (stated.size && countries.size && !statedAgrees) {
        plan.conflicts.push(
          `${who} is in ${[...countries].join("/")}; the catalogue says ${h.country}`,
        );
        continue;
      }
      if (!statedAgrees && majority && countries.size && !countries.has(majority)) {
        plan.held.push(`${who} is in ${[...countries].join("/")}; its books were published in ${majority}`);
        continue;
      }
      if (!statedAgrees && isbnAllowed && countries.size && !meets(isbnAllowed, countries)) {
        plan.held.push(`${who} is in ${[...countries].join("/")}; its books' ISBNs belong elsewhere`);
        continue;
      }
      // A house that closed before its own books came out is another house.
      // (No check for "founded after": reprints and a group's older imprints
      // carry earlier years.)
      if (item.dissolved && newest && newest > item.dissolved + 2) {
        plan.held.push(`${who} closed in ${item.dissolved}; its books came out until ${newest}`);
        continue;
      }
    }
    fits.push({ item, rank, countries, described: !fromP17.length, parent, byClass });
  }

  // Items filed as publishers outrank items only described as one
  if (fits.some((f) => f.byClass))
    for (let i = fits.length - 1; i >= 0; i--) if (!fits[i].byClass) fits.splice(i, 1);
  // The best fit: the best name rank, then the same parent house
  const best = Math.max(...fits.map((f) => f.rank));
  let pool = fits.filter((f) => f.rank === best);
  if (pool.length > 1 && pool.some((f) => f.parent)) pool = pool.filter((f) => f.parent);
  if (pool.length > 1) {
    plan.held.push(
      `${pool.length} Wikidata items fit: ${pool.map((f) => `${f.item.label} (${f.item.id})`).join(", ")}`,
    );
    return researched();
  }
  const fit = pool[0];
  if (!fit) {
    if (reviewed) plan.held.push(`reviewed item ${reviewed} is not a publisher here`);
    return researched();
  }

  const support: string[] = [];
  if (reviewed && ctx.review) support.push(`reviewed: ${ctx.review.note}`);
  if (stated.size && meets(stated, fit.countries))
    support.push(`country agrees (${h.country})${fit.described ? " by its description" : ""}`);
  if (majority && fit.countries.has(majority)) support.push(`its books were published in ${majority}`);
  if (fit.parent) support.push(`same parent house`);
  if (isbnAllowed && meets(isbnAllowed, fit.countries) && fit.rank >= 2)
    support.push(`ISBN group fits ${[...fit.countries].join("/")}`);
  const unique = fits.length === 1;
  const confidence = support.length
    ? "high"
    : fit.rank >= 3 && unique
      ? "medium"
      : null;
  if (!confidence) {
    plan.held.push(`only a similar name: ${fit.item.label} (${fit.item.id}), and nothing in the catalogue confirms it`);
    return researched();
  }
  plan.evidence = support.length ? support : ["the only publisher on Wikidata with this name"];

  const label = (id: string | undefined) => (id ? (ctx.items[id]?.label ?? null) : null);
  const website =
    fit.item.websites.find((w) => /^https:\/\//i.test(w)) ??
    fit.item.websites.find((w) => /^http:\/\//i.test(w)) ??
    null;
  const facts: Match["facts"] = {
    label: fit.item.label,
    description: fit.item.description,
    countries: [...fit.countries],
    founded: fit.item.founded,
    dissolved: fit.item.dissolved,
    headquarters: label(fit.item.headquarters[0]),
    website,
    parents: fit.item.parents.map(label).filter((p): p is string => !!p),
    enwiki: fit.item.enwiki,
  };
  plan.match = { id: fit.item.id, confidence, facts };

  // A country read from a description is filled only when evidence backs the match
  if (!h.country && fit.countries.size === 1 && (!fit.described || confidence === "high")) {
    const name = regionName([...fit.countries][0]);
    if (name) plan.fill.country = name;
  }
  if (!h.website && website) plan.fill.website = website;
  const about = aboutText(facts);
  if (!h.description && about) plan.fill.description = about;
  return researched();
}
