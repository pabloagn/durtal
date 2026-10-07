import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDED, LINKED_ITEMS } from "@/__tests__/fixtures/enrichment/identity/answers";

/*
 * SLN-464: the identity stage's clients on recorded answers. Open Library
 * goes through a stubbed fetch; the Wikidata calls are stubbed where the
 * stage makes them, and the Wikidata client's own User-Agent is checked
 * once against fetch. No network.
 */

const wikidata = vi.hoisted(() => ({ sparql: [] as string[], items: [] as string[][], searches: [] as string[] }));
vi.mock("@/lib/wikidata/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wikidata/api")>();
  return {
    ...actual,
    // The reverse P648 lookup answers from the recorded items' own P648
    sparqlSelect: async (query: string) => {
      wikidata.sparql.push(query);
      return Object.entries(LINKED_ITEMS).flatMap(([key, qids]) =>
        query.includes(`"${key}"`) ? qids.map((q) => ({ item: `http://www.wikidata.org/entity/${q}`, key })) : [],
      );
    },
    wikidataApi: async (params: Record<string, string>) => {
      const ids = params.ids.split("|");
      wikidata.items.push(ids);
      return {
        entities: Object.fromEntries(
          ids.map((id) => [id, RECORDED[`https://www.wikidata.org/wiki/${id}`] ?? { id, missing: "" }]),
        ),
      };
    },
    searchTerms: async (query: string) => {
      wikidata.searches.push(query);
      return [];
    },
  };
});
import { fetchIdentityAnswers } from "@/lib/enrichment/identity-sources";
import { ANSWER, type IdentityBook } from "@/lib/enrichment/identity";
import { QuotaStop, SourceCache } from "@/lib/enrichment/source-cache";

const CONTACT = "durtal@example.org";
const AGENT = `DurtalBot/1.0 (personal book catalogue; ${CONTACT})`;
const NO_REVIEW = { qids: [], works: [], isbns: [] };
const book = (title: string, isbn13: string, authorQids: string[] = []): IdentityBook => ({
  workId: `work-${title}`,
  slug: title,
  title,
  authorQids,
  authorOpenLibraryIds: [],
  editions: [{ id: `edition-${title}`, title, isbn13, year: null, locked: false }],
  known: {},
  knownLccn: {},
  taken: {},
});

describe("the identity clients", () => {
  const calls: { url: string; agent: string | null }[] = [];
  /** Open Library from the recorded answers; a 404 for the rest, or the status a test names */
  const respond = (status: Record<string, number> = {}) =>
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, agent: new Headers(init.headers).get("User-Agent") });
      const body = RECORDED[url];
      const code = status[url] ?? (body ? 200 : 404);
      return new Response(code === 200 ? JSON.stringify(body) : "{}", { status: code });
    });
  beforeEach(() => {
    calls.length = 0;
    Object.assign(wikidata, { sparql: [], items: [], searches: [] });
    vi.stubEnv("ENRICHMENT_CONTACT", CONTACT);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches each answer once, in the stage's order, every Open Library call with the enrichment User-Agent", async () => {
    respond();
    const cache = SourceCache.memory();
    const books = [book("Life and Fate", "9781784871963"), book("Kaputt", "9781590171479", ["Q90000001"])];
    await fetchIdentityAnswers(books, cache, 0, NO_REVIEW);
    expect(calls.map((c) => c.url)).toEqual([
      "https://openlibrary.org/isbn/9781784871963.json",
      "https://openlibrary.org/works/OL157104W.json",
      "https://openlibrary.org/isbn/9781590171479.json",
      "https://openlibrary.org/works/OL1272994W.json",
    ]);
    expect(new Set(calls.map((c) => c.agent))).toEqual(new Set([AGENT]));
    // One reverse P648 query for both works; the items it and the works' links name; a title search for the book with none
    expect(wikidata.sparql).toHaveLength(1);
    expect(wikidata.sparql[0]).toContain('VALUES ?key { "OL157104W" "OL1272994W" }');
    expect(wikidata.items).toEqual([["Q979609"]]);
    expect(wikidata.searches).toEqual(["Kaputt haswbstatement:P50=Q90000001"]);
    expect(cache.get(ANSWER.linkedItems("OL1272994W"))!.answer).toEqual([]);
    expect(cache.get(ANSWER.item("Q979609"))!.answer).toMatchObject({ id: "Q979609", claims: { P648: ["OL157104W"] } });
    // A second fetch asks nothing again
    await fetchIdentityAnswers(books, cache, 0, NO_REVIEW);
    expect(calls).toHaveLength(4);
    expect(wikidata.sparql).toHaveLength(1);
  });

  it("keeps a missing record as none, and stops on a 429 without keeping it, counting the books done", async () => {
    const refused = "https://openlibrary.org/isbn/9781590176221.json";
    respond({ [refused]: 429 });
    const cache = SourceCache.memory();
    const books = [book("Unknown", "9780000000002"), book("The Skin", "9781590176221")];
    const stop = await fetchIdentityAnswers(books, cache, 0, NO_REVIEW).catch((e: unknown) => e);
    expect(stop).toBeInstanceOf(QuotaStop);
    expect(stop).toMatchObject({ done: 1, message: "Open Library refused a call (HTTP 429): over its rate limit" });
    expect(cache.get(ANSWER.edition("9780000000002"))!.answer).toBeNull();
    expect(cache.get(ANSWER.edition("9781590176221"))).toBeUndefined();
  });

  it("refuses to call out without a contact; the Wikidata client reads it at each call", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ENRICHMENT_CONTACT", "");
    respond();
    await expect(fetchIdentityAnswers([book("Life and Fate", "9781784871963")], SourceCache.memory(), 0, NO_REVIEW)).rejects.toThrow(
      "ENRICHMENT_CONTACT is not set",
    );
    vi.stubEnv("ENRICHMENT_CONTACT", CONTACT);
    const { wikidataApi } = await vi.importActual<typeof import("@/lib/wikidata/api")>("@/lib/wikidata/api");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, agent: new Headers(init.headers).get("User-Agent") });
      return new Response(JSON.stringify({ entities: {} }), { status: 200 });
    });
    await wikidataApi({ action: "wbgetentities", ids: "Q979609" });
    expect(calls.at(-1)).toMatchObject({ url: expect.stringContaining("www.wikidata.org/w/api.php"), agent: AGENT });
  });
});
