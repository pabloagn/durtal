import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  icon: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  missing: vi.fn(),
  findCollection: vi.fn(),
}));
vi.mock("@/lib/actions/collections", () => ({
  createCollection: mocks.create,
  setCollectionIcon: mocks.icon,
  getCollections: vi.fn(),
  bulkAddEditionsToCollection: mocks.add,
  removeEditionsFromCollection: mocks.remove,
}));
vi.mock("@/lib/api/missing-editions", () => ({
  missingEditions: mocks.missing,
}));
vi.mock("@/lib/db", () => ({
  db: { query: { collections: { findFirst: mocks.findCollection } } },
}));
import { POST as create } from "@/app/api/collections/route";
import { POST as addEditions } from "@/app/api/collections/[id]/editions/route";

const TOKEN = "test-token";
const COLLECTION = "b09b3035-b1ab-4a86-ad08-e65d3b887ea3";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function request(url: string, body: unknown, token: string | null = TOKEN) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: COLLECTION }) };

beforeEach(() => {
  vi.stubEnv("DURTAL_API_TOKEN", TOKEN);
  mocks.missing.mockResolvedValue([]);
  mocks.findCollection.mockResolvedValue({ id: COLLECTION });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/collections", () => {
  it("refuses a request without the token before it writes", async () => {
    const response = await create(request("/api/collections", { name: "X" }, null));
    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses unknown fields", async () => {
    const response = await create(
      request("/api/collections", { name: "X", poster: "a.png" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates the collection with its editions in the order given", async () => {
    mocks.create.mockResolvedValue({ id: COLLECTION, name: "X", icon: null });
    mocks.icon.mockResolvedValue({ icon: "Film" });
    const response = await create(
      request("/api/collections", { name: "X", icon: "Film", editionIds: [B, A] }),
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      { name: "X", description: undefined },
      [B, A],
      undefined,
    );
    expect(await response.json()).toMatchObject({ icon: "Film" });
  });

  it("refuses an icon that Lucide does not have", async () => {
    const response = await create(
      request("/api/collections", { name: "X", icon: "NoSuchIcon" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/collections/[id]/editions", () => {
  it("answers 404 with the unknown editions and adds nothing", async () => {
    mocks.missing.mockResolvedValue([B]);
    const response = await addEditions(
      request(`/api/collections/${COLLECTION}/editions`, { editionIds: [A, B] }),
      params,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ missing: [B] });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("adds the editions in the order given", async () => {
    mocks.add.mockResolvedValue({ changed: 2 });
    const response = await addEditions(
      request(`/api/collections/${COLLECTION}/editions`, { editionIds: [B, A] }),
      params,
    );
    expect(response.status).toBe(200);
    expect(mocks.add).toHaveBeenCalledWith(COLLECTION, [B, A]);
    expect(await response.json()).toEqual({ added: 2 });
  });
});
