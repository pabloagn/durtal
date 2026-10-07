import { describe, expect, it } from "vitest";
import { makeNonce, readerCsp } from "@/lib/reader/csp";

/* SLN-492: the reader page's content policy, which every book frame inherits */

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("readerCsp", () => {
  it("lets only the app's own and nonced scripts run", () => {
    const csp = readerCsp("abc123");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
    expect(directive(csp, "frame-src")).toBe("frame-src 'self' blob:");
    expect(directive(csp, "worker-src")).toBe("worker-src 'self' blob:");
  });

  it("allows eval only for the development server", () => {
    expect(directive(readerCsp("n", { development: true }), "script-src")).toBe("script-src 'self' 'nonce-n' 'unsafe-eval'");
  });

  it("adds the e-book CDN's origin to images and connections", () => {
    const csp = readerCsp("n", { cdnUrl: "https://d123.cloudfront.net/some/path" });
    expect(directive(csp, "img-src")).toBe("img-src 'self' blob: data: https://d123.cloudfront.net");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://d123.cloudfront.net");
    expect(directive(csp, "script-src")).not.toContain("cloudfront");
  });

  it("ignores a CDN setting that is not an http URL", () => {
    for (const cdnUrl of ["not a url", "javascript:alert(1)", ""]) {
      expect(directive(readerCsp("n", { cdnUrl }), "connect-src")).toBe("connect-src 'self'");
    }
  });
});

describe("makeNonce", () => {
  it("makes 16 random bytes in base64, different each time", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(a)).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });
});
