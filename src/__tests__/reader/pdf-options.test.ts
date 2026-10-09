import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pdfDocumentOptions,
  PDFJS_VERSION,
  PDF_WORKER_CSP,
} from "@/lib/reader/engines/foliate/pdf-options";

const require = createRequire(import.meta.url);
const installed = dirname(require.resolve("pdfjs-dist/package.json"));
const base = `https://durtal.invalid/vendor/pdfjs/${PDFJS_VERSION}/`;

describe("installed pdf.js document and security policy", () => {
  it("uses the pinned installed version and exact locked-down options", () => {
    expect(PDFJS_VERSION).toBe("6.4.299");
    expect(pdfDocumentOptions(base)).toEqual({
      rangeChunkSize: 262144,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      enableXfa: false,
      useWorkerFetch: true,
      cMapPacked: true,
      cMapUrl: `${base}cmaps/`,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
      canvasMaxAreaInBytes: 67108864,
    });
  });

  it("names absolute versioned directories that actually ship in this installation", () => {
    for (const key of [
      "cMapUrl",
      "standardFontDataUrl",
      "wasmUrl",
      "iccUrl",
    ] as const) {
      const url = new URL(pdfDocumentOptions(base)[key]);
      expect(url.origin).toBe("https://durtal.invalid");
      expect(url.pathname.startsWith(`/vendor/pdfjs/${PDFJS_VERSION}/`)).toBe(
        true,
      );
      expect(existsSync(join(installed, url.pathname.split("/").at(-2)!))).toBe(
        true,
      );
    }
    expect(existsSync(join(installed, "build/pdf.worker.min.mjs"))).toBe(true);
  });

  it.each([
    "/vendor/pdfjs/6.4.299/",
    "https://durtal.invalid/vendor/pdfjs/",
    "https://durtal.invalid/vendor/pdfjs/old/",
    `${base}?other=1`,
    `${base}#other`,
    "file:///vendor/pdfjs/6.4.299/",
    "https://user:pass@durtal.invalid/vendor/pdfjs/6.4.299/",
  ])("refuses an unsafe or mismatched asset base %s", (bad) =>
    expect(() => pdfDocumentOptions(bad)).toThrow(),
  );

  it("checks actual installed behavior rather than crediting an ignored eval option", () => {
    const display = readFileSync(join(installed, "build/pdf.mjs"), "utf8");
    const worker = readFileSync(
      join(installed, "build/pdf.worker.mjs"),
      "utf8",
    );
    expect(display).toContain('apiVersion: "6.4.299"');
    expect(display).not.toContain("src.isEvalSupported");
    expect(worker).not.toContain("isEvalSupported");
    // Version 6.4.299 compiles PostScript to wasm/IR; no native JS eval/Function.
    expect(worker).toContain("buildPostScriptWasmFunction");
    expect(worker).toContain("PsJsCompiler.execute");
    expect(worker).not.toMatch(/\b(?:eval\s*\(|new\s+Function\s*\()/);
    expect(display).not.toMatch(/\b(?:eval\s*\(|new\s+Function\s*\()/);
    expect(display).toContain(
      "enableScripting: params.enableScripting === true",
    );
    expect(PDF_WORKER_CSP).toBe(
      "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
    );
    expect(PDF_WORKER_CSP.split(/[ ;]+/)).not.toContain("'unsafe-eval'");
  });
});
