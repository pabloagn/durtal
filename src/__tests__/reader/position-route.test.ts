import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* SLN-492: the reader's place per file and device, through its route; the database is mocked */

const mocks = vi.hoisted(() => ({
  ebookExists: vi.fn(),
  ebookAndFile: vi.fn(),
  savePosition: vi.fn(),
  devicePositions: vi.fn(),
}));
vi.mock("@/lib/reader/positions", async (original) => ({
  ...(await original<typeof import("@/lib/reader/positions")>()),
  ...mocks,
}));

import { GET, POST } from "@/app/api/reader/[ebookId]/position/route";

const ebookId = "5e0c6a43-2f43-4b8e-a1f4-2b3c4d5e6f70";
const fileId = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
const device = "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10";
const locator = { v: 1, fileHash: "c".repeat(64), href: "ch1.xhtml", sectionIndex: 1, progression: 0.5, totalProgression: 0.1, cfi: "epubcfi(/6/4!/4/2/1:0)" };

function request(method: "GET" | "POST", options: { body?: unknown; cookie?: string | null; site?: string; id?: string } = {}) {
  const headers = new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1" });
  if (options.cookie !== null) headers.set("cookie", `durtal-device=${options.cookie ?? device}`);
  if (options.site) headers.set("sec-fetch-site", options.site);
  const req = new NextRequest(`http://localhost/api/reader/${options.id ?? ebookId}/position`, {
    method,
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
  return [req, { params: Promise.resolve({ ebookId: options.id ?? ebookId }) }] as const;
}

const body = (over: Record<string, unknown> = {}) => ({ fileId, locator, chapter: "  Chapter I  ", clientUpdatedAt: new Date().toISOString(), ...over });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.ebookExists.mockResolvedValue(true);
  mocks.ebookAndFile.mockResolvedValue({ ebook: true, fileOfEbook: true });
  mocks.savePosition.mockImplementation(async ({ body }) => ({ saved: true, position: { fileId: body.fileId } }));
  mocks.devicePositions.mockResolvedValue([{ fileId }]);
});

describe("POST /api/reader/[ebookId]/position", () => {
  it("saves the place for this device, with its label and a trimmed chapter", async () => {
    const res = await POST(...request("POST", { body: body({ fileId: fileId.toUpperCase() }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ saved: true, position: { fileId } });
    const saved = mocks.savePosition.mock.calls[0][0];
    expect(saved).toMatchObject({ ebookId, deviceId: device, deviceLabel: "iPhone · Safari" });
    expect(saved.body).toMatchObject({ fileId, chapter: "Chapter I", locator });
    expect(saved.body.clientUpdatedAt).toBeInstanceOf(Date);
  });

  it("refuses a request from another site, a bad id or no device cookie before any query", async () => {
    expect((await POST(...request("POST", { body: body(), site: "cross-site" }))).status).toBe(403);
    expect((await POST(...request("POST", { body: body(), id: "not-a-uuid" }))).status).toBe(400);
    expect((await POST(...request("POST", { body: body(), cookie: null }))).status).toBe(400);
    expect((await POST(...request("POST", { body: body(), cookie: "forged" }))).status).toBe(400);
    expect(mocks.ebookAndFile).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", "not json"],
    ["a locator of another version", body({ locator: { ...locator, v: 2 } })],
    ["a progression past the end", body({ locator: { ...locator, totalProgression: 1.5 } })],
    ["a file hash that is not a sha256", body({ locator: { ...locator, fileHash: "abc" } })],
    ["a time from the future", body({ clientUpdatedAt: new Date(Date.now() + 10 * 60_000).toISOString() })],
    ["a file id that is not a uuid", body({ fileId: "f1" })],
  ])("refuses %s", async (_, sent) => {
    const res = await POST(...request("POST", { body: sent }));
    expect(res.status).toBe(400);
    expect(mocks.savePosition).not.toHaveBeenCalled();
  });

  it("drops keys the locator does not know", async () => {
    await POST(...request("POST", { body: body({ locator: { ...locator, script: "<b>" } }) }));
    expect(mocks.savePosition.mock.calls[0][0].body.locator).not.toHaveProperty("script");
  });

  it("answers 404 for an unknown e-book and 400 for a file of another one", async () => {
    mocks.ebookAndFile.mockResolvedValueOnce({ ebook: false, fileOfEbook: false });
    expect((await POST(...request("POST", { body: body() }))).status).toBe(404);
    mocks.ebookAndFile.mockResolvedValueOnce({ ebook: true, fileOfEbook: false });
    expect((await POST(...request("POST", { body: body() }))).status).toBe(400);
    expect(mocks.savePosition).not.toHaveBeenCalled();
  });

  it("answers 500 when the save fails", async () => {
    mocks.savePosition.mockRejectedValueOnce(new Error("connection lost"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await POST(...request("POST", { body: body() }))).status).toBe(500);
  });
});

describe("GET /api/reader/[ebookId]/position", () => {
  it("lists this device's places, and none without a device cookie", async () => {
    const res = await GET(...request("GET"));
    expect(await res.json()).toEqual({ positions: [{ fileId }] });
    expect(mocks.devicePositions).toHaveBeenCalledWith(ebookId, device);
    const anonymous = await GET(...request("GET", { cookie: null }));
    expect(await anonymous.json()).toEqual({ positions: [] });
    expect(mocks.devicePositions).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unknown e-book", async () => {
    mocks.ebookExists.mockResolvedValueOnce(false);
    expect((await GET(...request("GET"))).status).toBe(404);
  });
});
