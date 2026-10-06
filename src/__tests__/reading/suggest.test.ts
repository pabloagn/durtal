import { describe, expect, it } from "vitest";
import { isAtHand } from "@/lib/reading/at-hand";
import { nextVolume } from "@/lib/reading/series";
import { buildContext } from "@/lib/reading/suggest/build";
import { FEATURES, WITHOUT_RATINGS, bayesianMean, betaTrust, boughtText } from "@/lib/reading/suggest/features";
import { parseSuggestionParams, suggestionQuery, DEFAULT_SUGGESTION_PARAMS } from "@/lib/reading/suggest/params";
import { GATE_MIN_BOOKS, evaluatePredictions, gateDue, nextGate, predict, predictionText, type Evaluation } from "@/lib/reading/suggest/predict";
import { worthRereading } from "@/lib/reading/suggest/rereads";
import { REASON_SHARE, candidates, diversify, hiddenByFeedback, passes, pausedAuthors, pickOne, reasonsOf, scoreBook, suggest, weightedPick } from "@/lib/reading/suggest/score";
import { suggestionRow } from "@/lib/reading/suggest/view";
import type { QueueEdition } from "@/lib/reading/queue";
import type { SuggestBook, SuggestLoad } from "@/lib/reading/suggest/types";

/* The suggestion engine's pure rules (SLN-457), on small fixtures. */

const TODAY = "2026-10-05";
const HOME = "00000000-0000-4000-8000-0000000000a1";
let serial = 0;

const edition = (pages: number | null, copies: Partial<QueueEdition["copies"][number]>[] = [], language = "en"): QueueEdition => ({
  id: `e${++serial}`,
  title: null,
  language,
  pageCount: pages,
  thumbnail: null,
  audioMinutes: null,
  copies: copies.map((c) => ({ id: `i${++serial}`, status: "available", format: "paperback", locationId: HOME, locationType: "physical", locationName: "Amsterdam", subLocationName: null, ...c })),
});

function book(title: string, over: Partial<SuggestBook> = {}): SuggestBook {
  return {
    id: `w-${title}`,
    title,
    slug: null,
    authors: [],
    translatorIds: [],
    recommenders: [],
    terms: [],
    seriesId: null,
    seriesTitle: null,
    seriesPosition: null,
    workTypeId: null,
    originalLanguage: "en",
    isFavourite: false,
    isPoison: false,
    catalogueStatus: "accessioned",
    rating: null,
    taste: null,
    finishedCount: 0,
    open: false,
    hasReading: false,
    lastFinishedOn: null,
    readSinceFinish: false,
    owned: true,
    queuePlace: null,
    queueEditionId: null,
    firstAcquired: null,
    lastAcquired: null,
    atHandCopyId: null,
    atHandHomes: [],
    editions: [edition(300)],
    cover: null,
    feedback: null,
    ...over,
  };
}

/** A finished, rated book: taste evidence */
const read = (title: string, taste: number, over: Partial<SuggestBook> = {}) => book(title, { taste, rating: taste, finishedCount: 1, hasReading: true, lastFinishedOn: "2020-01-01", ...over });

function context(books: SuggestBook[], over: Partial<SuggestLoad> = {}) {
  return buildContext({
    today: TODAY,
    homeId: HOME,
    homes: [{ id: HOME, name: "Amsterdam" }],
    books,
    queueLength: books.filter((b) => b.queuePlace !== null).length,
    priors: { byLanguageFormat: {}, byFormat: {}, overall: null } as never,
    hideAnathema: false,
    gate: null,
    ...over,
  });
}

const feature = (key: string) => FEATURES.find((f) => f.key === key)!;
const author = (name: string) => ({ id: `a-${name}`, name, slug: null });

describe("taste evidence", () => {
  it("learns only from finished books: a rating with no finished reading is never taste evidence", () => {
    const ctx = context([read("Là-bas", 4.5), read("À rebours", 3.5), book("Bought, rated 5", { rating: 5 })]);
    expect(ctx.rated.map((b) => b.title)).toEqual(["Là-bas", "À rebours"]);
    expect(ctx.meanTaste).toBe(4);
    // The beta base rate of 4 or more: (1 + 1) / (2 + 2)
    expect(ctx.baseLiked).toBe(0.5);
  });
});

describe("the author feature", () => {
  const huysmans = author("Huysmans");
  it("takes the Bayesian mean of the author's other rated books against C", () => {
    expect(bayesianMean([4.5, 4, 4.5], 3.5)).toBeCloseTo((13 + 7) / 5, 10);
    const ctx = context([
      read("Là-bas", 4.5, { authors: [huysmans] }),
      read("À rebours", 4, { authors: [huysmans] }),
      read("En route", 4.5, { authors: [huysmans] }),
      read("Other", 2),
      read("Other 2", 2.5),
    ]);
    const r = feature("author").compute(book("La Cathédrale", { authors: [huysmans] }), ctx)!;
    expect(r.meets).toBe(true);
    expect(r.reason).toBe("You rated 3 of Huysmans's books 4.3 on average");
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("gives no reason below 2 rated books by the author", () => {
    const ctx = context([read("Là-bas", 5, { authors: [huysmans] }), read("Other", 2), read("Other 2", 3)]);
    const r = feature("author").compute(book("La Cathédrale", { authors: [huysmans] }), ctx)!;
    expect(r.meets).toBe(false);
    expect(r.score).toBeGreaterThan(0.5);
    expect(feature("author").compute(book("Unknown author", { authors: [author("Nobody")] }), ctx)).toBeNull();
  });
});

describe("the recommender feature", () => {
  const m = { id: "r-m", name: "M." };
  it("estimates trust as a beta of picks rated 4 or more against his base rate", () => {
    expect(betaTrust(5, 6)).toBe(0.75);
    const ctx = context([
      ...[5, 4.5, 4, 4, 4.5].map((t, i) => read(`Pick ${i}`, t, { recommenders: [m] })),
      read("Pick 5", 2, { recommenders: [m] }),
      read("Other", 2),
      read("Other 2", 3),
    ]);
    const r = feature("recommender").compute(book("New pick", { recommenders: [m] }), ctx)!;
    expect([r.reason, r.meets]).toEqual(["M. recommended it; you rated 5 of their 6 picks 4 or more", true]);
    expect(r.evidence[0]).toMatchObject({ label: "M.", href: "/recommenders/r-m", id: "r-m" });
  });

  it("gives no reason below 3 rated picks", () => {
    const ctx = context([read("Pick 0", 5, { recommenders: [m] }), read("Pick 1", 5, { recommenders: [m] }), read("Other", 2)]);
    expect(feature("recommender").compute(book("New pick", { recommenders: [m] }), ctx)!.meets).toBe(false);
  });
});

describe("the taste feature", () => {
  const decadence = { key: "m:decadence", name: "Decadence" };
  const occult = { key: "t:occult", name: "the occult" };
  const french = { key: "l:fr", name: "French" };
  const c19 = { key: "cy:19", name: "19th century" };

  it("has no data with an empty taxonomy or no ratings", () => {
    expect(feature("taste").compute(book("Bare"), context([read("A", 4), read("B", 3)]))).toBeNull();
    expect(feature("taste").compute(book("Tagged", { terms: [decadence] }), context([book("Unread", { terms: [decadence] })]))).toBeNull();
  });

  it("weighs shared terms by IDF and names the ones 3 rated books share", () => {
    const liked = (t: string) => read(t, 4.5, { terms: [decadence, occult, french, c19] });
    const ctx = context([liked("Là-bas"), liked("À rebours"), liked("Monsieur de Phocas"), liked("Le Vice suprême"), read("Plain", 2, { terms: [french] }), read("Plain 2", 2.5)]);
    const r = feature("taste").compute(book("Bruges-la-Morte", { terms: [decadence, occult, french] }), ctx)!;
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.meets).toBe(true);
    expect(r.reason).toMatch(/^Shares (Decadence and the occult|the occult and Decadence) with 4 books you rated 4 or more$/);
  });

  it("never makes a reason from original language, century or work type alone", () => {
    const coarse = [{ key: "l:fr", name: "French" }, { key: "cy:19", name: "19th century" }, { key: "wt:novel", name: "Novel" }];
    const ctx = context([read("A", 5, { terms: coarse }), read("B", 5, { terms: coarse }), read("C", 5, { terms: coarse }), read("D", 2), read("E", 2)]);
    const r = feature("taste").compute(book("F", { terms: coarse }), ctx)!;
    expect(r.score).toBeGreaterThan(0.5);
    expect([r.reason, r.meets]).toEqual([null, false]);
  });
});

describe("shelf time, at hand, Up Next and recent copies", () => {
  it("counts years on the shelf from the earliest acquisition date, capped at 10, and nothing without one", () => {
    const ctx = context([]);
    expect(feature("shelf").compute(book("Old", { firstAcquired: "2014-03-01" }), ctx)).toMatchObject({ reason: "On your shelves since 2014", meets: true });
    expect(feature("shelf").compute(book("Older", { firstAcquired: "2020-03-01" }), ctx)!.score).toBeCloseTo((Date.parse(TODAY) - Date.parse("2020-03-01")) / 86_400_000 / 365.25 / 10, 2);
    expect(feature("shelf").compute(book("Ancient", { firstAcquired: "1990-01-01" }), ctx)!.score).toBe(1);
    expect(feature("shelf").compute(book("Undated"), ctx)).toBeNull();
  });

  it("never counts a lent copy as at hand, and says where it is; a digital copy is at hand", () => {
    const lent = edition(300, [{ status: "lent_out", lentTo: "M.", lentDate: "2026-05-03" }]);
    expect(lent.copies.some((c) => isAtHand(c, HOME))).toBe(false);
    const ctx = context([book("Lent", { editions: [lent] })]);
    expect(feature("atHand").compute(ctx.books[0], ctx)).toBeNull();
    expect(suggestionRow(scoreBook(ctx.books[0], ctx), ctx).line).toContain("Lent to M. since 3 May");
    const digital = edition(300, [{ locationType: "digital", locationId: "00000000-0000-4000-8000-0000000000d1", locationName: "Kindle" }]);
    expect(digital.copies.some((c) => isAtHand(c, HOME))).toBe(true);
    const onKindle = book("Kindle", { editions: [digital], atHandCopyId: digital.copies[0].id });
    expect(feature("atHand").compute(onKindle, context([onKindle]))).toMatchObject({ reason: "Digital", score: 1 });
    // Said once: the reason says "Digital", so the card's line leaves it out
    const kindleCtx = context([onKindle]);
    const row = suggestionRow(scoreBook(onKindle, kindleCtx), kindleCtx);
    expect(row.reasons).toContain("Digital");
    expect(row.line.split(" · ")).not.toContain("Digital");
  });

  it("weighs Up Next by place and says when a copy came", () => {
    const ctx = context([book("First", { queuePlace: 1 }), book("Third", { queuePlace: 3 }), book("Second", { queuePlace: 2 })]);
    expect(feature("upNext").compute(ctx.books[1], ctx)).toMatchObject({ reason: "In your Up Next, 3rd", score: 0.5 });
    expect(feature("upNext").compute(ctx.books[0], ctx)!.score).toBe(1);
    expect([3, 10, 21, 40, 75].map(boughtText)).toEqual(["Bought this week", "Bought last week", "Bought 3 weeks ago", "Bought last month", "Bought 2 months ago"]);
    expect(feature("recent").compute(book("New", { lastAcquired: "2026-09-01" }), ctx)).toMatchObject({ reason: "Bought last month" });
    expect(feature("recent").compute(book("Old", { lastAcquired: "2026-01-01" }), ctx)).toBeNull();
  });
});

describe("series", () => {
  it("suggests the next volume to read, as nextToRead finds it, with the last one's rating when it is taste evidence", () => {
    const s = { seriesId: "s1", seriesTitle: "Les Rougon-Macquart" };
    const books = [
      read("La Fortune des Rougon", 4, { ...s, seriesPosition: "1" }),
      read("La Curée", 4.5, { ...s, seriesPosition: "2" }),
      book("Le Ventre de Paris", { ...s, seriesPosition: "3" }),
      book("La Conquête de Plassans", { ...s, seriesPosition: "4" }),
    ];
    const ctx = context(books);
    expect(nextVolume(ctx.series.get("s1")!)?.title).toBe("Le Ventre de Paris");
    expect(feature("series").compute(books[2], ctx)).toMatchObject({ score: 1, reason: "Next in Les Rougon-Macquart after La Curée (you gave it 4.5)" });
    expect(feature("series").compute(books[3], ctx)).toBeNull();
    // Without taste evidence on the last volume read, no rating
    const plain = context([book("One", { ...s, seriesPosition: "1", finishedCount: 1 }), book("Two", { ...s, seriesPosition: "2" })]);
    expect(feature("series").compute(plain.books[1], plain)!.reason).toBe("Next in Les Rougon-Macquart after One");
  });
});

describe("scoring and reasons", () => {
  it("sums the weighted features that have data, and shows a reason only from 15% of the score", () => {
    const ctx = context([]);
    const b = book("Shelf only", { firstAcquired: "2020-01-01", queuePlace: 1 });
    const s = scoreBook(b, context([b]));
    expect(s.contributions.map((c) => c.key).sort()).toEqual(["shelf", "upNext"]);
    expect(s.score).toBeCloseTo(s.contributions.reduce((t, c) => t + c.value, 0), 10);
    const tiny = { key: "shelf" as const, label: "Shelf time", weight: 1, score: 0.1, value: 0.1, share: REASON_SHARE - 0.01, reason: "On your shelves since 2025", meets: true, evidence: [] };
    const big = { ...tiny, key: "upNext" as const, share: 0.86, value: 0.86, reason: "In your Up Next, 1st" };
    expect(reasonsOf([tiny, big])).toEqual(["In your Up Next, 1st"]);
    expect(reasonsOf([{ ...tiny, share: REASON_SHARE }])).toEqual(["On your shelves since 2025"]);
    expect(reasonsOf([{ ...big, meets: false }])).toEqual([]);
    expect(ctx.books).toEqual([]);
  });

  it("keeps the top of the list varied: maximal marginal relevance", () => {
    const zola = author("Zola");
    const books = [
      ...["A", "B", "C", "D"].map((t, i) => book(`Zola ${t}`, { authors: [zola], queuePlace: i + 1 })),
      book("Other", { queuePlace: 5, originalLanguage: "de" }),
    ];
    const ctx = context(books);
    const ranked = diversify(books.map((b) => scoreBook(b, ctx)));
    // By score alone the four Zolas lead; MMR brings the other book up to second
    expect(ranked.map((s) => s.book.title).slice(0, 2)).toEqual(["Zola A", "Other"]);
  });

  it("orders equal scores by the day, not by title: the same all day, another the next", () => {
    // No ratings: every book is at hand and nothing else, so all score alike
    const books = "ABCDEFGHIJKLMNOPQRST".split("").map((t) => book(`${t} book`, { editions: [edition(300, [{}])] }));
    books.forEach((b) => (b.atHandCopyId = b.editions[0].copies[0].id));
    const titles = (today: string) => suggest(context(books, { today }), DEFAULT_SUGGESTION_PARAMS).map((s) => s.book.title);
    const monday = titles("2026-10-05");
    expect(new Set(suggest(context(books), DEFAULT_SUGGESTION_PARAMS).map((s) => s.score)).size).toBe(1);
    expect(monday).toHaveLength(20);
    expect(titles("2026-10-05")).toEqual(monday);
    expect(titles("2026-10-06")).not.toEqual(monday);
    expect(monday.slice(0, 10)).not.toEqual(books.slice(0, 10).map((b) => b.title));
    // A higher score still leads, whatever the day
    const series = book("Z book", { editions: [edition(300, [{}])], queuePlace: 1 });
    series.atHandCopyId = series.editions[0].copies[0].id;
    expect(suggest(context([...books, series], { today: "2026-10-06", queueLength: 1 }), DEFAULT_SUGGESTION_PARAMS)[0].book.title).toBe("Z book");
  });
});

describe("candidates, feedback and constraints", () => {
  it("leaves out finished, open, hidden and paused books, and Anathema when asked", () => {
    const rejected = (title: string, day: string, reasons = ["prose"]) => ({ verdict: "rejected" as const, reasons: reasons as never, note: null, until: null, source: "suggestions" as const, createdAt: `${day}T10:00:00Z`, updatedAt: `${day}T10:00:00Z` });
    const books = [
      book("Free"),
      read("Done", 4),
      book("Open", { open: true }),
      book("Never", { feedback: { ...rejected("", "2026-09-01"), verdict: "never" } }),
      book("Not now", { feedback: { ...rejected("", "2026-09-30"), verdict: "not_now", until: "2026-10-30" } }),
      book("Not now, expired", { feedback: { ...rejected("", "2026-08-01"), verdict: "not_now", until: "2026-08-31" } }),
      book("Rejected", { feedback: rejected("", "2026-09-20") }),
      book("Poison", { isPoison: true }),
    ];
    expect(candidates(context(books)).map((b) => b.title)).toEqual(["Free", "Not now, expired", "Poison"]);
    expect(candidates(context(books, { hideAnathema: true })).map((b) => b.title)).toEqual(["Free", "Not now, expired"]);
    expect(hiddenByFeedback(books[4], TODAY)).toBe(true);
  });

  it("pauses an author after two rejections within 30 days", () => {
    const gray = author("Gray");
    const reject = (day: string) => ({ verdict: "rejected" as const, reasons: ["too_long"] as never, note: null, until: null, source: "suggestions" as const, createdAt: `${day}T10:00:00Z`, updatedAt: `${day}T10:00:00Z` });
    const books = [book("Lanark", { authors: [gray], feedback: reject("2026-09-20") }), book("1982, Janine", { authors: [gray], feedback: reject("2026-10-01") }), book("Poor Things", { authors: [gray] })];
    expect([...pausedAuthors(context(books)).entries()]).toEqual([["a-Gray", { name: "Gray", until: "2026-10-31" }]]);
    expect(candidates(context(books)).map((b) => b.title)).toEqual([]);
    // Rejections 40 days apart pause nothing
    const apart = [book("Lanark", { authors: [gray], feedback: reject("2026-08-10") }), book("1982, Janine", { authors: [gray], feedback: reject("2026-09-25") }), book("Poor Things", { authors: [gray] })];
    expect(candidates(context(apart)).map((b) => b.title)).toEqual(["Poor Things"]);
  });

  it("lowers books longer than one he passed on as too long, for 30 days", () => {
    const too = { verdict: "rejected" as const, reasons: ["too_long"] as never, note: null, until: null, source: "suggestions" as const, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" };
    const lanark = book("Lanark", { editions: [edition(560)], feedback: too });
    const shorter = book("Short", { editions: [edition(180)], firstAcquired: "2020-01-01" });
    const longer = book("Long", { editions: [edition(900)], firstAcquired: "2020-01-01" });
    const ctx = context([lanark, shorter, longer]);
    expect(feature("feedback").compute(shorter, ctx)).toMatchObject({ reason: "Shorter than Lanark, which you passed on as too long", meets: false });
    // It raises the shorter book and shows in Why this?, never as a card reason
    const short = scoreBook(shorter, ctx);
    expect(short.contributions.find((c) => c.key === "feedback")?.value).toBeGreaterThan(0);
    expect(short.reasons).not.toContain("Shorter than Lanark, which you passed on as too long");
    const s = scoreBook(longer, ctx);
    expect(s.contributions.find((c) => c.key === "feedback")).toMatchObject({ factor: 0.5 });
    expect(s.score).toBeCloseTo(s.contributions.reduce((t, c) => t + c.value, 0) * 0.5, 10);
    // 31 days later the rule is gone
    expect(feature("feedback").compute(longer, context([lanark, shorter, longer], { today: "2026-10-21" }))).toBeNull();
  });

  it("filters by scope, length, about N pages, language, a home, work types and new series", () => {
    const s = { seriesId: "s1", seriesTitle: "S" };
    const books = [
      book("Short", { editions: [edition(150)] }),
      book("Medium", { editions: [edition(320, [], "fr")], queuePlace: 1, workTypeId: "t-poetry" }),
      book("Long", { editions: [edition(520)], owned: false, catalogueStatus: "wanted" }),
      book("No pages", { editions: [edition(null)] }),
      book("First of a series", { ...s, seriesPosition: "1", atHandHomes: [HOME] }),
    ];
    const ctx = context(books);
    const titles = (p: Partial<typeof DEFAULT_SUGGESTION_PARAMS>) => books.filter((b) => passes(b, ctx, { ...DEFAULT_SUGGESTION_PARAMS, ...p })).map((b) => b.title);
    expect(titles({})).toEqual(["Short", "Medium", "No pages", "First of a series"]);
    expect(titles({ scope: "all" })).toHaveLength(5);
    expect(titles({ scope: "next" })).toEqual(["Medium"]);
    expect(titles({ scope: "wanted" })).toEqual(["Long"]);
    expect(titles({ scope: "all", length: "short" })).toEqual(["Short"]);
    expect(titles({ scope: "all", length: "medium" })).toEqual(["Medium", "First of a series"]);
    expect(titles({ scope: "all", length: "long" })).toEqual(["Long"]);
    expect(titles({ scope: "all", length: "about", about: 500 })).toEqual(["Long"]);
    expect(titles({ scope: "all", length: "about", about: 340 })).toEqual(["Medium", "First of a series"]);
    expect(titles({ lang: "fr" })).toEqual(["Medium"]);
    expect(titles({ home: HOME })).toEqual(["First of a series"]);
    expect(titles({ skipTypes: ["t-poetry"] })).toEqual(["Short", "No pages", "First of a series"]);
    expect(titles({ noNewSeries: true })).toEqual(["Short", "Medium", "No pages"]);
  });

  it("parses the constraints once for the page and the API: a bad value is an issue and is dropped", () => {
    expect(parseSuggestionParams({ scope: "next", length: "about", about: "500", noNewSeries: "1", page: "2" }).params).toMatchObject({ scope: "next", length: "about", about: 500, noNewSeries: true, page: 2 });
    const bad = parseSuggestionParams(new URLSearchParams("scope=shelf&lang=French&home=nope&colour=red&length=about"));
    expect(bad.params).toEqual(DEFAULT_SUGGESTION_PARAMS);
    expect(bad.issues.map((i) => i.path)).toEqual(["scope", "lang", "home", "colour"]);
    expect(parseSuggestionParams({ skipTypes: `${HOME},${HOME}` }).params.skipTypes).toEqual([HOME, HOME]);
    expect(suggestionQuery({ ...DEFAULT_SUGGESTION_PARAMS, scope: "all", length: "about", about: 500, page: 3 })).toBe("?scope=all&length=about&about=500&page=3");
    expect(suggestionQuery(DEFAULT_SUGGESTION_PARAMS)).toBe("");
  });
});

describe("Pick one for me", () => {
  it("draws among the top ten, weighted by score, and Another leaves out what was shown", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, score: 12 - i }));
    expect(pickOne(items, (i) => i.id, () => 0)?.id).toBe("b0");
    expect(pickOne(items, (i) => i.id, () => 0.999)?.id).toBe("b9");
    expect(pickOne(items, (i) => i.id, () => 0, ["b0"])?.id).toBe("b1");
    expect(weightedPick([], () => 1)).toBeNull();
  });

  it("with no ratings at all, gives only Series, Shelf time, At hand, Up Next and Recent copy reasons", () => {
    const s = { seriesId: "s1", seriesTitle: "S" };
    const kindle = edition(300, [{ locationType: "digital", locationId: "00000000-0000-4000-8000-0000000000d1" }]);
    const books = [
      book("Shelf", { firstAcquired: "2012-01-01", authors: [author("A")], terms: [{ key: "m:x", name: "X" }] }),
      book("Queued", { queuePlace: 1, recommenders: [{ id: "r", name: "M." }] }),
      book("At hand", { editions: [kindle], atHandCopyId: kindle.copies[0].id }),
      book("New copy", { lastAcquired: "2026-09-25" }),
      { ...book("Done", { ...s, seriesPosition: "1" }), finishedCount: 1, hasReading: true },
      book("Next", { ...s, seriesPosition: "2" }),
    ];
    const ctx = context(books);
    expect(ctx.meanTaste).toBeNull();
    const list = suggest(ctx, { ...DEFAULT_SUGGESTION_PARAMS, scope: "all" });
    const labels = new Map(FEATURES.map((f) => [f.key, f.label]));
    for (let i = 0; i < 20; i++) {
      const pick = pickOne(list, (x) => x.book.id, () => i / 20)!;
      expect(pick.reasons.length).toBeGreaterThan(0);
      const keys = pick.contributions.filter((c) => c.reason && pick.reasons.includes(c.reason)).map((c) => c.key);
      expect(keys.every((k) => WITHOUT_RATINGS.includes(k)), `${pick.book.title}: ${keys.map((k) => labels.get(k))}`).toBe(true);
    }
  });
});

describe("the predicted rating and its gate", () => {
  const huysmans = author("Huysmans");
  it("predicts from at least 3 similar rated books with a total similarity of 1, as a half-star range", () => {
    const books = [
      read("Là-bas", 4.5, { authors: [huysmans] }),
      read("À rebours", 4.5, { authors: [huysmans] }),
      read("En route", 4, { authors: [huysmans] }),
      read("Unrelated", 2, { originalLanguage: "de" }),
      read("Unrelated 2", 2.5, { originalLanguage: "de" }),
    ];
    const ctx = context(books);
    const p = predict(book("La Cathédrale", { authors: [huysmans] }), ctx)!;
    expect(p.neighbours.map((x) => x.book.title).sort()).toEqual(["En route", "Là-bas", "À rebours"]);
    expect(p.value).toBeGreaterThan(4);
    expect(predictionText(p)).toBe(p.low === p.high ? `likely ${p.low}` : `likely ${p.low} to ${p.high}`);
    // Two neighbours are not enough
    expect(predict(book("Lone", { authors: [author("Other")] }), context(books.slice(0, 2)))).toBeNull();
  });

  const evaluation = (over: Partial<Evaluation>): Evaluation => ({ n: 40, coverage: 0.8, mae: 0.5, baselineMae: 0.8, ...over });
  const at = (day: number) => new Date(Date.UTC(2026, 9, day, 6));

  it("stays off below 30 rated books, turns on with an error 10% below the baseline, and turns off only after two failing days", () => {
    expect(nextGate(null, evaluation({ n: GATE_MIN_BOOKS - 1 }), at(1)).on).toBe(false);
    expect(nextGate(null, evaluation({ mae: 0.75, baselineMae: 0.8 }), at(1)).on).toBe(false);
    const on = nextGate(null, evaluation({ mae: 0.72, baselineMae: 0.8 }), at(1));
    expect(on).toMatchObject({ on: true, failures: 0, n: 40 });
    const oneFail = nextGate(on, evaluation({ mae: 0.79 }), at(2));
    expect(oneFail).toMatchObject({ on: true, failures: 1 });
    expect(nextGate(oneFail, evaluation({ mae: 0.5 }), at(3))).toMatchObject({ on: true, failures: 0 });
    expect(nextGate(oneFail, evaluation({ mae: 0.79 }), at(3))).toMatchObject({ on: false, failures: 0 });
    expect(nextGate({ ...on, on: false }, evaluation({}), at(4)).on).toBe(true);
  });

  it("runs the check at most once in 24 hours", () => {
    const gate = nextGate(null, evaluation({}), at(1));
    expect([gateDue(null, at(1)), gateDue(gate, new Date(at(1).getTime() + 23 * 3_600_000)), gateDue(gate, new Date(at(1).getTime() + 24 * 3_600_000))]).toEqual([true, false, true]);
  });

  it("evaluates leave-one-out against the mean of the others, over the books that get a prediction", () => {
    const books = [
      ...[4.5, 4.5, 4, 4.5].map((t, i) => read(`H${i}`, t, { authors: [huysmans] })),
      ...[2, 2.5, 2, 2.5].map((t, i) => read(`Z${i}`, t, { authors: [author("Zed")] })),
    ];
    const e = evaluatePredictions(context(books));
    expect(e.n).toBe(8);
    expect(e.coverage).toBe(1);
    expect(e.mae!).toBeLessThan(e.baselineMae!);
    expect(evaluatePredictions(context([read("Alone", 4)]))).toEqual({ n: 1, coverage: 0, mae: null, baselineMae: null });
  });
});

describe("worth re-reading", () => {
  it("offers books finished five years ago or more, rated 4.5 or favourite, not read since", () => {
    const books = [
      read("Nadja", 5, { lastFinishedOn: "2012-06-01" }),
      read("Too recent", 5, { lastFinishedOn: "2023-01-01" }),
      read("Not loved", 4, { lastFinishedOn: "2010-01-01" }),
      read("Favourite", 3.5, { lastFinishedOn: "2015-02-01", isFavourite: true }),
      read("Read since", 5, { lastFinishedOn: "2012-01-01", readSinceFinish: true }),
      read("Being read", 5, { lastFinishedOn: "2012-01-01", open: true }),
    ];
    expect(worthRereading(context(books)).map((r) => r.text)).toEqual(["You gave Nadja 5 in 2012. Read it again?", "Favourite is a favourite, last read in 2015. Read it again?"]);
  });
});
