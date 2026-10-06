import { titlesAgree } from "@/lib/books/enrichment";
import { isbn13To10 } from "@/lib/match/plan";
import type { TermHit } from "@/lib/wikidata/api";

/*
 * Identity resolution (SLN-464): which Open Library work, Wikidata item, OCLC
 * work and LCCN a book is. Pure rules over the answers a run fetched into its
 * cache. The order: the Open Library edition by ISBN-13, then its work; the
 * Wikidata items whose P648 is that work, plus the work's own Wikidata link
 * (exact when they agree); a Wikidata title search by author QID, which
 * always goes to review. Raise IDENTITY_RULES_VERSION whenever a rule here
 * changes: it is every claim's extractor version.
 */

export const IDENTITY_RULES_VERSION = "identity-rules-1";

/** The identity dimensions of vocabulary v1, in the order a sweep applies them: the QID first */
export const IDENTITY_DIMENSIONS = ["wikidata_qid", "open_library_work", "oclc_work", "lccn"] as const;
export type IdentityDimension = (typeof IDENTITY_DIMENSIONS)[number];
export type WorkDimension = Exclude<IdentityDimension, "lccn">;

/** The form each ID is stored in */
export const ID_PATTERNS: Record<IdentityDimension, RegExp> = {
  wikidata_qid: /^Q[1-9]\d*$/,
  open_library_work: /^OL[1-9]\d*W$/,
  oclc_work: /^[1-9]\d*$/,
  // A prefix of up to three letters, a year of two or four digits, a six-digit serial
  lccn: /^[a-z]{0,3}\d{8}(\d{2})?$/,
};

/** Confidence: an exact match, one path without a cross-link, a title search or a contradiction */
export const CONFIDENCE = { exact: 1, onePath: 0.7, review: 0.4 } as const;

/**
 * An LCCN in the Library of Congress's normalised form: no blanks, nothing
 * from a slash on, and a hyphenated serial padded to six digits. Null when
 * the result is not an LCCN.
 */
export function normalizeLccn(raw: string): string | null {
  let lccn = raw.replace(/\s+/g, "").split("/")[0].toLowerCase();
  const hyphen = lccn.indexOf("-");
  if (hyphen >= 0) {
    const serial = lccn.slice(hyphen + 1);
    if (!/^\d{1,6}$/.test(serial)) return null;
    lccn = lccn.slice(0, hyphen) + serial.padStart(6, "0");
  }
  return ID_PATTERNS.lccn.test(lccn) ? lccn : null;
}

/** The id of an Open Library key: "/works/OL1W" is OL1W */
export function openLibraryId(key: string, kind: "W" | "M" | "A"): string | null {
  const id = key.split("/").pop() ?? "";
  return new RegExp(`^OL[1-9]\\d*${kind}$`).test(id) ? id : null;
}

// ── The answers a run keeps in its cache ────────────────────────────────────

/** An Open Library edition record: the fields identity reads */
export interface OpenLibraryEdition {
  key: string;
  title: string | null;
  works: { key: string }[];
  isbn_13: string[];
  isbn_10: string[];
  lccn: string[];
}
/** An Open Library work record: the fields identity reads */
export interface OpenLibraryWork {
  key: string;
  title: string | null;
  authors: { author: { key: string } }[];
  identifiers: { wikidata: string[] };
}
/** The Wikidata properties identity reads, with Wikidata's best-ranked values */
export const ITEM_PROPERTIES = ["P31", "P50", "P577", "P629", "P648", "P5331"] as const;
export interface WikidataItem {
  /** The item's own id: a redirect's target */
  id: string;
  label: string | null;
  claims: Record<(typeof ITEM_PROPERTIES)[number], string[]>;
}

/** Cache keys, one per lookup */
export const ANSWER = {
  edition: (isbn13: string) => `openlibrary:isbn:${isbn13}`,
  work: (id: string) => `openlibrary:work:${id}`,
  linkedItems: (workId: string) => `wikidata:p648:${workId}`,
  item: (qid: string) => `wikidata:item:${qid}`,
  search: (title: string, authorQid: string) => `wikidata:search:${authorQid}:${title}`,
};

/** "Version, edition or translation" (Q3331189) */
const EDITION_CLASS = "Q3331189";
/** An edition item: it is an edition of a work (P629) or of the edition class. Never taken as the work. */
export const isEditionItem = (item: WikidataItem) => item.claims.P629.length > 0 || item.claims.P31.includes(EDITION_CLASS);

/** The earliest publication year of an item (P577), or null */
export function earliestYear(item: WikidataItem): number | null {
  const years = item.claims.P577.map((t) => Number(/^[+-]?(\d+)-/.exec(t)?.[1])).filter((y) => Number.isFinite(y) && y > 0);
  return years.length ? Math.min(...years) : null;
}

// ── A book, and its plan ────────────────────────────────────────────────────

export interface IdentityEdition {
  id: string;
  title: string;
  /** Its ISBN-13, or the ISBN-13 of its ISBN-10 */
  isbn13: string | null;
  year: number | null;
  /** A locked edition resolves its work, but nothing is proposed for it */
  locked: boolean;
}

export interface IdentityBook {
  workId: string;
  slug: string;
  title: string;
  /** The Wikidata QIDs of its authors */
  authorQids: string[];
  /** The Open Library ids of its authors (OL…A) */
  authorOpenLibraryIds: string[];
  /** Placeholders left out */
  editions: IdentityEdition[];
  /** Accepted values and registered identifiers of the book */
  known: Partial<Record<WorkDimension, string>>;
  /** The accepted or registered LCCN of each edition */
  knownLccn: Record<string, string>;
  /** QIDs and Open Library work ids registered for another book */
  taken: Record<string, { workId: string; slug: string }>;
}

/** Where an answer is stored: the book, or one of its editions */
export interface Owner {
  kind: "book" | "edition";
  id: string;
}
/** One value a decision used: the exact text at `path` in the stored answer */
export interface EvidenceRef {
  answer: string;
  owner: Owner;
  path: string[];
  excerpt: string;
}

export interface IdentityProposal {
  dimension: IdentityDimension;
  editionId?: string;
  value: string;
  confidence: number;
  note: string;
  evidence: EvidenceRef[];
}

export type IdentityResult = "resolved" | "review" | "not_found" | "collision";

export interface IdentityPlan {
  result: IdentityResult;
  proposals: IdentityProposal[];
  /** Held, never proposed: an ID registered for another book */
  collisions: { dimension: WorkDimension; value: string; workId: string; slug: string }[];
  /** Reported only */
  notes: string[];
  /** The lookups tried */
  tried: string[];
  /** What each path found: for the run's yield */
  found: { edition: boolean; work: boolean; byP648: boolean; byLink: boolean; bySearch: boolean };
}

/** The cache a plan reads: a SourceCache */
export interface Answers {
  get(key: string): { answer: unknown; retrievedAt: string } | undefined;
}

/** Where the edition's ISBN is listed in the record, if it is: either list, any position */
export function listedIsbn(record: OpenLibraryEdition, isbn13: string): { path: string[]; excerpt: string } | null {
  const at13 = record.isbn_13.indexOf(isbn13);
  if (at13 >= 0) return { path: ["isbn_13", String(at13)], excerpt: isbn13 };
  const isbn10 = isbn13To10(isbn13);
  const at10 = isbn10 ? record.isbn_10.indexOf(isbn10) : -1;
  return at10 >= 0 ? { path: ["isbn_10", String(at10)], excerpt: isbn10! } : null;
}

/** The QIDs a book's Open Library works lead to: P648 items and the works' own links */
export function linkedQids(workIds: string[], answers: Answers): string[] {
  const read = <T>(key: string) => answers.get(key)?.answer as T | null | undefined;
  return [
    ...new Set(
      workIds.flatMap((id) => [...(read<string[]>(ANSWER.linkedItems(id)) ?? []), ...(read<OpenLibraryWork>(ANSWER.work(id))?.identifiers.wikidata ?? [])]),
    ),
  ].filter((q) => ID_PATTERNS.wikidata_qid.test(q));
}

/** The Open Library works the book's editions name, from their ISBN records */
export function editionWorks(book: Pick<IdentityBook, "editions">, answers: Answers): string[] {
  const ids = book.editions.flatMap((e) => {
    const record = e.isbn13 ? (answers.get(ANSWER.edition(e.isbn13))?.answer as OpenLibraryEdition | null | undefined) : null;
    return record && listedIsbn(record, e.isbn13!) ? record.works.map((w) => openLibraryId(w.key, "W")) : [];
  });
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** The titles a title search tries: the work's, and each edition's that differs */
export const searchTitles = (book: Pick<IdentityBook, "title" | "editions">) => [
  ...new Set([book.title, ...book.editions.map((e) => e.title)].map((t) => t.trim()).filter(Boolean)),
];

/**
 * One book's plan from the cached answers: what to propose, with which
 * confidence and evidence, what is held, and what is only reported.
 */
export function planIdentity(book: IdentityBook, answers: Answers): IdentityPlan {
  const plan: IdentityPlan = {
    result: "not_found",
    proposals: [],
    collisions: [],
    notes: [],
    tried: [],
    found: { edition: false, work: false, byP648: false, byLink: false, bySearch: false },
  };
  const read = <T>(key: string) => answers.get(key)?.answer as T | null | undefined;
  const bookOwner: Owner = { kind: "book", id: book.workId };
  const years = book.editions.map((e) => e.year).filter((y): y is number => !!y);
  const firstYear = years.length ? Math.min(...years) : null;

  /** Adds a proposal under the re-run rules; an ID another book holds is held instead */
  const offer = (p: IdentityProposal) => {
    if ((p.dimension === "wikidata_qid" || p.dimension === "open_library_work") && book.taken[p.value]) {
      if (!plan.collisions.some((c) => c.value === p.value)) plan.collisions.push({ dimension: p.dimension, value: p.value, ...book.taken[p.value] });
      return;
    }
    const known = p.dimension === "lccn" ? book.knownLccn[p.editionId!] : book.known[p.dimension];
    if (known === p.value) return;
    if (known) Object.assign(p, { confidence: CONFIDENCE.review, note: `${p.note}; differs from the accepted ID ${known}` });
    const same = plan.proposals.find((q) => q.dimension === p.dimension && q.editionId === p.editionId && q.value === p.value);
    if (!same) return void plan.proposals.push(p);
    // A second path to one value: its evidence is added, and the lower confidence holds
    same.evidence.push(...p.evidence.filter((e) => !same.evidence.some((s) => s.answer === e.answer && s.path.join() === e.path.join())));
    if (p.confidence < same.confidence) Object.assign(same, { confidence: p.confidence, note: p.note });
  };

  // 1. The Open Library edition of each ISBN-13, and the works it names
  const works = new Map<string, EvidenceRef[]>();
  let oneWorkPerEdition = true;
  let titlesMatch = true;
  for (const e of book.editions) {
    if (!e.isbn13) continue;
    const answer = ANSWER.edition(e.isbn13);
    plan.tried.push(`Open Library ISBN ${e.isbn13}`);
    const record = read<OpenLibraryEdition>(answer);
    if (!record) continue;
    const owner: Owner = { kind: "edition", id: e.id };
    const listed = listedIsbn(record, e.isbn13);
    if (!listed) {
      plan.notes.push(`The Open Library record for ${e.isbn13} does not list that ISBN: not used`);
      continue;
    }
    const isbn: EvidenceRef = { answer, owner, ...listed };
    plan.found.edition = true;
    const titleAgrees = titlesAgree(record.title, e.title) || titlesAgree(record.title, book.title);
    if (!titleAgrees) titlesMatch = false;
    if (record.works.length !== 1) oneWorkPerEdition = false;
    record.works.forEach((w, i) => {
      const id = openLibraryId(w.key, "W");
      if (id) works.set(id, [...(works.get(id) ?? []), isbn, { answer, owner, path: ["works", String(i), "key"], excerpt: w.key }]);
    });

    // The edition's LCCN, from the record that lists its ISBN
    if (e.locked) continue;
    const lccns = new Map<string, number>();
    record.lccn.forEach((raw, i) => {
      const lccn = normalizeLccn(raw);
      if (!lccn) plan.notes.push(`${e.isbn13}: "${raw}" is not an LCCN`);
      else if (!lccns.has(lccn)) lccns.set(lccn, i);
    });
    if (lccns.size > 1) plan.notes.push(`${e.isbn13}: several LCCNs (${[...lccns.keys()].join(", ")}): reported only`);
    if (lccns.size === 1) {
      const [[lccn, i]] = [...lccns];
      offer({
        dimension: "lccn",
        editionId: e.id,
        value: lccn,
        confidence: titleAgrees ? CONFIDENCE.exact : CONFIDENCE.review,
        note: titleAgrees ? "the Open Library edition of its ISBN gives one LCCN" : "the Open Library edition of its ISBN has another title",
        evidence: [isbn, { answer, owner, path: ["lccn", String(i)], excerpt: record.lccn[i] }],
      });
    }
  }

  // 2. The Open Library works, and the Wikidata items they link to
  const workIds = [...works.keys()];
  const workExact = workIds.length === 1 && oneWorkPerEdition && titlesMatch;
  plan.found.work = workIds.length > 0;
  for (const id of workIds) {
    const answer = ANSWER.work(id);
    plan.tried.push(`Open Library work ${id}`);
    const work = read<OpenLibraryWork>(answer);
    const authors = (work?.authors ?? []).map((a) => openLibraryId(a.author.key, "A")).filter((a): a is string => !!a);
    const authorsDiffer = authors.length > 0 && book.authorOpenLibraryIds.length > 0 && !authors.some((a) => book.authorOpenLibraryIds.includes(a));
    const why = !workExact
      ? workIds.length > 1
        ? "the editions name several Open Library works"
        : "an Open Library edition names several works, or has another title"
      : authorsDiffer
        ? "the Open Library work names other authors"
        : "every ISBN record names this Open Library work";
    offer({
      dimension: "open_library_work",
      value: id,
      confidence: workExact && !authorsDiffer ? CONFIDENCE.exact : CONFIDENCE.review,
      note: why,
      evidence: works.get(id)!,
    });

    // Items whose P648 is this work, and the work's own Wikidata link
    plan.tried.push(`Wikidata items linked to ${id}`);
    const byP648 = read<string[]>(ANSWER.linkedItems(id)) ?? [];
    const byLink = work?.identifiers.wikidata ?? [];
    const items: { item: WikidataItem; evidence: EvidenceRef[]; crossLinked: boolean }[] = [];
    for (const qid of new Set([...byP648, ...byLink])) {
      const itemAnswer = ANSWER.item(qid);
      const item = read<WikidataItem>(itemAnswer);
      if (!item || items.some((i) => i.item.id === item.id)) continue;
      if (isEditionItem(item)) {
        plan.notes.push(`${qid} is an edition item: never taken as the work`);
        continue;
      }
      const p648 = item.claims.P648.indexOf(id);
      const link = byLink.indexOf(qid);
      if (byP648.includes(qid)) plan.found.byP648 = true;
      if (link >= 0) plan.found.byLink = true;
      items.push({
        item,
        evidence: [
          ...works.get(id)!,
          { answer: itemAnswer, owner: bookOwner, path: ["id"], excerpt: item.id },
          ...(p648 >= 0 ? [{ answer: itemAnswer, owner: bookOwner, path: ["claims", "P648", String(p648)], excerpt: id }] : []),
          ...(link >= 0 ? [{ answer, owner: bookOwner, path: ["identifiers", "wikidata", String(link)], excerpt: qid }] : []),
        ],
        // The item names this work, and the work names this item or no item
        crossLinked: p648 >= 0 && (link >= 0 || byLink.length === 0),
      });
    }
    for (const { item, evidence, crossLinked } of items) {
      const otherWork = item.claims.P648.find((w) => w !== id);
      const authorsDisagree = item.claims.P50.length > 0 && book.authorQids.length > 0 && !item.claims.P50.some((a) => book.authorQids.includes(a));
      const year = earliestYear(item);
      const late = year !== null && firstYear !== null && year > firstYear;
      const agrees = workExact && items.length === 1 && !authorsDisagree && !late;
      const note =
        items.length > 1
          ? `several Wikidata items for ${id}`
          : !crossLinked && otherWork
            ? `Wikidata links it to another Open Library work, ${otherWork}`
            : authorsDisagree
              ? "its authors (P50) are none of the book's"
              : late
                ? `first published ${year}, after the edition of ${firstYear}`
                : !workExact
                  ? "the Open Library work is in review"
                  : crossLinked
                    ? "Wikidata and Open Library link each other"
                    : "only Open Library links it";
      offer({
        dimension: "wikidata_qid",
        value: item.id,
        confidence: agrees && crossLinked ? CONFIDENCE.exact : agrees && !otherWork ? CONFIDENCE.onePath : CONFIDENCE.review,
        note,
        evidence,
      });
    }
  }

  // 3. No item through Open Library: the title search by author QID, always for review
  const viaOpenLibrary = plan.proposals.some((p) => p.dimension === "wikidata_qid") || plan.collisions.some((c) => c.dimension === "wikidata_qid");
  if (!viaOpenLibrary && !book.known.wikidata_qid) {
    if (!book.authorQids.length) plan.notes.push("No author has a Wikidata QID: run the author enrichment first");
    for (const authorQid of book.authorQids)
      for (const title of searchTitles(book)) {
        plan.tried.push(`Wikidata title search "${title}" by ${authorQid}`);
        for (const hit of (read<TermHit[]>(ANSWER.search(title, authorQid)) ?? []).slice(0, 5)) {
          const answer = ANSWER.item(hit.id);
          const item = read<WikidataItem>(answer);
          if (!item || isEditionItem(item)) continue;
          const by = item.claims.P50.indexOf(authorQid);
          plan.found.bySearch = true;
          offer({
            dimension: "wikidata_qid",
            value: item.id,
            confidence: CONFIDENCE.review,
            note: `title search for "${title}"`,
            evidence: [
              { answer, owner: bookOwner, path: ["id"], excerpt: item.id },
              ...(by >= 0 ? [{ answer, owner: bookOwner, path: ["claims", "P50", String(by)], excerpt: authorQid }] : []),
            ],
          });
        }
      }
  }

  // 4. IDs derived from an accepted or exact QID; while the QID is in review, they wait
  const exactQid = plan.proposals.find((p) => p.dimension === "wikidata_qid" && p.confidence === CONFIDENCE.exact)?.value;
  const qid = book.known.wikidata_qid ?? exactQid ?? null;
  if (qid) {
    const answer = ANSWER.item(qid);
    const item = read<WikidataItem>(answer);
    if (item) {
      const from = book.known.wikidata_qid ? "the accepted QID" : "the exact QID";
      const derive = (dimension: WorkDimension, property: "P5331" | "P648") =>
        item.claims[property].forEach((value, i) =>
          offer({
            dimension,
            value,
            confidence: item.claims[property].length === 1 ? CONFIDENCE.exact : CONFIDENCE.review,
            note: item.claims[property].length === 1 ? `the ${property} of ${from}` : `one of several ${property} values of ${from}`,
            evidence: [
              { answer, owner: bookOwner, path: ["id"], excerpt: item.id },
              { answer, owner: bookOwner, path: ["claims", property, String(i)], excerpt: value },
            ],
          }),
        );
      derive("oclc_work", "P5331");
      // Open Library's work from the item only when no ISBN record named one
      if (!workIds.length) derive("open_library_work", "P648");
    }
  } else if (plan.proposals.some((p) => p.dimension === "wikidata_qid")) {
    plan.notes.push("The OCLC work ID waits for the QID's review");
  }

  plan.result = plan.collisions.length
    ? "collision"
    : qid
      ? "resolved"
      : plan.proposals.length
        ? "review"
        : "not_found";
  return plan;
}
