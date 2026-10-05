import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ importId: "0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10", source: "goodreads", rows: 1 })),
  setBronzeKey: vi.fn(async () => {}),
  upload: vi.fn(async (key: string) => key),
}));
vi.mock("@/lib/reading/import/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reading/import/store")>()),
  createReadingImport: mocks.create,
  setBronzeKey: mocks.setBronzeKey,
}));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: mocks.upload }));
import { POST } from "@/app/api/reading/import/route";

/* POST /api/reading/import (SLN-450): the refusals, and an import that
   S3 refuses to keep. The store and S3 are mocked. */

function request(file: File | null, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new NextRequest("http://localhost/api/reading/import", { method: "POST", headers, body: form });
}
const csv = (name = "goodreads_library_export.csv", body = "Title,Exclusive Shelf,My Rating\nWatt,read,4\n", type = "text/csv") => new File([body], name, { type });

afterEach(() => vi.clearAllMocks());

describe("the reading import route", () => {
  it("refuses another site", async () => {
    const res = await POST(request(csv(), { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses a file that is not a CSV", async () => {
    for (const file of [csv("export.xlsx", "x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), csv("export.csv", "x", "image/png")]) {
      const res = await POST(request(file));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Only CSV files can be imported: a Goodreads, StoryGraph or Durtal export");
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses a file over 10 MB", async () => {
    const res = await POST(request(csv("big.csv", "a".repeat(10 * 1024 * 1024 + 1))));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This file is over 10 MB. Export a smaller one.");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses a request with no file", async () => {
    expect((await POST(request(null))).status).toBe(400);
  });
  it("refuses an unknown format with the columns it found", async () => {
    const real = await vi.importActual<typeof import("@/lib/reading/import/store")>("@/lib/reading/import/store");
    mocks.create.mockImplementationOnce(((input: { text: string; fileName: string }) => real.createReadingImport(input)) as never);
    const res = await POST(request(csv("prices.csv", "Name,Price\nx,1\n")));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This file is not a Goodreads, StoryGraph or Durtal export. Its columns: Name, Price");
  });
  it("keeps the raw file under a safe name", async () => {
    const res = await POST(request(csv("My Goodreads (1).csv")));
    expect(res.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith("bronze/imports/0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10/My_Goodreads_1_.csv", expect.any(Uint8Array), "text/csv");
    expect(mocks.setBronzeKey).toHaveBeenCalledWith("0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10", "bronze/imports/0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10/My_Goodreads_1_.csv");
  });
  it("creates the import when S3 refuses, and the raw file is not kept", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.upload.mockRejectedValueOnce(new Error("InvalidAccessKeyId"));
    const res = await POST(request(csv()));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ importId: "0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10", source: "goodreads", rows: 1 });
    expect(mocks.create).toHaveBeenCalledWith({ text: "Title,Exclusive Shelf,My Rating\nWatt,read,4\n", fileName: "goodreads_library_export.csv" });
    expect(mocks.setBronzeKey).not.toHaveBeenCalled();
  });
});
