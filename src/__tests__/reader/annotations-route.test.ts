import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { annotation, id, put, at } from "./fixtures/annotation";
const mocks = vi.hoisted(() => ({
  annotationBookExists: vi.fn(),
  annotationFilesBelong: vi.fn(),
  readAnnotations: vi.fn(),
  saveAnnotations: vi.fn(),
}));
vi.mock("@/lib/reader/annotation-store", () => ({
  ...mocks,
  AnnotationInputError: class extends Error {},
}));
import { GET, POST } from "@/app/api/reader/[ebookId]/annotations/route";
function request(
  method: "GET" | "POST",
  options: {
    body?: unknown;
    ebookId?: string;
    device?: string | null;
    expected?: string;
    site?: string;
    since?: string;
  } = {},
) {
  const headers = new Headers({
    "sec-fetch-site": options.site ?? "same-origin",
  });
  if (options.device !== null)
    headers.set("cookie", `durtal-device=${options.device ?? id(4)}`);
  if (options.expected !== undefined)
    headers.set("X-Durtal-Expected-Device", options.expected);
  const book = options.ebookId ?? id(2);
  const url = `http://localhost/api/reader/${book}/annotations${options.since !== undefined ? "?since=" + encodeURIComponent(options.since) : ""}`;
  return [
    new NextRequest(url, {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
    }),
    { params: Promise.resolve({ ebookId: book }) },
  ] as const;
}
const body = (item: unknown = put()) => ({ upserts: [item], deletes: [] });
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.annotationBookExists.mockResolvedValue(true);
  mocks.annotationFilesBelong.mockResolvedValue(true);
  mocks.readAnnotations.mockResolvedValue({
    annotations: [annotation()],
    serverTime: at,
    reset: true,
  });
  mocks.saveAnnotations.mockResolvedValue({
    applied: [id(1)],
    ignored: [],
    annotations: [annotation()],
    serverTime: at,
    operations: [],
  });
});
const untouched = () => {
  for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
};
describe("annotation route refusals before database work", () => {
  it.each(["cross-site", "same-site"])(
    "refuses %s with no database work",
    async (site) => {
      const response = await POST(...request("POST", { site, body: body() }));
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      untouched();
    },
  );
  it.each(["GET", "POST"] as const)(
    "refuses a malformed %s ebook id before parsing or queries",
    async (method) => {
      const args = request(method, {
        ebookId: "malformed",
        body: method === "POST" ? "{" : undefined,
      });
      const parse = vi.spyOn(args[0], "json");
      const response = await (method === "GET" ? GET : POST)(...args);
      expect(response.status).toBe(400);
      expect(parse).not.toHaveBeenCalled();
      untouched();
    },
  );
  it.each([
    { device: null, expected: id(4), code: "device_identity_missing" },
    { device: id(5), expected: id(4), code: "device_identity_changed" },
    { device: id(4), expected: "malformed", code: "device_identity_changed" },
  ])(
    "blocks captured device changes before JSON parsing: $code",
    async (options) => {
      const args = request("POST", { ...options, body: "{" });
      const parse = vi.spyOn(args[0], "json");
      const response = await POST(...args);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: options.code });
      expect(parse).not.toHaveBeenCalled();
      untouched();
    },
  );
  it.each([
    { ...put(), id: "bad" },
    { ...put(), style: "quote" },
    { ...put(), text: "x".repeat(10001) },
    { ...put(), note: "x".repeat(10001) },
    { ...put(), clientUpdatedAt: "2099-01-01T00:00:00Z" },
    { ...put(), locator: { ...put().locator, progression: 2 } },
  ])("refuses invalid browser annotation input", async (item) => {
    expect((await POST(...request("POST", { body: body(item) }))).status).toBe(
      400,
    );
    untouched();
  });
  it("refuses 201 changes and duplicate annotation IDs before queries", async () => {
    const changes = Array.from({ length: 201 }, (_, i) => ({
      ...put(),
      id: id(i + 100),
    }));
    expect(
      (
        await POST(
          ...request("POST", { body: { upserts: changes, deletes: [] } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          ...request("POST", {
            body: { upserts: [put(), put()], deletes: [] },
          }),
        )
      ).status,
    ).toBe(400);
    untouched();
  });
  it("refuses an invalid pull cursor before queries", async () => {
    expect((await GET(...request("GET", { since: "not-a-time" }))).status).toBe(
      400,
    );
    untouched();
  });
  it("refuses a file/hash from another book before mutation", async () => {
    mocks.annotationFilesBelong.mockResolvedValue(false);
    expect((await POST(...request("POST", { body: body() }))).status).toBe(400);
    expect(mocks.saveAnnotations).not.toHaveBeenCalled();
  });
  it("returns an unknown book without reading or writing annotations", async () => {
    mocks.annotationBookExists.mockResolvedValue(false);
    expect((await GET(...request("GET"))).status).toBe(404);
    expect(mocks.readAnnotations).not.toHaveBeenCalled();
  });
  it("passes microsecond identity and whole valid payloads to the atomic owner", async () => {
    const response = await POST(
      ...request("POST", { body: body(), expected: id(4) }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.saveAnnotations).toHaveBeenCalledWith(id(2), id(4), body());
    const pull = await GET(
      ...request("GET", { since: "2026-10-09T12:00:00.000001Z" }),
    );
    expect(pull.status).toBe(200);
    expect(pull.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readAnnotations).toHaveBeenCalledWith(
      id(2),
      "2026-10-09T12:00:00.000001Z",
    );
  });
});
