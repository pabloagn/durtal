import { fetchWithTimeout } from "@/lib/api/external-fetch";
import { bestStatements, searchTerms, sparqlSelect, statementIds, statementStrings, wikidataApi, type Claims, type TermHit } from "@/lib/wikidata/api";
import { enrichmentUserAgent } from "./user-agent";
import { QuotaStop, type SourceCache } from "./source-cache";
import {
  ANSWER,
  editionWorks,
  isEditionItem,
  linkedQids,
  searchTitles,
  type IdentityBook,
  type OpenLibraryEdition,
  type OpenLibraryWork,
  type WikidataItem,
} from "./identity";

/*
 * The identity stage's sources (SLN-464). src/lib/providers/ has no book
 * provider, and src/lib/api/open-library.ts reads a failed answer as "not
 * found" (a 429 would look like a missing book), so identity has its own
 * clients here, beside the cache they fill. Every call sends the enrichment
 * User-Agent. Open Library calls are paced by the run, and its 429 stops the
 * fetch without caching anything. Wikidata goes through
 * src/lib/wikidata/api.ts, which waits out its own 429s and lag.
 */

const OPEN_LIBRARY = "https://openlibrary.org";

/** Calls at least `ms` apart */
function pacer(ms: number) {
  let last = 0;
  return async <T>(call: () => Promise<T>) => {
    const wait = last + ms - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return call();
  };
}
type Pacer = ReturnType<typeof pacer>;

/** One Open Library JSON record; null for a 404 */
async function openLibrary(path: string, paced: Pacer): Promise<Record<string, unknown> | null> {
  const res = await paced(() =>
    fetchWithTimeout(`${OPEN_LIBRARY}${path}`, { headers: { "User-Agent": enrichmentUserAgent(), Accept: "application/json" } }, 10_000),
  );
  if (res.status === 404) return null;
  // Read before the cache: a refusal is never kept as "no record"
  if (res.status === 429) throw new QuotaStop("Open Library refused a call (HTTP 429): over its rate limit");
  if (!res.ok) throw new Error(`Open Library: HTTP ${res.status}`);
  return res.json();
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const keyed = (value: unknown) =>
  (Array.isArray(value) ? value : []).filter((v): v is { key: string } => typeof v?.key === "string").map((v) => ({ key: v.key }));

/** The fields identity reads from an edition record, as Open Library gives them */
export function readOpenLibraryEdition(d: Record<string, unknown>): OpenLibraryEdition {
  return {
    key: String(d.key),
    title: typeof d.title === "string" ? d.title : null,
    works: keyed(d.works),
    isbn_13: strings(d.isbn_13),
    isbn_10: strings(d.isbn_10),
    lccn: strings(d.lccn),
  };
}

/** The fields identity reads from a work record, as Open Library gives them */
export function readOpenLibraryWork(d: Record<string, unknown>): OpenLibraryWork {
  const authors = (Array.isArray(d.authors) ? d.authors : []) as { author?: { key?: unknown } }[];
  return {
    key: String(d.key),
    title: typeof d.title === "string" ? d.title : null,
    authors: authors.filter((a) => typeof a?.author?.key === "string").map((a) => ({ author: { key: a.author!.key as string } })),
    identifiers: { wikidata: strings((d.identifiers as { wikidata?: unknown } | undefined)?.wikidata) },
  };
}

/** An item's identity statements, the best-ranked ones */
export function readWikidataItem(e: { id: string; labels?: Record<string, { value: string }>; claims?: Claims }): WikidataItem {
  const best = (p: string) => bestStatements(e.claims, p);
  const times = (p: string) =>
    best(p)
      .map((s) => (s.mainsnak?.datavalue?.value as { time?: string } | undefined)?.time)
      .filter((t): t is string => !!t);
  return {
    id: e.id,
    label: e.labels?.en?.value ?? null,
    claims: {
      P31: statementIds(best("P31")),
      P50: statementIds(best("P50")),
      P577: times("P577"),
      P629: statementIds(best("P629")),
      P648: statementStrings(best("P648")),
      P5331: statementStrings(best("P5331")),
    },
  };
}

/** Items, 50 per call, into the cache; a missing item is kept as none, a redirect under its target */
async function readItems(qids: string[], cache: SourceCache) {
  const missing = [...new Set(qids)].filter((q) => /^Q[1-9]\d*$/.test(q) && !cache.get(ANSWER.item(q)));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const data = await wikidataApi({ action: "wbgetentities", ids: batch.join("|"), props: "labels|claims", languages: "en" });
    const entities = Object.values((data.entities ?? {}) as Record<string, { id: string; missing?: string; redirects?: { from: string } }>);
    for (const qid of batch) {
      const e = entities.find((x) => x.id === qid || x.redirects?.from === qid);
      cache.set(ANSWER.item(qid), e && !("missing" in e) ? readWikidataItem(e) : null);
    }
  }
}

/** The lookups that confirm a review file's own values (SLN-464, section 8) */
export interface ReviewLookups {
  qids: string[];
  works: string[];
  isbns: string[];
}

/**
 * Fetches every answer the books' plans read, into the cache, in the
 * stage's order. A cached answer is never asked again. Open Library's 429
 * throws QuotaStop: the answers already fetched stay in the cache.
 */
export async function fetchIdentityAnswers(books: IdentityBook[], cache: SourceCache, pace: number, review: ReviewLookups) {
  const paced = pacer(pace);
  const unique = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];

  const edition = async (isbn: string) => {
    if (cache.get(ANSWER.edition(isbn))) return;
    const record = await openLibrary(`/isbn/${isbn}.json`, paced);
    cache.set(ANSWER.edition(isbn), record && readOpenLibraryEdition(record));
  };
  const work = async (id: string) => {
    if (cache.get(ANSWER.work(id))) return;
    const record = await openLibrary(`/works/${id}.json`, paced);
    cache.set(ANSWER.work(id), record && readOpenLibraryWork(record));
  };

  // 1-2. Book by book: the Open Library edition of each ISBN-13, then the works it names
  for (const [done, book] of books.entries())
    try {
      for (const e of book.editions) if (e.isbn13) await edition(e.isbn13);
      for (const id of editionWorks(book, cache)) await work(id);
    } catch (error) {
      throw error instanceof QuotaStop ? new QuotaStop(error.message, done) : error;
    }
  for (const isbn of review.isbns) await edition(isbn);
  for (const id of review.works) await work(id);
  const workIds = unique([...books.flatMap((b) => editionWorks(b, cache)), ...review.works]);

  // 3. The items whose P648 is one of those works: one query per 50 works
  const unasked = workIds.filter((id) => !cache.get(ANSWER.linkedItems(id)));
  for (let i = 0; i < unasked.length; i += 50) {
    const batch = unasked.slice(i, i + 50);
    const rows = await sparqlSelect(`SELECT ?item ?key WHERE { VALUES ?key { ${batch.map((k) => JSON.stringify(k)).join(" ")} } ?item wdt:P648 ?key . }`);
    for (const id of batch)
      cache.set(ANSWER.linkedItems(id), rows.filter((r) => r.key === id).map((r) => r.item.split("/").pop()!));
  }

  // 4. Those items, the books' accepted QIDs and the review file's
  await readItems([...linkedQids(workIds, cache), ...unique(books.map((b) => b.known.wikidata_qid)), ...review.qids], cache);

  // 5. A book with no item through Open Library: the title search by each author's QID, then its hits
  const hits: string[] = [];
  for (const book of books) {
    if (book.known.wikidata_qid) continue;
    const viaOpenLibrary = linkedQids(editionWorks(book, cache), cache).some((q) => {
      const item = cache.get(ANSWER.item(q))?.answer as WikidataItem | null | undefined;
      return item && !isEditionItem(item);
    });
    if (viaOpenLibrary) continue;
    for (const qid of book.authorQids)
      for (const title of searchTitles(book)) {
        const key = ANSWER.search(title, qid);
        if (!cache.get(key)) cache.set(key, await searchTerms(`${title} haswbstatement:P50=${qid}`, {}, 5));
        hits.push(...((cache.get(key)!.answer as TermHit[] | null) ?? []).slice(0, 5).map((h) => h.id));
      }
  }
  await readItems(hits, cache);
}
