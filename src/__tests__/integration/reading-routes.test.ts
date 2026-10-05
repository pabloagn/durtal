import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_ROUTES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln451_reading_routes")
    throw new Error("Reading route tests require a disposable local sln451_reading_routes database");
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
vi.mock("@/lib/db/atomic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/atomic")>();
  return { atomic: vi.fn(real.atomic) };
});
import { GET as getOpen } from "@/app/api/readings/open/route";
import { POST as postProgress } from "@/app/api/readings/[id]/progress/route";
import { POST as postStart } from "@/app/api/readings/timer/start/route";
import { POST as postStop } from "@/app/api/readings/timer/stop/route";
import { POST as postReading } from "@/app/api/readings/route";
import { finishReading, startReading } from "@/lib/actions/reading";
import { loadReading } from "@/lib/reading/service";
import { atomic } from "@/lib/db/atomic";

/* The phone's routes (SLN-451): the token on every route, GETs included,
   spoken messages, status codes and time zones. */

const TOKEN = "test-readings-token";

function request(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  return new NextRequest(`http://local${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function answer(res: Response) {
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!url)("the phone's reading routes with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    vi.stubEnv("DURTAL_API_TOKEN", TOKEN);
    await q(`truncate works, authors, locations, activity_events, imports cascade`);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  let serial = 0;
  async function book(title: string, over: { isbn13?: string; pages?: number } = {}) {
    const workId = await value(`insert into works(title, slug) values ($1, $2) returning id`, [title, `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`]);
    const editionId = await value(`insert into editions(work_id, title, language, page_count, isbn_13) values ($1, $2, 'fr', $3, $4) returning id`, [
      workId,
      title,
      over.pages ?? 480,
      over.isbn13 ?? null,
    ]);
    return { workId, editionId };
  }
  async function reading(title = "Nadja") {
    const b = await book(title);
    const r = await startReading({ workId: b.workId, editionId: b.editionId, startedOn: "2026-09-01", startedPrecision: "day", startPage: 100, timeZone: "Europe/Amsterdam" });
    return { ...b, readingId: r.id };
  }

  const routes = (readingId: string) => [
    () => getOpen(request("GET", "/api/readings/open", undefined, null)),
    () => postProgress(request("POST", `/api/readings/${readingId}/progress`, { text: "page 120" }, null), params(readingId)),
    () => postStart(request("POST", "/api/readings/timer/start", {}, null)),
    () => postStop(request("POST", "/api/readings/timer/stop", {}, null)),
    () => postReading(request("POST", "/api/readings", { isbn: "9780140449136" }, null)),
  ];

  it("refuses every route without the token (401), and when no token is set (503)", async () => {
    const { readingId } = await reading();
    for (const call of routes(readingId)) {
      const res = await answer(await call());
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Durtal refused the token");
    }
    vi.stubEnv("DURTAL_API_TOKEN", "");
    for (const call of routes(readingId)) expect((await call()).status).toBe(503);
  });

  it("lists the open readings and the running timer", async () => {
    const a = await reading("Nadja");
    await reading("La Curée");
    await answer(await postStart(request("POST", "/api/readings/timer/start", { readingId: a.readingId })));
    const res = await answer(await getOpen(request("GET", "/api/readings/open")));
    expect(res.status).toBe(200);
    expect(res.body.readings.map((r: { title: string }) => r.title).sort()).toEqual(["La Curée", "Nadja"]);
    expect(res.body.timer).toMatchObject({ readingId: a.readingId, title: "Nadja" });
    expect(res.body.message).toMatch(/^You are reading (Nadja and La Curée|La Curée and Nadja)\. The timer has run under a minute for Nadja$/);
  });

  it("logs progress from dictated text: page 212, 44 percent and +20", async () => {
    const { readingId } = await reading();
    let res = await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { text: "page 212", tz: "Europe/Amsterdam" }), params(readingId)));
    expect(res).toMatchObject({ status: 200, body: { message: "Logged page 212 of Nadja, 44%", readingId, position: { page: 212 } } });
    res = await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { text: "+20" }), params(readingId)));
    expect(res.body.message).toBe("Logged page 232 of Nadja, 48%");
    // Lower on the same reading day: the last log is corrected
    res = await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { text: "44 percent" }), params(readingId)));
    expect(res.body.message).toBe("Corrected your last log of Nadja to page 211");
    res = await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { page: 480 }), params(readingId)));
    expect(res.body.message).toBe("That is the last page of Nadja. Finish it in Durtal");
    expect((await loadReading(readingId))!.status).toBe("reading");
  });

  it("answers 400, 404 and 409 with a message", async () => {
    const { readingId } = await reading();
    expect(await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { text: "soon" }), params(readingId)))).toMatchObject({
      status: 400,
      body: { message: "Enter a page (212), a percent (44%), a time (3:12) or a chapter (ch 7)" },
    });
    expect((await postProgress(request("POST", `/api/readings/${readingId}/progress`, { page: 1, percent: 2 }), params(readingId))).status).toBe(400);
    expect((await postProgress(request("POST", `/api/readings/${readingId}/progress`, { page: 120, tz: "Mars/Olympus" }), params(readingId))).status).toBe(400);
    expect((await postProgress(request("POST", "/api/readings/0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10/progress", { page: 1 }), params("0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10"))).status).toBe(404);
    await finishReading({ readingId, fingerprint: (await loadReading(readingId))!.fingerprint });
    expect(await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { page: 120 }), params(readingId)))).toMatchObject({
      status: 409,
      body: { message: "Nadja is finished; reopen it in Durtal" },
    });
  });

  it("retries once on a concurrent change and succeeds", async () => {
    const { readingId } = await reading();
    const real = vi.mocked(atomic).getMockImplementation()!;
    // Another device changes the reading between the route's read and its write, once
    vi.mocked(atomic).mockImplementationOnce(async (build) => {
      await q(`update readings set updated_at = now() + interval '1 second' where id = $1`, [readingId]);
      return real(build);
    });
    const res = await answer(await postProgress(request("POST", `/api/readings/${readingId}/progress`, { page: 150 }), params(readingId)));
    expect(res).toMatchObject({ status: 200, body: { message: "Logged page 150 of Nadja, 31%" } });
  });

  it("sets the session's zone and reading day from tz", async () => {
    const { readingId } = await reading();
    await postProgress(request("POST", `/api/readings/${readingId}/progress`, { page: 130, tz: "America/Mexico_City" }), params(readingId));
    const row = (await q(`select time_zone from reading_sessions where reading_id = $1`, [readingId]))[0];
    expect(row.time_zone).toBe("America/Mexico_City");
  });

  it("starts the timer on the one open reading, and asks which with several", async () => {
    const a = await reading("Nadja");
    let res = await answer(await postStart(request("POST", "/api/readings/timer/start", { tz: "Europe/Amsterdam" })));
    expect(res).toMatchObject({ status: 200, body: { message: "Timer started for Nadja", readingId: a.readingId } });
    res = await answer(await postStart(request("POST", "/api/readings/timer/start", { readingId: a.readingId })));
    expect(res).toMatchObject({ status: 409, body: { message: "A timer is running for Nadja. Stop it first" } });
    await answer(await postStop(request("POST", "/api/readings/timer/stop", { text: "p 110" })));
    await reading("La Curée");
    res = await answer(await postStart(request("POST", "/api/readings/timer/start", {})));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Several books are open: .+ and .+\. Say which one$/);
    await q(`truncate works cascade`);
    expect(await answer(await postStart(request("POST", "/api/readings/timer/start", {})))).toMatchObject({ status: 404, body: { message: "No book is being read" } });
  });

  it("stops the timer: 404 with none, 409 when forgotten, 200 with endedAt, 400 over 12 hours", async () => {
    const a = await reading("Nadja");
    expect(await answer(await postStop(request("POST", "/api/readings/timer/stop", {})))).toMatchObject({ status: 404, body: { message: "No timer is running" } });
    const started = await answer(await postStart(request("POST", "/api/readings/timer/start", { readingId: a.readingId })));
    await q(`update reading_sessions set started_at = now() - interval '372 minutes 30 seconds' where id = $1`, [started.body.sessionId]);
    let res = await answer(await postStop(request("POST", "/api/readings/timer/stop", { text: "page 150" })));
    expect(res).toMatchObject({ status: 409, body: { message: "Your timer for Nadja has run 6 h 12 min. Say when you stopped, or stop it in Durtal" } });
    res = await answer(await postStop(request("POST", "/api/readings/timer/stop", { text: "page 150", endedAt: new Date(Date.now() - 5 * 3600_000).toISOString() })));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/^Stopped the timer: 1 h 1[23] min, page 150 of Nadja, 31%$/);
    const again = await answer(await postStart(request("POST", "/api/readings/timer/start", { readingId: a.readingId })));
    await q(`update reading_sessions set started_at = now() - interval '13 hours' where id = $1`, [again.body.sessionId]);
    res = await answer(await postStop(request("POST", "/api/readings/timer/stop", { endedAt: new Date(Date.now() - 60_000).toISOString() })));
    expect(res).toMatchObject({ status: 400, body: { message: "Edit the end time; a session can be at most 12 hours" } });
  });

  it("starts reading by ISBN, with the add link for an unknown one", async () => {
    const b = await book("Watt", { isbn13: "9780140449136" });
    const copyPlace = await value(`insert into locations(name, type) values ('Study', 'physical') returning id`);
    const copy = await value(`insert into instances(edition_id, location_id, format) values ($1, $2, 'paperback') returning id`, [b.editionId, copyPlace]);
    let res = await answer(await postReading(request("POST", "/api/readings", { isbn: "978-0-14-044913-6", tz: "Europe/Amsterdam" })));
    expect(res).toMatchObject({ status: 201, body: { message: "Started reading Watt" } });
    const row = (await q(`select edition_id, instance_id from readings where id = $1`, [res.body.readingId]))[0];
    expect([row.edition_id, row.instance_id]).toEqual([b.editionId, copy]);
    res = await answer(await postReading(request("POST", "/api/readings", { isbn: "0140449132" })));
    expect(res).toMatchObject({ status: 409, body: { message: "Watt is already being read" } });
    res = await answer(await postReading(request("POST", "/api/readings", { isbn: "9780141182803" })));
    expect(res).toMatchObject({ status: 404, body: { message: "Not in Durtal yet", addUrl: "/library/new?isbn=9780141182803" } });
    expect((await postReading(request("POST", "/api/readings", { isbn: "9780141182803", tz: "Nowhere" }))).status).toBe(400);
  });
});
