import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import nextConfig from "../../../next.config";
import { catalogueCsp } from "@/lib/page-csp";
import { proxy } from "@/proxy";

/* SLN-1240: the catalogue's content policy, and the headers every answer carries */

/** A next.config source as Next matches it: "/:path*" is any path, ":file" one segment */
const matches = (source: string, path: string) =>
  new RegExp(`^${source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\/:\w+\*/g, "(?:/.*)?").replace(/:\w+/g, "[^/]+")}$`).test(path);
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("catalogueCsp", () => {
  it("lets only the app's own and nonced scripts run", () => {
    const csp = catalogueCsp("abc123");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("allows eval only for the development server, and names the e-book CDN for connections only", () => {
    expect(directive(catalogueCsp("n", { development: true }), "script-src")).toBe("script-src 'self' 'nonce-n' 'unsafe-eval'");
    const csp = catalogueCsp("n", { cdnUrl: "https://d123.cloudfront.net/some/path" });
    expect(directive(csp, "connect-src")).toContain(" https://d123.cloudfront.net");
    expect(directive(csp, "script-src")).not.toContain("cloudfront");
    expect(directive(catalogueCsp("n", { cdnUrl: "javascript:alert(1)" }), "connect-src")).not.toContain("javascript");
  });
});

describe("the proxy", () => {
  const visit = (path: string, init: { method?: string; cookie?: string } = {}) =>
    proxy(
      new NextRequest(`https://durtal.test${path}`, {
        method: init.method ?? "GET",
        headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(path.startsWith("/api/") ? { "sec-fetch-site": "same-origin" } : {}) },
      }),
    ) as Response | undefined;
  const nonceOf = (res: Response) => /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
  afterEach(() => vi.unstubAllEnvs());

  it("puts the policy with a fresh nonce on each catalogue page, and the nonce on the request for Next.js", () => {
    for (const path of ["/", "/library", "/people/someone", "/settings/display", "/offline", "/ebooks/offline", "/no-such-page"]) {
      const a = visit(path)!;
      const b = visit(path)!;
      expect(a.headers.get("content-security-policy")).toBe(catalogueCsp(nonceOf(a)!));
      expect(nonceOf(b)).not.toBe(nonceOf(a));
      expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(a));
    }
    // A form posted to a page, or a server action, renders with it too
    expect(nonceOf(visit("/library", { method: "POST" })!)).toBeTruthy();
  });

  it("still sends a list page to its saved page size first", () => {
    const res = visit("/films", { cookie: "durtal-per-page_films=96" });
    expect(res?.headers.get("location")).toContain("perPage=96");
  });

  it("leaves API answers and public files to their own headers", () => {
    expect(visit("/api/works")).toBeUndefined();
    for (const path of ["/sw.js", "/offline-assets.json", "/vendor/pdfjs/x/pdf.worker.min.mjs", "/fonts/reader/a.woff2", "/icon.svg", "/manifest.webmanifest"])
      expect(visit(path)?.headers.get("content-security-policy") ?? null).toBeNull();
  });
});

describe("every answer's headers", () => {
  it("sends nosniff and Referrer-Policy on pages, API routes and the reader", async () => {
    const rules = await nextConfig.headers!();
    const on = (path: string) =>
      Object.fromEntries(
        rules
          .filter((rule) => matches(rule.source, path))
          .flatMap((rule) => rule.headers.map((h) => [h.key.toLowerCase(), h.value])),
      );
    for (const path of ["/", "/library", "/api/works", "/api/s3/read", "/reader/5e0c6a43-2f43-4b8e-a1f4-2b3c4d5e6f70", "/sw.js"]) {
      expect(on(path)).toMatchObject({
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-frame-options": "SAMEORIGIN",
        "x-robots-tag": "noindex, nofollow",
      });
    }
  });
});
