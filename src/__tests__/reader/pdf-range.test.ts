import { describe, expect, it } from "vitest";
import {
  PDF_MAX_CONCURRENT_RANGES,
  PDF_RANGE_CHUNK_BYTES,
  pdfRangeBodyMatches,
  pdfRangeChunks,
  pdfRangeResponsePolicy,
} from "@/lib/reader/engines/foliate/pdf-range";

describe("PDF byte range policy", () => {
  it("splits a large nonaligned transport interval without gaps or excessive chunks", () => {
    const chunks = [...pdfRangeChunks(100, 800000, 1000000)];
    expect(chunks[0].begin).toBe(100);
    expect(chunks.at(-1)!.end).toBe(800000);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].end - chunks[i].begin).toBeLessThanOrEqual(262144);
      if (i) expect(chunks[i].begin).toBe(chunks[i - 1].end);
    }
    expect(PDF_RANGE_CHUNK_BYTES).toBe(262144);
    expect(PDF_MAX_CONCURRENT_RANGES).toBe(6);
  });

  it("clamps the last chunk to EOF and makes empty intervals empty", () => {
    expect([...pdfRangeChunks(900, 2000, 1000)]).toEqual([
      { begin: 900, end: 1000 },
    ]);
    expect([...pdfRangeChunks(1000, 1000, 1000)]).toEqual([]);
  });

  it.each([
    [-1, 20, 30],
    [0.5, 20, 30],
    [20, 10, 30],
    [40, 50, 30],
    [0, Infinity, 30],
  ])("rejects invalid intervals (%i,%i,%i)", (begin, end, size) =>
    expect(() => [...pdfRangeChunks(begin, end, size)]).toThrow(RangeError),
  );

  const answer = {
    range: { begin: 100, end: 200 },
    size: 1000,
    status: 206,
    contentRange: "bytes 100-199/1000",
    contentLength: "100",
    viaCdn: true,
  };
  it("accepts only the exact requested partial response", () => {
    expect(pdfRangeResponsePolicy(answer)).toBe("accept");
    expect(pdfRangeResponsePolicy({ ...answer, contentLength: null })).toBe(
      "accept",
    );
    expect(pdfRangeBodyMatches(answer.range, 100)).toBe(true);
    expect(pdfRangeBodyMatches(answer.range, 99)).toBe(false);
  });

  it("requires cancelling a CDN whole-file answer and refuses one from the app", () => {
    expect(pdfRangeResponsePolicy({ ...answer, status: 200 })).toBe(
      "retry-app",
    );
    expect(
      pdfRangeResponsePolicy({ ...answer, status: 200, viaCdn: false }),
    ).toBe("reject");
  });

  it.each([
    { contentRange: null },
    { contentRange: "bytes 0-999/1000" },
    { contentRange: "bytes 100-199/1001" },
    { contentRange: "bytes 100-199/*" },
    { contentLength: "99" },
    { contentLength: "1e2" },
    { status: 416 },
    { range: { begin: 0, end: 300000 }, contentRange: "bytes 0-299999/1000" },
  ])("rejects malformed or unexpected response metadata %o", (changed) =>
    expect(pdfRangeResponsePolicy({ ...answer, ...changed })).toBe("reject"),
  );
});
