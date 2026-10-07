import { describe, expect, it } from "vitest";
import { RESEARCH_CONFIG, EXTRACTION_MODEL } from "@/lib/enrichment/research/config";
import { aboutWork, passagesOf } from "@/lib/enrichment/research/text";
import { answerSchema, buildRequest, EXTRACTOR_VERSION, PROMPT_VERSION, requestHash, type ExtractDimension } from "@/lib/enrichment/research/request";
import { verifyValue } from "@/lib/enrichment/research/verify";
import { checkIndependence, type EvidenceRow } from "@/lib/enrichment/research/independence";
import { conflictsOf } from "@/lib/enrichment/research/conflicts";
import { CONFLICT_CAP, researchConfidence } from "@/lib/enrichment/research/confidence";
import { fingerprint } from "@/lib/enrichment/fingerprint";

/*
 * SLN-469: the extract stage's pure rules (the relevance gate, the passages,
 * the request, R3 and R4, R6, the conflicts and the confidence), on texts
 * written for these tests.
 */

const profile = { titles: ["The Rings of Saturn", "Die Ringe des Saturn"], authors: [{ name: "W. G. Sebald", surname: "Sebald" }] };
const term = (key: string, scaleValue: number | null = null) => ({
  key,
  label: key,
  definition: `The ${key} definition.`,
  appliesWhen: `When ${key} applies.`,
  doesNotApplyWhen: `When ${key} does not apply.`,
  scaleValue,
});
const tone: ExtractDimension = { key: "tone", label: "Tone", definition: "The book's tone.", valueKind: "terms", terms: [term("melancholic"), term("comic")], exclusive: [] };
const pace: ExtractDimension = { key: "pace", label: "Pace", definition: "How fast it reads.", valueKind: "scale", terms: [term("fast", 1), term("medium", 2), term("slow", 3)], exclusive: [] };
const form: ExtractDimension = { key: "form", label: "Form", definition: "The form.", valueKind: "term", terms: [term("novel"), term("essay")], exclusive: [] };
const level: ExtractDimension = {
  key: "speculative_level",
  label: "Speculative level",
  definition: "How far from realism.",
  valueKind: "terms",
  terms: [term("realist"), term("fantastic"), term("magical")],
  exclusive: [["realist", "fantastic"], ["realist", "magical"]],
};

describe("the relevance gate", () => {
  it("needs a title and an author's surname, each as whole words, in any case", () => {
    expect(aboutWork("SEBALD wrote The Rings of Saturn in 1995.", profile).about).toBe(true);
    expect(aboutWork("Sebald's Austerlitz is his last novel.", profile).about).toBe(false);
    expect(aboutWork("The Rings of Saturnalia, by Sebaldo.", profile).about).toBe(false);
    expect(aboutWork("Die Ringe des Saturn ist ein Buch von Sebald.", profile).about).toBe(true);
  });

  it("counts its match offsets in code points, after an astral character", () => {
    const text = "𝔄 note: Sebald walks.";
    const { matches } = aboutWork(text, { titles: ["walks"], authors: [{ name: "W. G. Sebald", surname: "Sebald" }] });
    expect(matches).toEqual([
      { start: 8, end: 14 },
      { start: 15, end: 20 },
    ]);
    expect([...text].slice(8, 14).join("")).toBe("Sebald");
  });
});

describe("the passages", () => {
  it("sends a short text whole, as one passage", () => {
    expect(passagesOf("Sebald on Suffolk.", [], 100)).toEqual([{ id: "p1", start: 0, end: 18, text: "Sebald on Suffolk." }]);
  });

  it("cuts windows around the matches of a long text, merges those that touch and stops at the limit", () => {
    const text = ".".repeat(10_000) + "Sebald" + ".".repeat(10_000) + "Sebald" + ".".repeat(10_000);
    const matches = aboutWork(text, { titles: ["Sebald"], authors: [{ name: "", surname: "Sebald" }] }).matches;
    const passages = passagesOf(text, matches, 4_000);
    const window = RESEARCH_CONFIG.passageWindow;
    expect(passages.map((p) => [p.id, p.start, p.end])).toEqual([
      ["p1", 10_000 - window, 10_006 + window],
      ["p2", 20_006 - window, 20_006 - window + (4_000 - (6 + 2 * window))],
    ]);
    for (const p of passages) expect(p.text).toBe([...text].slice(p.start, p.end).join(""));
  });

  it("slices by code points, so an astral character never splits", () => {
    const text = "🜲".repeat(30) + " Sebald " + "🜲".repeat(30);
    const [p] = passagesOf(text, [{ start: 31, end: 37 }], 20);
    expect([...p.text]).toHaveLength(20);
    expect(p.text).toBe([...text].slice(p.start, p.end).join(""));
  });
});

describe("the request", () => {
  const passages = [{ id: "p1", start: 0, end: 10, text: "Sebald etc" }];

  it("sends the instructions and vocabulary first with a cache mark, the passages after, and no examples or sampling settings", () => {
    const request = buildRequest(profile, [tone, pace, { ...form, terms: [] }], passages);
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.max_tokens).toBe(EXTRACTION_MODEL.maxOutputTokens);
    expect(request.output_config.effort).toBe("low");
    expect(request.system).toHaveLength(1);
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(request.system[0].text).toContain("## tone: Tone");
    expect(request.system[0].text).toContain("- slow (slow, point 3): The slow definition.");
    // A dimension without a current term is not asked
    expect(request.system[0].text).not.toContain("## form");
    expect(Object.keys(request.output_config.format.schema.properties as object)).toEqual(["tone", "pace"]);
    // No prefill: the last message is the user's
    expect(request.messages).toEqual([{ role: "user", content: expect.stringContaining('<passage id="p1">\nSebald etc\n</passage>') }]);
    expect(request.messages[0].content).toMatch(/^The book: "The Rings of Saturn" or "Die Ringe des Saturn" by W\. G\. Sebald\./);
    for (const banned of ["temperature", "thinking", "top_p", "top_k", "tools", "example"]) expect(JSON.stringify(request)).not.toContain(banned);
  });

  it("hashes the request as sent: the same inputs give the same hash, a changed passage another", () => {
    const a = requestHash(buildRequest(profile, [tone], passages));
    expect(requestHash(buildRequest(profile, [tone], passages))).toBe(a);
    expect(requestHash(buildRequest(profile, [tone], [{ ...passages[0], text: "Sebald etc." }]))).not.toBe(a);
    expect(requestHash(buildRequest(profile, [{ ...tone, terms: [term("melancholic")] }], passages))).not.toBe(a);
  });

  it("names the prompt version and the pinned model in the extractor version", () => {
    expect(EXTRACTOR_VERSION).toMatch(new RegExp(`^${PROMPT_VERSION} claude-opus-5-5 [0-9a-f]{12}$`));
  });

  it("refuses an answer with a term outside the dimension's current terms, or an extra field", () => {
    const schema = answerSchema([tone]);
    expect(schema.safeParse({ tone: [{ term: "melancholic", excerpt: "e", passage: "p1" }] }).success).toBe(true);
    expect(schema.safeParse({ tone: [{ term: "gothic", excerpt: "e", passage: "p1" }] }).success).toBe(false);
    expect(schema.safeParse({ tone: [], mood: [] }).success).toBe(false);
    expect(schema.safeParse({ tone: [{ term: "comic", excerpt: "e", passage: "p1", note: "x" }] }).success).toBe(false);
  });
});

describe("R3 and R4: the checks of a returned value", () => {
  const text = "Before. 𝔄 Sebald’s prose is “a slow, melancholic drift” through Suffolk, café by café. After.";
  const chars = [...text];
  const passages = [{ id: "p1", start: 8, end: 88, text: chars.slice(8, 88).join("") }];
  const terms = new Map([
    ["tone", new Set(["melancholic", "comic"])],
    ["pace", new Set(["slow"])],
  ]);
  const check = (excerpt: string, over: Partial<{ dimension: string; term: string; passage: string }> = {}) =>
    verifyValue({ dimension: "tone", term: "melancholic", passage: "p1", excerpt, ...over }, { chars, passages, terms });

  it("keeps an exact excerpt, with code point offsets that slice it back out", () => {
    const verdict = check("Sebald’s prose is “a slow, melancholic drift”");
    expect(verdict).toEqual({ ok: true, value: { dimension: "tone", term: "melancholic", excerpt: "Sebald’s prose is “a slow, melancholic drift”", start: 10, end: 55 } });
    expect(chars.slice(10, 55).join("")).toBe("Sebald’s prose is “a slow, melancholic drift”");
  });

  it("puts the excerpt in NFC and changes nothing else", () => {
    const nfd = "through Suffolk, café by café".normalize("NFD");
    expect(check(nfd)).toMatchObject({ ok: true, value: { excerpt: "through Suffolk, café by café" } });
  });

  it.each([
    ["a straight quote for a curly one", "Sebald's prose is \"a slow, melancholic drift\""],
    ["an extra space", "Sebald’s prose is  “a slow, melancholic drift”"],
    ["a change of case", "sebald’s prose is “a slow, melancholic drift”"],
    ["an ellipsis", "Sebald’s prose is … melancholic drift”"],
    ["text outside the passage", "Before. 𝔄 Sebald’s prose"],
  ])("drops %s", (_, excerpt) => expect(check(excerpt)).toEqual({ ok: false, check: "not_in_passage" }));

  it("drops an excerpt of a passage the request did not send", () => {
    expect(check("Sebald’s prose is “a slow, melancholic drift”", { passage: "p2" })).toEqual({ ok: false, check: "not_in_passage" });
  });

  it("drops a retired or unknown term, and a term of another dimension (R4)", () => {
    expect(check("Sebald’s prose is “a slow, melancholic drift”", { term: "gothic" })).toEqual({ ok: false, check: "unknown_term" });
    expect(check("Sebald’s prose is “a slow, melancholic drift”", { term: "slow" })).toEqual({ ok: false, check: "unknown_term" });
    expect(check("Sebald’s prose is “a slow, melancholic drift”", { dimension: "mood" })).toEqual({ ok: false, check: "unknown_term" });
  });

  it("drops an empty, a too short and a too long excerpt", () => {
    expect(check("")).toEqual({ ok: false, check: "no_excerpt" });
    expect(check("Sebald’s prose")).toEqual({ ok: false, check: "excerpt_too_short" });
    const long = "a".repeat(RESEARCH_CONFIG.maxExcerptChars + 1);
    const longChars = [...long];
    expect(verifyValue({ dimension: "tone", term: "comic", passage: "p1", excerpt: long }, { chars: longChars, passages: [{ id: "p1", start: 0, end: long.length, text: long }], terms })).toEqual({
      ok: false,
      check: "excerpt_too_long",
    });
  });
});

describe("R6: independent sources", () => {
  const row = (over: Partial<EvidenceRow>): EvidenceRow => ({
    sourceRecordId: crypto.randomUUID(),
    method: "agent",
    outlet: "nyrb",
    outletKind: "review",
    weight: 1,
    syndicationGroup: null,
    byline: null,
    fingerprint: null,
    excerpt: "a slow, melancholic drift through Suffolk",
    ...over,
  });

  it("passes two outlets with their own words", () => {
    const result = checkIndependence([row({}), row({ outlet: "lrb", excerpt: "a book of mourning, walked slowly" })]);
    expect([result.count, result.passes]).toEqual([2, true]);
  });

  it.each([
    ["one outlet", { outlet: "nyrb", excerpt: "another sentence entirely here" }],
    ["one syndication group", { outlet: "guardian", syndicationGroup: "gnm", excerpt: "another sentence entirely here" }],
    ["one byline", { outlet: "lrb", byline: " James Wood ", excerpt: "another sentence entirely here" }],
    ["a quote", { outlet: "lrb", excerpt: "As one critic put it, A slow melancholic drift through Suffolk!" }],
  ])("merges the documents of %s into one source", (_, over) => {
    const first = row({ syndicationGroup: "gnm", byline: "James Wood" });
    expect(checkIndependence([first, row(over)]).count).toBe(1);
  });

  it("merges near-duplicate texts, and merges transitively", () => {
    const text = "Sebald walks the coast of Suffolk and finds in each ruin the history of an empire. ".repeat(20);
    const a = row({ fingerprint: fingerprint(text) });
    const b = row({ outlet: "lrb", excerpt: "different words one", fingerprint: fingerprint(text + " A note.") });
    const c = row({ outlet: "tls", excerpt: "different words two", byline: "Anne Carson" });
    const d = row({ outlet: "nyt", excerpt: "different words three", byline: "anne carson" });
    expect(checkIndependence([a, b]).count).toBe(1);
    expect(checkIndependence([a, c, d]).count).toBe(2);
    // b is a's text and c's byline: all three are one source
    expect(checkIndependence([a, c, { ...b, byline: "Anne Carson" }]).count).toBe(1);
  });

  it("never counts publisher or translator pages, or Pablo's own answers, toward the two", () => {
    const result = checkIndependence([row({}), row({ outlet: "pub", outletKind: "publisher", excerpt: "other words" }), row({ outlet: "tr", outletKind: "translator", excerpt: "more words" })]);
    expect([result.sources.length, result.count, result.passes]).toEqual([3, 1, false]);
    expect(checkIndependence([row({}), row({ outlet: "export", method: "human", excerpt: "other words" })]).sources).toHaveLength(1);
  });
});

describe("conflicts", () => {
  const verified = (...terms: string[]) => new Map(terms.map((t) => [t, "NYRB"]));

  it("finds two values of a one-value dimension, naming the other and its source", () => {
    expect(conflictsOf(form, verified("novel", "essay"), [])).toEqual(
      new Map([
        ["novel", ["conflicts with essay (NYRB)"]],
        ["essay", ["conflicts with novel (NYRB)"]],
      ]),
    );
  });

  it("lets a several-value dimension hold two terms, unless the seed makes them exclusive", () => {
    expect(conflictsOf(tone, verified("melancholic", "comic"), []).size).toBe(0);
    expect([...conflictsOf(level, verified("realist", "fantastic"), []).keys()]).toEqual(["realist", "fantastic"]);
    expect(conflictsOf(level, verified("fantastic", "magical"), []).size).toBe(0);
    expect(conflictsOf(level, verified("magical"), [{ term: "realist", method: "human", status: "accepted", source: "Pablo" }])).toEqual(
      new Map([["magical", ["conflicts with realist (Pablo)"]]]),
    );
  });

  it("finds scale points two or more apart, not neighbours", () => {
    expect(conflictsOf(pace, verified("fast", "medium"), []).size).toBe(0);
    expect(conflictsOf(pace, verified("fast", "slow"), []).size).toBe(2);
  });

  it("finds a single value that differs from another method's, but not from another agent proposal", () => {
    expect(conflictsOf(form, verified("novel"), [{ term: "essay", method: "api", status: "proposed", source: "wikidata" }])).toEqual(
      new Map([["novel", ["conflicts with essay (wikidata)"]]]),
    );
    expect(conflictsOf(form, verified("novel"), [{ term: "essay", method: "agent", status: "proposed", source: "LRB" }]).size).toBe(0);
    expect(conflictsOf(tone, verified("comic"), [{ term: "melancholic", method: "human", status: "accepted", source: "Pablo" }]).size).toBe(0);
  });
});

describe("researchConfidence", () => {
  it("adds independent sources by their weight", () => {
    expect(researchConfidence({ sources: [{ weight: 1 }], conflict: false })).toBe(0.5);
    expect(researchConfidence({ sources: [{ weight: 1 }, { weight: 1 }], conflict: false })).toBe(0.75);
    expect(researchConfidence({ sources: [{ weight: 1 }, { weight: 1 }, { weight: 1 }], conflict: false })).toBe(0.88);
    expect(researchConfidence({ sources: [{ weight: 0.8 }, { weight: 0.4 }], conflict: false })).toBe(0.52);
  });

  it("moves 0.05 with the text metrics, and a conflict caps it", () => {
    expect(researchConfidence({ sources: [{ weight: 1 }], conflict: false, support: "agrees" })).toBe(0.55);
    expect(researchConfidence({ sources: [{ weight: 1 }], conflict: false, support: "disagrees" })).toBe(0.45);
    expect(researchConfidence({ sources: [{ weight: 1 }, { weight: 1 }], conflict: true })).toBe(CONFLICT_CAP);
    expect(researchConfidence({ sources: [], conflict: false })).toBe(0);
  });
});
