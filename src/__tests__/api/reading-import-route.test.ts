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
import { DURTAL_EXPORT_HEADERS, DURTAL_EXPORT_HEADERS_V2 } from "@/lib/export/columns";
import { toCSV, toTSV } from "@/lib/utils/export";
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
  it("refuses an unsupported file or MIME type", async () => {
    for (const file of [csv("export.xlsx", "x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), csv("export.csv", "x", "image/png")]) {
      const res = await POST(request(file));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Choose a CSV or TSV reading history, or an empty JSON or Parquet export");
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
  it("accepts a BOM TSV and retains its raw bytes and content type", async () => {
    const text = "\uFEFFwork_id\tsource_key\r\nwork\tdurtal:key\r\n";
    const res = await POST(request(csv("Reading history.TSV", text, "text/tab-separated-values")));
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ text: text.slice(1), fileName: "Reading history.TSV" });
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringContaining("Reading_history.TSV"), new TextEncoder().encode(text), "text/tab-separated-values");
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

describe("empty Durtal uploads are successful no-ops",()=>{
  for(const headers of [DURTAL_EXPORT_HEADERS_V2,DURTAL_EXPORT_HEADERS]) {
    it.each(Object.entries(headers))("%s creates no import or raw S3 copy",async(entity,columns)=>{
      for(const [write,extension,mime] of [[toCSV,"csv","text/csv"],[toTSV,"tsv","text/tab-separated-values"]] as const) {
        const res=await POST(request(csv(`empty.${extension}`,write([],columns),mime)));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({kind:"empty",entity,source:"durtal",rows:0});
        expect(mocks.create).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.setBronzeKey).not.toHaveBeenCalled();
      }
    });
  }
});

it("refuses an invalid Unicode header before creating even a header-only import",async()=>{
  for(const records of [[],[{work_id:"11111111-1111-4111-8111-111111111111"}]]) {
    const text=toCSV(records,[...DURTAL_EXPORT_HEADERS.readings,"extra\u0000"]);
    const response=await POST(request(csv("readings.csv",text)));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("column name");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  }
});
