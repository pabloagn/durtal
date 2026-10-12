import { describe, expect, it } from "vitest";
import {
  initialPdfTextEvidence,
  pdfTextCapabilities,
  pdfTextKnowledge,
  pdfTextSamplePages,
  recordPdfPageText,
} from "@/lib/reader/engines/foliate/pdf-text-policy";

describe("PDF text evidence", () => {
  it("samples at most five spread pages, including both ends, with unique indices", () => {
    expect(pdfTextSamplePages(420)).toEqual([0, 104, 209, 314, 419]);
    expect(pdfTextSamplePages(3)).toEqual([0, 1, 2]);
    expect(pdfTextSamplePages(1)).toEqual([0]);
  });

  it("does not disable discovery or speech after five empty sampled pages", () => {
    let evidence = initialPdfTextEvidence(420);
    expect(pdfTextKnowledge(evidence)).toBe("unknown");
    for (const page of pdfTextSamplePages(420))
      evidence = recordPdfPageText(evidence, page, false);
    expect(pdfTextKnowledge(evidence)).toBe("sampled-no-text");
    expect(pdfTextCapabilities(evidence, false)).toEqual({
      search: true,
      selection: false,
      tts: true,
    });
    // Sparse text on page 8, outside the five probes, remains discoverable.
    evidence = recordPdfPageText(evidence, 7, true);
    expect(pdfTextKnowledge(evidence)).toBe("has-text");
    expect(pdfTextCapabilities(evidence, true)).toEqual({
      search: true,
      selection: true,
      tts: true,
    });
    expect(pdfTextCapabilities(evidence, false).search).toBe(true);
  });

  it("confirms absence only from all pages and recovers if actual text is found", () => {
    let evidence = initialPdfTextEvidence(3);
    for (let i = 0; i < 3; i++)
      evidence = recordPdfPageText(evidence, i, false);
    expect(pdfTextKnowledge(evidence)).toBe("confirmed-no-text");
    expect(pdfTextCapabilities(evidence, false)).toEqual({
      search: false,
      selection: false,
      tts: false,
    });
    expect(pdfTextCapabilities(evidence, true)).toEqual({
      search: true,
      selection: true,
      tts: true,
    });
    evidence = recordPdfPageText(evidence, 1, true);
    expect(pdfTextKnowledge(evidence)).toBe("has-text");
  });

  it("does not count revisits as evidence for uninspected pages", () => {
    const empty = initialPdfTextEvidence(5);
    let evidence = empty;
    for (let i = 0; i < 10; i++)
      evidence = recordPdfPageText(evidence, 0, false);
    expect(evidence.inspected).toEqual([0]);
    expect(empty.inspected).toEqual([]);
    expect(pdfTextKnowledge(evidence)).toBe("sampled-no-text");
    expect(() => recordPdfPageText(evidence, 5, false)).toThrow(RangeError);
    expect(() => initialPdfTextEvidence(0)).toThrow(RangeError);
  });
});
