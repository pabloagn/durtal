import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_SUGGESTIONS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln457_reading_suggestions")
    throw new Error("Suggestion tests require a disposable local sln457_reading_suggestions database");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
const home = vi.hoisted(() => ({ cookie: null as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (home.cookie ? { value: JSON.stringify(home.cookie) } : undefined) }) }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), usePathname: () => "/reading/suggestions", useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: async () => {}, pick: () => {} }) }));
vi.mock("@/components/layout/page-header", async () => {
  const { createElement } = await import("react");
  return { PageHeader: ({ tabs, actions }: { tabs?: ReactNode; actions?: ReactNode }) => createElement("header", null, actions, tabs) };
});
import { setSuggestionFeedback, removeSuggestionFeedback, restoreSuggestionFeedback } from "@/lib/actions/suggestions";
import { getWorkCount } from "@/lib/actions/works";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { nextToRead } from "@/lib/reading/series";
import { getBookPredictionContext, getSuggestionContext, predictionGateOn } from "@/lib/reading/suggest/context";
import { evaluatePredictions, predict, predictionSource, predictionText, type Prediction } from "@/lib/reading/suggest/predict";
import { DEFAULT_SUGGESTION_PARAMS } from "@/lib/reading/suggest/params";
import { candidates, passes, suggest } from "@/lib/reading/suggest/score";
import { readingToday } from "@/lib/reading/day";
import { addDays } from "@/lib/reading/goals";
import { GET as getSuggestions } from "@/app/api/readings/suggestions/route";
import SuggestionsPage from "@/app/reading/suggestions/page";

/* Suggestions against PostgreSQL (SLN-457): the context load, feedback, merges, the gate, the API. */

const TOKEN = "test-suggestions-token";

describe.skipIf(!url)("suggestions with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let amsterdam = "";
  let mexico = "";
  beforeEach(async () => {
    vi.stubEnv("DURTAL_API_TOKEN", TOKEN);
    home.cookie = null;
    // Truncating locations cascades to app_settings (its default copy location): put the row back
    await q(`truncate works, authors, locations, series, recommenders, activity_events, imports cascade`);
    await q(`insert into app_settings(id) values (true) on conflict (id) do update set reading_prediction_gate = null, reading_suggest_hide_anathema = false`);
    amsterdam = await value(`insert into locations(name, type) values ('Amsterdam', 'physical') returning id`);
    mexico = await value(`insert into locations(name, type) values ('Mexico City', 'physical') returning id`);
  });

  let serial = 0;
  const book = (title: string, o: { rating?: number | null; status?: string; seriesId?: string; position?: string; poison?: boolean } = {}) =>
    value(`insert into works(title, slug, rating, catalogue_status, series_id, series_position, is_poison) values ($1, $2, $3, $4, $5, $6, $7) returning id`, [
      title,
      `s-${++serial}`,
      o.rating ?? null,
      o.status ?? "accessioned",
      o.seriesId ?? null,
      o.position ?? null,
      o.poison ?? false,
    ]);
  const edition = (workId: string, pages: number | null = 300) => value(`insert into editions(work_id, title, language, page_count) values ($1, 'E', 'en', $2) returning id`, [workId, pages]);
  const copy = (editionId: string, o: { at?: string; status?: string; acquired?: string | null } = {}) =>
    value(`insert into instances(edition_id, location_id, status, acquisition_date) values ($1, $2, $3, $4::date) returning id`, [editionId, o.at ?? amsterdam, o.status ?? "available", o.acquired ?? null]);
  const owned = async (title: string, o: Parameters<typeof book>[1] & { at?: string; copyStatus?: string; acquired?: string } = {}) => {
    const w = await book(title, o);
    await copy(await edition(w), { at: o.at, status: o.copyStatus, acquired: o.acquired });
    return w;
  };
  const finished = (workId: string, rating: number | null = null, on = "2024-05-01") =>
    q(`insert into readings(work_id, status, started_precision, finished_on, finished_precision, rating) values ($1, 'finished', 'unknown', $2::date, 'day', $3)`, [workId, on, rating]);
  const titles = async (scope: (typeof DEFAULT_SUGGESTION_PARAMS)["scope"] = "owned") => {
    const ctx = await getSuggestionContext({ homeId: home.cookie });
    return candidates(ctx)
      .filter((b) => passes(b, ctx, { ...DEFAULT_SUGGESTION_PARAMS, scope }))
      .map((b) => b.title)
      .sort();
  };
  const request = (path: string, token: string | null = TOKEN) => new NextRequest(`http://local${path}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });

  it("loads every book with its numbers as numbers, and owned means a copy that is not deaccessioned", async () => {
    const author = await value(`insert into authors(name, slug) values ('Huysmans', 'huysmans') returning id`);
    const coauthor = await value(`insert into authors(name, slug) values ('Other', 'other') returning id`);
    const rated = await owned("Là-bas", { rating: 4.5 });
    await finished(rated);
    await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author'), ($1, $3, 'co_author')`, [rated, author, coauthor]);
    const gone = await book("Gone");
    await copy(await edition(gone), { status: "deaccessioned" });
    await owned("Kept");
    const ctx = await getSuggestionContext();
    const b = ctx.byId.get(rated)!;
    for (const v of [b.rating, b.taste, b.finishedCount, ctx.meanTaste, ctx.baseLiked]) expect(typeof v).toBe("number");
    expect([b.taste, b.authors.map((a) => a.name)]).toEqual([4.5, ["Huysmans", "Other"]]);
    expect(ctx.byId.get(gone)!.owned).toBe(false);
    expect(await titles()).toEqual(["Kept"]);
    expect(await titles("all")).toEqual(["Gone", "Kept"]);
  });

  it("learns only from taste evidence: a rated book with no finished reading counts nowhere", async () => {
    await owned("Rated, unread", { rating: 5 });
    const ctx = await getSuggestionContext();
    expect([ctx.rated.length, ctx.meanTaste]).toEqual([0, null]);
  });

  it("finds a copy added at the remembered home on the next call: nothing is cached", async () => {
    home.cookie = amsterdam;
    const w = await book("Elsewhere");
    const e = await edition(w);
    await copy(e, { at: mexico });
    const before = await getSuggestionContext({ homeId: amsterdam });
    expect(before.byId.get(w)!.atHandCopyId).toBeNull();
    await copy(e, { at: amsterdam });
    const after = await getSuggestionContext({ homeId: amsterdam });
    expect(after.byId.get(w)!.atHandCopyId).not.toBeNull();
    expect(after.byId.get(w)!.atHandHomes.sort()).toEqual([amsterdam, mexico].sort());
    expect(suggest(after, DEFAULT_SUGGESTION_PARAMS)[0].reasons).toContain("On your shelf in Amsterdam");
    // A home that is not a home now counts as none
    expect((await getSuggestionContext({ homeId: "00000000-0000-4000-8000-000000000000" })).homeId).toBeNull();
  });

  it("follows nextToRead for a series", async () => {
    const s = await value(`insert into series(title, slug) values ('Les Rougon-Macquart', 'rm') returning id`);
    const one = await owned("La Fortune des Rougon", { seriesId: s, position: "1", rating: 4 });
    await finished(one);
    const two = await owned("La Curée", { seriesId: s, position: "2" });
    await owned("Le Ventre de Paris", { seriesId: s, position: "3" });
    expect((await nextToRead(s))?.id).toBe(two);
    const ctx = await getSuggestionContext();
    const top = suggest(ctx, DEFAULT_SUGGESTION_PARAMS)[0];
    expect([top.book.id, top.reasons[0]]).toEqual([two, "Next in Les Rougon-Macquart after La Fortune des Rougon (you gave it 4)"]);
  });

  it("hides with Never, Not now and Not for me; Not now expires; removing a row brings the book back", async () => {
    const [a, b, c] = [await owned("Never"), await owned("Not now"), await owned("Not for me")];
    await owned("Free");
    await setSuggestionFeedback({ workId: a, verdict: "never" });
    await setSuggestionFeedback({ workId: b, verdict: "not_now" });
    await setSuggestionFeedback({ workId: c, verdict: "rejected", reasons: ["too_long", "prose"], note: "Not now, maybe never" });
    expect(await titles()).toEqual(["Free"]);
    const today = await readingToday();
    expect(await value(`select until::text from recommendation_feedback where work_id = $1`, [b])).toBe(addDays(today, 30));
    await q(`update recommendation_feedback set until = $2::date where work_id = $1`, [b, addDays(today, -1)]);
    expect(await titles()).toEqual(["Free", "Not now"]);
    const removed = await removeSuggestionFeedback({ workId: c });
    expect(removed).toMatchObject({ verdict: "rejected", reasons: ["too_long", "prose"], note: "Not now, maybe never" });
    expect(await titles()).toEqual(["Free", "Not for me", "Not now"]);
    await restoreSuggestionFeedback(removed!);
    expect(await titles()).toEqual(["Free", "Not now"]);
    await expect(setSuggestionFeedback({ workId: a, verdict: "rejected", reasons: [] })).rejects.toThrow(/Pick a reason/);
  });

  it("replaces the older verdict: reasons, note and until replaced, the source the latest writer", async () => {
    const w = await owned("Twice");
    await q(`insert into recommendation_feedback(work_id, verdict, reasons, note, until, source) values ($1, 'not_now', '{genre}', 'An agent wrote this', '2030-01-01', 'agent')`, [w]);
    const previous = await setSuggestionFeedback({ workId: w, verdict: "rejected", reasons: ["prose"] });
    expect(previous).toMatchObject({ verdict: "not_now", reasons: ["genre"], note: "An agent wrote this", until: "2030-01-01", source: "agent" });
    expect(await q(`select verdict, reasons, note, until, source from recommendation_feedback where work_id = $1`, [w])).toEqual([
      { verdict: "rejected", reasons: ["prose"], note: null, until: null, source: "suggestions" },
    ]);
    await restoreSuggestionFeedback(previous!);
    expect(await value(`select source from recommendation_feedback where work_id = $1`, [w])).toBe("agent");
    await expect(q(`insert into recommendation_feedback(work_id, verdict) values ($1, 'maybe')`, [await book("Bad")])).rejects.toMatchObject({ code: "23514" });
  });

  it("lists every Not now, Never and Not for me in the Hidden view, with its reasons", async () => {
    const [a, b, c] = [await owned("Hidden one"), await owned("Hidden two"), await owned("Hidden three")];
    await setSuggestionFeedback({ workId: a, verdict: "not_now" });
    await setSuggestionFeedback({ workId: b, verdict: "never" });
    await setSuggestionFeedback({ workId: c, verdict: "rejected", reasons: ["too_long", "genre"], note: "Too long for now" });
    const html = renderToStaticMarkup((await SuggestionsPage({ searchParams: Promise.resolve({ view: "hidden" }) })) as ReactElement);
    expect(html.match(/data-hidden="/g)).toHaveLength(3);
    expect(html).toContain("Not now, until");
    expect(html).toContain(">Never<");
    expect(html).toContain("Not for me: Too long, Not my kind of book");
    expect(html).toContain("Too long for now");
  });

  it("keeps the newer row when two books with feedback are merged", async () => {
    const [s, t] = [await owned("Source"), await owned("Target")];
    await setSuggestionFeedback({ workId: t, verdict: "never" });
    await q(`update recommendation_feedback set updated_at = now() - interval '1 day' where work_id = $1`, [t]);
    await setSuggestionFeedback({ workId: s, verdict: "not_now" });
    const p = await previewMerge("works", s, t);
    expect(p.blockers).toEqual([]);
    await executeMerge({ entity: "works", sourceId: s, targetId: t, fingerprint: p.fingerprint, choices: Object.fromEntries(p.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])) });
    expect(await q(`select work_id, verdict from recommendation_feedback`)).toEqual([{ work_id: t, verdict: "not_now" }]);
  });

  it("writes the gate's result at most once in 24 hours", async () => {
    const now = new Date();
    await getSuggestionContext({ now });
    const first = await value<{ checkedAt: string; on: boolean; n: number }>(`select reading_prediction_gate from app_settings`);
    expect(first).toMatchObject({ checkedAt: now.toISOString(), on: false, n: 0 });
    // Two requests within the day read it; neither writes
    await Promise.all([getSuggestionContext({ now: new Date(now.getTime() + 3_600_000) }), getSuggestionContext({ now: new Date(now.getTime() + 7_200_000) })]);
    expect((await value<{ checkedAt: string }>(`select reading_prediction_gate from app_settings`)).checkedAt).toBe(now.toISOString());
    // A day later the first request runs it, once
    const later = new Date(now.getTime() + 25 * 3_600_000);
    const [x, y] = await Promise.all([getSuggestionContext({ now: later }), getSuggestionContext({ now: later })]);
    expect((await value<{ checkedAt: string }>(`select reading_prediction_gate from app_settings`)).checkedAt).toBe(later.toISOString());
    expect([x.gate?.checkedAt, y.gate?.checkedAt]).toEqual([later.toISOString(), later.toISOString()]);
  });

  it("reads the gate fresh for the book page, not from the settings cache", async () => {
    expect(await predictionGateOn()).toBe(false);
    await getSuggestionContext();
    expect(await predictionGateOn()).toBe(false);
    await q(`update app_settings set reading_prediction_gate = jsonb_set(reading_prediction_gate, '{on}', 'true')`);
    expect(await predictionGateOn()).toBe(true);
  });

  it("counts the rated books with no reading exactly as its library link lists them", async () => {
    await owned("Rated A", { rating: 4 });
    await book("Rated B, not owned", { rating: 2.5 });
    const read = await owned("Rated, read", { rating: 5 });
    await finished(read);
    await owned("Unrated");
    const reading = await owned("Rated, being read", { rating: 3 });
    await q(`insert into readings(work_id, status, started_precision) values ($1, 'reading', 'unknown')`, [reading]);
    const ctx = await getSuggestionContext();
    const line = ctx.books.filter((b) => b.rating !== null && !b.hasReading).length;
    expect(line).toBe(2);
    expect(line).toBe(await getWorkCount(undefined, { reading: ["unread"], minRating: 0.5 }));
  });

  it("matches the full loader for every unread book, including all similarity signals and library-wide IDF", async () => {
    const author = await value(
      `insert into authors(name, slug) values ('Prediction writer', 'prediction-writer') returning id`,
    );
    const translator = await value(
      `insert into authors(name, slug) values ('Prediction translator', 'prediction-translator') returning id`,
    );
    const recommender = await value(
      `insert into recommenders(name) values ('Prediction reader') returning id`,
    );
    const seriesId = await value(
      `insert into series(title, slug) values ('Prediction series', 'prediction-series') returning id`,
    );
    const workType = await value(
      `insert into work_types(name, slug) values ('Prediction type', 'prediction-type') on conflict (slug) do update set name = excluded.name returning id`,
    );
    const families = [
      ["subjects", "work_subjects", "subject_id", false],
      ["themes", "work_themes", "theme_id", true],
      [
        "literary_movements",
        "work_literary_movements",
        "literary_movement_id",
        true,
      ],
      ["book_categories", "work_categories", "category_id", true],
      ["attributes", "work_attributes", "attribute_id", false],
      ["keywords", "work_keywords", "keyword_id", false],
    ] as const;
    const terms = await Promise.all(
      families.map(([table, , , level]) =>
        value(
          `insert into ${table}(name, slug${level ? ", level" : ""}) values ('Prediction term', 'prediction-term'${level ? ", 1" : ""}) on conflict (slug) do update set name = excluded.name returning id`,
        ),
      ),
    );
    for (let i = 0; i < 48; i++) {
      const rated = i < 34;
      const w = await book(
        i === 47
          ? "No signals"
          : i === 46
            ? "A long title ".repeat(80)
            : `Prediction ${i % 7}`,
        {
          rating: rated && i >= 3 ? ((i % 9) + 1) / 2 : i === 40 ? 5 : null,
          seriesId: i % 3 === 0 ? seriesId : undefined,
          position: String(i + 1),
        },
      );
      await q(
        `update works set original_language = $2, original_year = $3, work_type_id = $4 where id = $1`,
        [
          w,
          i === 47 ? "de" : "fr",
          [-101, 0, 1, 1900, 1901][i % 5],
          i % 2 === 0 ? workType : null,
        ],
      );
      if (rated) {
        await finished(w, i < 3 ? 4 : 2, "2024-01-01");
        // Book rating wins; otherwise the latest rated finish, skipping a later unrated finish.
        if (i < 3) {
          await finished(w, 4.5, "2025-01-01");
          await finished(w, null, "2025-02-01");
        }
      } else if (i === 41)
        await q(
          `insert into readings(work_id, status, started_precision) values ($1, 'abandoned', 'unknown')`,
          [w],
        );
      else if (i === 42)
        await q(
          `insert into readings(work_id, status, started_precision) values ($1, 'reading', 'unknown')`,
          [w],
        );
      if (i === 47) continue;
      if (i % 2 === 0)
        await q(
          `insert into work_authors(work_id, author_id, role) values ($1, $2, 'co_author')`,
          [w, author],
        );
      const e = await edition(w);
      if (i % 3 === 1) {
        await q(
          `insert into edition_contributors(edition_id, author_id, role) values ($1, $2, 'translator')`,
          [e, translator],
        );
        await q(
          `insert into edition_contributors(edition_id, author_id, role) values ($1, $2, 'translator')`,
          [await edition(w), translator],
        );
      }
      if (i % 4 === 1)
        await q(
          `insert into work_recommenders(work_id, recommender_id) values ($1, $2)`,
          [w, recommender],
        );
      for (let j = 0; j < families.length; j++)
        if ((i + j) % 3 !== 0) {
          const [, link, column] = families[j];
          await q(`insert into ${link}(work_id, ${column}) values ($1, $2)`, [
            w,
            terms[j],
          ]);
        }
    }
    // Non-books must not contribute to the denominator or shared term counts.
    const film = await value(
      `insert into works(title, slug, kind, original_language) values ('Prediction film', 'prediction-film', 'film', null) returning id`,
    );
    await q(`insert into work_subjects(work_id, subject_id) values ($1, $2)`, [
      film,
      terms[0],
    ]);
    const full = await getSuggestionContext();
    expect(full.books).toHaveLength(48);
    expect(full.rated).toHaveLength(34);
    const unread = full.books.filter((b) => !b.finishedCount);
    expect(unread).toHaveLength(14);
    const summary = (p: Prediction | null) =>
      p && {
        value: p.value,
        low: p.low,
        high: p.high,
        text: predictionText(p),
        source: predictionSource(p),
        neighbours: p.neighbours.map((n) => ({
          id: n.book.id,
          similarity: n.similarity,
          rating: n.rating,
        })),
      };
    let predicted = 0;
    for (const target of unread) {
      const small = await getBookPredictionContext(target.id);
      expect(small.books).toHaveLength(35);
      expect(small.rated.map((b) => [b.id, b.taste])).toEqual(
        full.rated.map((b) => [b.id, b.taste]),
      );
      expect(small.meanTaste).toBe(full.meanTaste);
      expect([...small.idf].sort()).toEqual([...full.idf].sort());
      expect(evaluatePredictions(small)).toEqual(evaluatePredictions(full));
      const p = predict(small.byId.get(target.id)!, small);
      expect(summary(p)).toEqual(summary(predict(target, full)));
      if (p) predicted++;
    }
    expect(predicted).toBeGreaterThan(0);
    expect(predicted).toBeLessThan(unread.length);
    const unknown = await getBookPredictionContext(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(unknown.books).toHaveLength(34);
    expect(unknown.byId.has("00000000-0000-4000-8000-000000000000")).toBe(
      false,
    );
  });

  it("keeps the daily gate freshness and evaluation when the book page uses the small load", async () => {
    const w = await book("Unread");
    const now = new Date();
    const ctx = await getBookPredictionContext(w, { now });
    expect(ctx.gate).toMatchObject({
      checkedAt: now.toISOString(),
      on: false,
      n: 0,
    });
    await q(
      `update app_settings set reading_prediction_gate = jsonb_set(reading_prediction_gate, '{on}', 'true')`,
    );
    const [a, b] = await Promise.all([
      getBookPredictionContext(w, { now }),
      getBookPredictionContext(w, { now }),
    ]);
    expect([a.gate?.on, b.gate?.on]).toEqual([true, true]);
    const later = new Date(now.getTime() + 25 * 3_600_000);
    const [x, y] = await Promise.all([
      getBookPredictionContext(w, { now: later }),
      getBookPredictionContext(w, { now: later }),
    ]);
    expect([x.gate, y.gate]).toEqual([x.gate, x.gate]);
    expect(x.gate).toMatchObject({
      checkedAt: later.toISOString(),
      on: true,
      failures: 1,
      n: 0,
    });
    const after = await getBookPredictionContext(w, {
      now: new Date(later.getTime() + 25 * 3_600_000),
    });
    expect(after.gate).toMatchObject({ on: false, failures: 0, n: 0 });
  });

  it("answers the API: 401 without the token, 400 for an unknown scope, suggestions with reasons with it", async () => {
    await owned("On the shelf", { acquired: "2015-01-01" });
    expect((await getSuggestions(request("/api/readings/suggestions", null))).status).toBe(401);
    const bad = await getSuggestions(request("/api/readings/suggestions?scope=shelf"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0]).toMatchObject({ path: ["scope"] });
    expect((await getSuggestions(request("/api/readings/suggestions?colour=red"))).status).toBe(400);
    const ok = await getSuggestions(request("/api/readings/suggestions?scope=owned&length=medium"));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ total: 1, page: 1, pages: 1, predictions: false });
    expect(body.suggestions[0]).toMatchObject({ title: "On the shelf", reasons: ["On your shelves since 2015"] });
    expect(typeof body.suggestions[0].score).toBe("number");
    // No home in the request: only the shelf time has data
    expect(body.suggestions[0].features.map((f: { key: string }) => f.key)).toEqual(["shelf"]);
  });
});
