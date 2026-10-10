import type { PDFWorker } from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import { PDFJS_VERSION } from "@/lib/reader/engines/foliate/pdf-options";
import { createOwnedPdfWorker } from "@/lib/reader/engines/foliate/pdf-worker";

const base = `https://reader.example/vendor/pdfjs/${PDFJS_VERSION}/`;
function harness() {
  const port = new EventTarget() as Worker;
  port.terminate = vi.fn();
  const destroy = vi.fn();
  const create = vi.fn(() => ({ port, destroy }) as unknown as PDFWorker);
  const createWorker = vi.fn((_url: URL) => port);
  return {
    port,
    destroy,
    createWorker,
    api: { version: PDFJS_VERSION, PDFWorker: { create } },
  };
}

describe("per-document native PDF worker ownership", () => {
  it("uses an exact same-origin module URL and explicit isolated port", () => {
    const h = harness();
    const owned = createOwnedPdfWorker(
      h.api,
      base,
      "https://reader.example",
      h.createWorker,
    );
    expect(h.createWorker.mock.calls[0][0].href).toBe(
      base + "pdf.worker.min.mjs",
    );
    expect(h.api.PDFWorker.create).toHaveBeenCalledWith({ port: h.port });
    owned.destroy();
    owned.destroy();
    expect(h.destroy).toHaveBeenCalledOnce();
    expect(h.port.terminate).toHaveBeenCalledOnce();
  });

  it("refuses version mismatch, cross-origin assets and unversioned bases before spawning", () => {
    const h = harness();
    expect(() =>
      createOwnedPdfWorker(
        { ...h.api, version: "old" },
        base,
        "https://reader.example",
        h.createWorker,
      ),
    ).toThrow(/versions differ/);
    expect(() =>
      createOwnedPdfWorker(
        h.api,
        base,
        "https://other.example",
        h.createWorker,
      ),
    ).toThrow(/reader origin/);
    expect(() =>
      createOwnedPdfWorker(
        h.api,
        "https://reader.example/vendor/pdfjs/",
        "https://reader.example",
        h.createWorker,
      ),
    ).toThrow(/versioned/);
    expect(h.createWorker).not.toHaveBeenCalled();
  });

  it.each(["error", "messageerror"])(
    "exposes %s as an observed failure without falling back",
    async (name) => {
      const h = harness();
      const owned = createOwnedPdfWorker(
        h.api,
        base,
        "https://reader.example",
        h.createWorker,
      );
      const rejected = expect(owned.failure).rejects.toThrow(/worker failed/);
      h.port.dispatchEvent(new Event(name));
      await rejected;
      expect(h.api.PDFWorker.create).toHaveBeenCalledOnce();
      owned.destroy();
    },
  );

  it("terminates the port if pdf.js initialization or destruction throws", () => {
    const h = harness();
    h.api.PDFWorker.create.mockImplementationOnce(() => {
      throw new Error("init");
    });
    expect(() =>
      createOwnedPdfWorker(
        h.api,
        base,
        "https://reader.example",
        h.createWorker,
      ),
    ).toThrow("init");
    expect(h.port.terminate).toHaveBeenCalledOnce();
    const another = harness();
    const owned = createOwnedPdfWorker(
      another.api,
      base,
      "https://reader.example",
      another.createWorker,
    );
    another.destroy.mockImplementationOnce(() => {
      throw new Error("destroy");
    });
    expect(() => owned.destroy()).toThrow("destroy");
    expect(another.port.terminate).toHaveBeenCalledOnce();
  });
});
