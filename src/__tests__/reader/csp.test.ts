import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeNonce, readerCsp } from "@/lib/reader/csp";
import { proxy } from "@/proxy";

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

describe("the proxy on reader pages", () => {
  const page = "/reader/5e0c6a43-2f43-4b8e-a1f4-2b3c4d5e6f70";
  const device = "0b7c6f0e-6a55-4a3e-9d33-1f1e7c2b9a10";
  const visit = (path: string, cookie?: string) =>
    proxy(new NextRequest(`https://durtal.test${path}`, { headers: cookie ? { cookie } : {} })) as Response | undefined;
  const nonceOf = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
  afterEach(() => vi.unstubAllEnvs());

  it("gives each reader page the policy with a fresh nonce", () => {
    const a = visit(page)!;
    const b = visit(page)!;
    expect(nonceOf(a)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(nonceOf(b)).not.toBe(nonceOf(a));
    // Next.js reads the nonce for its own scripts from the request
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(a));
    expect(a.headers.get("content-security-policy")).not.toContain("unsafe-eval");
  });

  it("leaves every other page without it", () => {
    for (const path of ["/library", "/readers", "/reading"]) {
      expect(visit(path)?.headers.get("content-security-policy") ?? null).toBeNull();
    }
  });

  it("allows eval in development and names the CDN when it is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EBOOK_CDN_URL", "https://d123.cloudfront.net");
    const csp = visit(page)!.headers.get("content-security-policy")!;
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' https://d123.cloudfront.net");
  });

  it("gives a new device its id cookie once, and keeps a valid one", () => {
    const fresh = visit(page)!;
    const cookie = fresh.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^durtal-device=[0-9a-f-]{36}; /);
    expect(cookie).toMatch(/Max-Age=34560000/);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(visit(page, `durtal-device=${device}`)!.headers.get("set-cookie")).toBeNull();
    expect(visit(page, "durtal-device=forged")!.headers.get("set-cookie")).toMatch(/^durtal-device=[0-9a-f-]{36}; /);
  });
});
