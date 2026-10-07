import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";
import { RESEARCH_CONFIG, REVIEW_WORDS, TOPIC_WORDS } from "@/lib/enrichment/research/config";
import { fixedQueryWords, planQueries } from "@/lib/enrichment/research/queries";
import { rankCandidates } from "@/lib/enrichment/research/rank";
import { brave, SearchFailure, SearchRefusal, tavily } from "@/lib/enrichment/research/search";
import type { ResearchDimension, ResearchProfile } from "@/lib/enrichment/research/profile";
import type { Outlet } from "@/lib/enrichment/outlets";

/*
 * SLN-469: the research agent's pure rules and its search adapters, on
 * answers written for these tests (no network, no article text).
 */

const outlet = (key: string, over: Partial<Outlet> = {}): Outlet => ({
  key,
  name: key.toUpperCase(),
  domains: [`${key}.example`],
  kind: "review",
  language: "en",
  weight: 0.5,
  syndicationGroup: null,
  fetchPolicy: "fetch",
  termsUrl: null,
  termsCheckedOn: "2026-10-07",
  termsNote: null,
  status: "active",
  ...over,
});
const OUTLETS = [
  outlet("nyrb", { weight: 0.95 }),
  outlet("lrb", { weight: 0.9 }),
  outlet("elpais", { weight: 0.8, language: "es" }),
  outlet("quiet", { weight: 0.85, fetchPolicy: "snippet_only" }),
  outlet("closed", { weight: 0.99, fetchPolicy: "excluded" }),
  outlet("gone", { weight: 0.99, status: "retired" }),
];
const profile = (over: Partial<ResearchProfile> = {}): ResearchProfile => ({
  workId: "w",
  slug: "kaputt",
  titles: ["Kaputt"],
  originalTitle: null,
  authors: [{ name: "Curzio Malaparte", surname: "Malaparte" }],
  translators: [],
  originalLanguage: "en",
  ...over,
});
const dimension = (key: string, layer: "experience" | "facts" = "experience"): ResearchDimension => ({ key, label: key, layer, terms: [] });

describe("research queries", () => {
  it("plans three groups, each within its own limit, for an English book", () => {
    const { queries, withoutTopic } = planQueries(profile(), [dimension("tone"), dimension("prose"), dimension("mood")], OUTLETS, 300);
    expect(queries.map((q) => [q.group, q.text, q.outlets, q.dimensions])).toEqual([
      ["base", "Kaputt Curzio Malaparte review", [], []],
      ["outlets", "Kaputt Curzio Malaparte review", ["nyrb", "lrb", "quiet", "elpais"], []],
      ["topics", "Kaputt Curzio Malaparte tone atmosphere", [], ["tone"]],
      ["topics", "Kaputt Curzio Malaparte prose style", [], ["prose"]],
    ]);
    expect(withoutTopic).toEqual(["mood"]);
  });

  it("asks in the original language, puts its outlets first, and names the translator", () => {
    const { queries } = planQueries(
      profile({ originalLanguage: "es", originalTitle: "Las tierras arrasadas", translators: [{ name: "Frank Wynne", surname: "Wynne" }] }),
      [],
      OUTLETS,
      2,
    );
    expect(queries.map((q) => [q.group, q.text, q.outlets])).toEqual([
      ["base", "Kaputt Curzio Malaparte review", []],
      ["base", "Las tierras arrasadas Curzio Malaparte reseña", []],
      ["base", "Kaputt Curzio Malaparte Wynne", []],
      ["outlets", "Las tierras arrasadas Curzio Malaparte reseña", ["elpais"]],
      ["outlets", "Kaputt Curzio Malaparte review", ["nyrb", "lrb"]],
    ]);
    // A language without a word for "review" gets title and author only
    expect(planQueries(profile({ originalLanguage: "xx" }), [], [], 300).queries[1].text).toBe("Kaputt Curzio Malaparte");
  });

  it("keeps each group to its limit, and topics that share words to one query", () => {
    const dimensions = Object.keys(TOPIC_WORDS).map((key) => dimension(key));
    const { queries } = planQueries(profile({ originalLanguage: "fr", translators: [{ name: "A B", surname: "B" }] }), dimensions, OUTLETS, 1);
    const count = (group: string) => queries.filter((q) => q.group === group).length;
    expect([count("base"), count("outlets"), count("topics")]).toEqual([RESEARCH_CONFIG.maxBaseQueries, RESEARCH_CONFIG.maxOutletQueries, RESEARCH_CONFIG.maxTopicQueries]);
    const genre = planQueries(profile(), [dimension("genre", "facts"), dimension("speculative_level", "facts")], [], 300).queries.filter((q) => q.group === "topics");
    expect(genre).toEqual([{ group: "topics", text: "Kaputt Curzio Malaparte genre", outlets: [], dimensions: ["genre", "speculative_level"] }]);
  });

  it("never holds a fixed word that equals or contains a current term's label or key; a title may", () => {
    const seed = vocabularySeedSchema.parse(JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8")));
    const terms = seed.dimensions.flatMap((d) => d.terms.flatMap((t) => [t.key, t.label].map((w) => w.toLowerCase().replace(/_/g, " "))));
    expect(terms.length).toBeGreaterThan(5);
    for (const word of fixedQueryWords()) for (const term of terms) expect(word.toLowerCase().includes(term), `"${word}" holds the term "${term}"`).toBe(false);
    expect(fixedQueryWords()).toEqual(expect.arrayContaining([REVIEW_WORDS.en, ...Object.values(TOPIC_WORDS)]));
    // A title that holds a term's label is the book's own name: it is kept
    expect(planQueries(profile({ titles: ["Dark Matter"] }), [], [], 300).queries[0].text).toBe("Dark Matter Curzio Malaparte review");
  });
});

describe("research ranking", () => {
  const result = (url: string, rank: number, query = "q", provider = "tavily") => ({ query, provider, result: { url, title: null, rank, snippet: null } });

  it("drops blocked hosts, excluded or unknown outlets; merges equal URLs; orders by weight, then rank; keeps two per outlet", () => {
    const { candidates, dropped } = rankCandidates(
      [
        result("https://www.goodreads.com/book/show/1", 1),
        result("https://app.thestorygraph.com/books/1", 1),
        result("https://closed.example/a", 1),
        result("https://elsewhere.example/a", 1),
        result("https://gone.example/a", 1),
        result("not a url", 1),
        result("https://lrb.example/b?utm_source=x", 5),
        result("https://lrb.example/b", 2, "other"),
        result("https://lrb.example/c", 3),
        result("https://lrb.example/d", 1),
        result("https://nyrb.example/e", 9),
        result("https://elpais.example/f", 1),
      ],
      OUTLETS,
    );
    expect(dropped).toEqual({ blocked_host: 2, off_registry: 2, outlet_excluded: 1, bad_url: 1 });
    expect(candidates.map((c) => [c.outlet.key, c.url, c.rank])).toEqual([
      ["nyrb", "https://nyrb.example/e", 9],
      ["lrb", "https://lrb.example/d", 1],
      ["lrb", "https://lrb.example/b", 2],
      ["elpais", "https://elpais.example/f", 1],
    ]);
  });
});

describe("research search adapters", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("ENRICHMENT_CONTACT", "durtal@example.org");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks Tavily for a basic search, restricted to the outlets' domains, without an answer or page text, and keeps only the result list", async () => {
    answer(200, {
      query: "Kaputt Curzio Malaparte review",
      answer: "A model-written answer that is never used.",
      results: [
        { url: "https://nyrb.example/kaputt", title: "The war at dinner", content: "Text the provider chose.", raw_content: "The whole page.", score: 0.9 },
        { url: "https://lrb.example/kaputt", title: null, content: null, score: 0.5 },
      ],
    });
    const results = await tavily.search({ text: "Kaputt Curzio Malaparte review", domains: ["nyrb.example", "lrb.example"] }, "tvly-test");
    expect(results).toEqual([
      { url: "https://nyrb.example/kaputt", title: "The war at dinner", rank: 1, snippet: "Text the provider chose." },
      { url: "https://lrb.example/kaputt", title: null, rank: 2, snippet: null },
    ]);
    const [{ url, init }] = calls;
    expect(url).toBe("https://api.tavily.com/search");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "Kaputt Curzio Malaparte review",
      search_depth: "basic",
      max_results: RESEARCH_CONFIG.resultsPerQuery,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_domains: ["nyrb.example", "lrb.example"],
    });
    expect(init.headers).toMatchObject({ Authorization: "Bearer tvly-test", "User-Agent": "DurtalBot/1.0 (personal book catalogue; durtal@example.org)" });
  });

  it("asks Brave with the outlets as site: terms, and reads its web results", async () => {
    answer(200, { type: "search", web: { results: [{ url: "https://lrb.example/kaputt", title: "Kaputt", description: "A description." }] } });
    expect(await brave.search({ text: "Kaputt review", domains: ["lrb.example", "nyrb.example"] }, "brave-test")).toEqual([
      { url: "https://lrb.example/kaputt", title: "Kaputt", rank: 1, snippet: "A description." },
    ]);
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("q")).toBe("Kaputt review (site:lrb.example OR site:nyrb.example)");
    expect(calls[0].init.headers).toMatchObject({ "X-Subscription-Token": "brave-test" });
    // No web results is an empty list
    answer(200, { type: "search" });
    expect(await brave.search({ text: "Kaputt review", domains: [] }, "brave-test")).toEqual([]);
  });

  it("reads a rate limit or a quota as a refusal, and a server error or an unreadable answer as a failure", async () => {
    const errors = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const [status, reason] of [[429, "rate_limited"], [432, "quota"], [401, "quota"]] as const) {
        answer(status, { detail: { error: "no" } });
        await expect(tavily.search({ text: "q", domains: [] }, "k")).rejects.toMatchObject({ name: "SearchRefusal", status, reason });
      }
      answer(402, {});
      await expect(brave.search({ text: "q", domains: [] }, "k")).rejects.toBeInstanceOf(SearchRefusal);
      answer(500, {});
      await expect(tavily.search({ text: "q", domains: [] }, "k")).rejects.toBeInstanceOf(SearchFailure);
      answer(200, { results: "not a list" });
      await expect(tavily.search({ text: "q", domains: [] }, "k")).rejects.toBeInstanceOf(SearchFailure);
      // The log names the provider and the status, never a URL, key or body
      expect(errors.mock.calls.map((call) => call[0])).toContain("[research] tavily: HTTP 429");
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(/api\.tavily|Bearer|detail/);
    } finally {
      errors.mockRestore();
    }
  });

  it("keeps snippets off until the providers' terms are recorded", () => {
    for (const provider of [tavily, brave]) expect(provider.snippets).toEqual({ storable: false, copiedFromPage: false });
  });
});
