import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The routes read no rows here: the guard is what is under test.
vi.mock("@/lib/db", () => {
  // A select reads nothing: a list is empty, a count is 0
  const rows = Object.assign(Promise.resolve([]), { orderBy: () => rows, limit: async () => [] });
  const chain = { from: () => chain, where: () => rows };
  return {
    db: {
      query: { media: { findMany: vi.fn(async () => []) } },
      select: () => chain,
    },
  };
});
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("@/lib/s3/client", () => ({ s3: { send: vi.fn() }, S3_BUCKET: "local-test" }));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: vi.fn() }));

import { requireAdminToken } from "@/lib/api/admin";
import { POST as applyCrops } from "@/app/api/media/apply-crops/route";
import { POST as backfillPalettes } from "@/app/api/media/backfill-palettes/route";
import { POST as reprocess } from "@/app/api/media/reprocess/route";
import { db } from "@/lib/db";

const TOKEN = "test-admin-token";
const request = (path: string, token?: string) =>
  new NextRequest(`http://local${path}`, {
    method: "POST",
    headers: token === undefined ? {} : { "x-admin-token": token },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireAdminToken", () => {
  it("refuses every call when ADMIN_TOKEN is not set", async () => {
    vi.stubEnv("ADMIN_TOKEN", "");
    const denied = requireAdminToken(request("/x", ""));
    expect(denied?.status).toBe(503);
    expect(await denied?.json()).toEqual({
      error: "Admin routes are disabled: ADMIN_TOKEN is not set",
    });
  });

  it("refuses a missing, wrong or longer token", () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    expect(requireAdminToken(request("/x"))?.status).toBe(401);
    expect(requireAdminToken(request("/x", "test-admin-tokem"))?.status).toBe(401);
    expect(requireAdminToken(request("/x", `${TOKEN}x`))?.status).toBe(401);
  });

  it("lets the right token through", () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    expect(requireAdminToken(request("/x", TOKEN))).toBeNull();
  });
});

describe.each([
  ["apply-crops", applyCrops, { total: 0, applied: 0, unchanged: 0, failed: [] }],
  ["backfill-palettes", backfillPalettes, { colored: 0, posters: { processed: 0, failed: 0 }, covers: { processed: 0, failed: 0 } }],
  ["reprocess", reprocess, { total: 0, success: 0, failed: 0 }],
] as const)("POST /api/media/%s", (name, post, emptyRun) => {
  const path = `/api/media/${name}`;

  it("answers 503 without ADMIN_TOKEN and reads nothing", async () => {
    vi.stubEnv("ADMIN_TOKEN", "");
    const res = await post(request(path, "anything"));
    expect(res.status).toBe(503);
    expect(db.query.media.findMany).not.toHaveBeenCalled();
  });

  it("answers 401 with a wrong token", async () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    expect((await post(request(path, "wrong"))).status).toBe(401);
  });

  it("runs with the right token", async () => {
    vi.stubEnv("ADMIN_TOKEN", TOKEN);
    const res = await post(request(path, TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(emptyRun);
  });
});
