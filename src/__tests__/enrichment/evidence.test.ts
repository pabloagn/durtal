import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { canonicalEvidenceUrl } from "@/lib/enrichment/evidence-url";
import { outletForUrl, seedProblems, RESERVED_OUTLET_KEYS, type Outlet } from "@/lib/enrichment/outlets";
import { OUTLET_SEED } from "@/lib/enrichment/outlets-seed";
import { fingerprint, sameText } from "@/lib/enrichment/fingerprint";
import { readEvidencePage, readEvidenceText } from "@/lib/enrichment/evidence-store";
import { BudgetStop, metered, monthWindow } from "@/lib/enrichment/meter";
import { costOf, priceFor, type PriceRow } from "@/lib/enrichment/prices";
import { evidenceRawKey, evidenceTextKey } from "@/lib/s3/keys";
import type { EvidenceObjects } from "@/lib/s3/evidence-objects";

/* The evidence store's pure parts (SLN-468): URLs, the registry, fingerprints, reads and the meter's rules */

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const memory = (entries: Record<string, Buffer> = {}): EvidenceObjects => ({
  putIfMissing: async (key, body) => (key in entries ? false : ((entries[key] = body), true)),
  get: async (key) => entries[key] ?? null,
});

describe("canonical URLs", () => {
  it("drops the fragment and tracking parameters, lowercases the host and keeps the rest in order", () => {
    expect(canonicalEvidenceUrl("https://WWW.Example.com:443/a/b?b=2&utm_source=x&a=1&fbclid=y&gclid=z#top")).toBe("https://www.example.com/a/b?b=2&a=1");
    expect(canonicalEvidenceUrl("https://example.com/a?utm_medium=social")).toBe("https://example.com/a");
  });
});

describe("the outlet registry", () => {
  const outlets = [
    { key: "guardian", domains: ["theguardian.com"], status: "active" as const },
    { key: "guardian-books", domains: ["books.theguardian.com"], status: "active" as const },
    { key: "old", domains: ["old.example"], status: "retired" as const },
  ];

  it("matches a domain and its subdomains, the longest domain first, active outlets only", () => {
    expect(outletForUrl("https://www.theguardian.com/books/x", outlets)?.key).toBe("guardian");
    expect(outletForUrl("https://books.theguardian.com/x", outlets)?.key).toBe("guardian-books");
    expect(outletForUrl("https://nottheguardian.com/x", outlets)).toBeNull();
    expect(outletForUrl("https://old.example/x", outlets)).toBeNull();
  });

  it("finds no problem in the seed: no shared domain, no dotted or reserved key, fetch only with checked terms", () => {
    expect(seedProblems(OUTLET_SEED)).toEqual([]);
    for (const name of ["New York Review of Books", "London Review of Books", "Times Literary Supplement", "The Guardian", "The New York Times", "The New Yorker", "Bookforum", "Words Without Borders", "Asymptote"])
      expect(OUTLET_SEED.some((o) => o.name.includes(name))).toBe(true);
  });

  it("names each problem of a bad seed", () => {
    const base: Outlet = { key: "a", name: "A", domains: ["a.example"], kind: "review", language: null, weight: 0.5, syndicationGroup: null, fetchPolicy: "fetch", termsUrl: null, termsCheckedOn: "2026-10-07", termsNote: null, status: "active" };
    const problems = seedProblems([
      base,
      { ...base, key: "a.b", domains: ["a.example"] },
      { ...base, key: RESERVED_OUTLET_KEYS[0], domains: ["c.example"], termsCheckedOn: null },
    ]);
    expect(problems.join("\n")).toMatch(/a\.b: a key is a slug with no dot/);
    expect(problems.join("\n")).toMatch(/a\.example is also a's/);
    expect(problems.join("\n")).toMatch(/wikidata: a reserved provider name/);
    expect(problems.join("\n")).toMatch(/wikidata: fetch needs the day its terms were checked/);
  });
});

describe("fingerprints", () => {
  const review =
    "Malaparte's Kaputt is a book of the war seen from the dinner tables of the Axis, where princes and generals talk while the east burns. The prose turns every horror into a tableau, and the narrator never quite admits what he saw or what he did. It is the strangest book about the Second World War.";

  it("matches a syndicated pair: the same review with a new headline and a byline", () => {
    const copy = `Book of the week. By a staff writer. ${review} Read more reviews on our site.`;
    expect(sameText(fingerprint(review), fingerprint(copy)).same).toBe(true);
  });

  it("does not match two different reviews of one book", () => {
    const other =
      "Curzio Malaparte wrote Kaputt partly in Finland and Poland in 1943. Critics still argue how much of it is reportage and how much invention, but its set pieces, the frozen horses of Lake Ladoga above all, are unforgettable images of the Eastern Front.";
    expect(sameText(fingerprint(review), fingerprint(other)).same).toBe(false);
  });

  it("ignores case and punctuation, and is the same twice", () => {
    expect(fingerprint("It was, the BEST of times!")).toEqual(fingerprint("it was the best of times"));
  });
});

describe("reading stored evidence", () => {
  const text = "The main text, in NFC: Liberation and café.";
  const textSha256 = sha(Buffer.from(text, "utf8"));

  it("returns a text whose hash matches, reads a missing object as purged, and refuses a mismatch", async () => {
    expect(await readEvidenceText(textSha256, memory({ [evidenceTextKey(textSha256)]: Buffer.from(text) }))).toEqual({ status: "ok", value: text });
    expect(await readEvidenceText(textSha256, memory())).toEqual({ status: "purged" });
    await expect(readEvidenceText(textSha256, memory({ [evidenceTextKey(textSha256)]: Buffer.from("changed") }))).rejects.toThrow(/does not match its hash/);
  });

  it("decodes a stored page with its charset once its hash matches", async () => {
    const raw = Buffer.from("<p>Libération</p>", "latin1");
    const rawSha256 = sha(raw);
    const payload = { kind: "evidence_page", rawKey: evidenceRawKey(rawSha256), rawSha256, charset: "windows-1252" };
    const read = await readEvidencePage({ payload: pagePayload(payload) }, memory({ [evidenceRawKey(rawSha256)]: gzipSync(raw) }));
    expect(read).toEqual({ status: "ok", value: "<p>Libération</p>" });
  });
});

/** A full page payload around the fields a read needs */
function pagePayload(over: Record<string, unknown>) {
  const textSha256 = "a".repeat(64);
  return {
    kind: "evidence_page",
    retrievedVia: "fetch",
    outlet: "lrb",
    requestedUrl: "https://www.lrb.co.uk/x",
    finalUrl: "https://www.lrb.co.uk/x",
    canonicalUrl: null,
    httpStatus: 200,
    contentType: "text/html",
    charset: "utf-8",
    rawSha256: "b".repeat(64),
    rawBytes: 1,
    rawStoredBytes: 1,
    rawKey: evidenceRawKey("b".repeat(64)),
    textSha256,
    textChars: 1,
    textBytes: 1,
    textKey: evidenceTextKey(textSha256),
    title: null,
    byline: null,
    publishedOn: null,
    language: null,
    extractor: { name: "x", version: "1" },
    fetcherVersion: "sln468.1",
    robots: { url: "https://www.lrb.co.uk/robots.txt", status: 200, group: "*", rule: null, decision: "allowed", crawlDelay: null, fetchedAt: "2026-10-07T00:00:00.000Z" },
    fingerprint: { method: "m", values: Array(128).fill(0) },
    runId: null,
    jobId: null,
    ...over,
  };
}

describe("the meter's rules", () => {
  const prices: PriceRow[] = [{ provider: "search", operation: "query", usdPerUnit: { queries: 0.005 }, source: "https://example.com/prices", readOn: "2026-10-07" }];

  it("refuses a provider or an operation without a price, and a unit the price does not name", () => {
    expect(() => priceFor("search", "other", prices)).toThrow(/No price for search other/);
    expect(costOf({ queries: 4 }, prices[0])).toBeCloseTo(0.02);
    expect(() => costOf({ tokens: 1 }, prices[0])).toThrow(/no unit tokens/);
  });

  it("stops before any call when no cap is set", async () => {
    let called = false;
    const call = async () => ((called = true), { result: 1, units: { queries: 1 } });
    await expect(metered({ provider: "search", operation: "query", estimate: { queries: 1 }, prices, capUsd: null }, call)).rejects.toThrow(BudgetStop);
    expect(called).toBe(false);
  });

  it("takes the calendar month in the app's time zone", () => {
    // 23:30 UTC on 31 October is already 1 November in Amsterdam (UTC+1 in winter)
    const late = monthWindow(new Date("2026-10-31T23:30:00Z"), "Europe/Amsterdam");
    expect(late.start.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(late.end.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    // October starts on summer time (UTC+2) and ends on winter time
    const october = monthWindow(new Date("2026-10-15T12:00:00Z"), "Europe/Amsterdam");
    expect(october.start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(october.end.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
});
