import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

// SLN-898: an address with a broken percent code (/library/%ff) cannot be
// matched to a page, and Next.js answered it with a bare 500

const request = (pathAndQuery: string, init: { method?: string; host?: string } = {}) =>
  new NextRequest(`http://localhost:3100${pathAndQuery}`, {
    method: init.method,
    headers: { host: init.host ?? "localhost:3100" },
  });
const rewrittenTo = (response: Response | undefined) => response?.headers.get("x-middleware-rewrite");

describe("an address with a broken percent code", () => {
  it.each([
    ["/library/%ff", "/library/%25ff"],
    ["/people/%E2%82", "/people/%25E2%2582"],
    ["/zz%ff", "/zz%25ff"],
    ["/fonts/%ff", "/fonts/%25ff"],
    ["/reader/%c0%af", "/reader/%25c0%25af"],
  ])("shows %s's not-found view, reading the broken part as text", (from, to) => {
    expect(new URL(rewrittenTo(proxy(request(from)))!).pathname).toBe(to);
  });

  it("escapes only the segments that do not decode, and keeps the query", () => {
    const target = new URL(rewrittenTo(proxy(request("/places/caf%C3%A9/%ff?tab=books")))!);
    expect(target.pathname).toBe("/places/caf%C3%A9/%25ff");
    expect(target.search).toBe("?tab=books");
  });

  it.each(["/api/%ff", "/api/works/%ff", "/_next/static/%ff"])("answers 400 for API routes and build files: %s", async (address) => {
    const response = proxy(request(address))!;
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("The address has a broken percent code");
  });

  it("still refuses another name first, so nothing is posted to the page it shows", () => {
    expect(proxy(request("/library/%ff", { method: "POST", host: "evil.example" }))?.status).toBe(421);
  });

  it("leaves addresses that decode alone", () => {
    for (const address of ["/library/caf%C3%A9", "/library/%25ff", "/zz"])
      expect(rewrittenTo(proxy(request(address)))).toBeFalsy();
  });
});

describe("headers on every answer", () => {
  const config = readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");

  it("lets only Durtal's own pages frame a page (SLN-897)", () => {
    expect(config).toContain('{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] }');
  });

  it("does not name the framework (SLN-899)", () => {
    expect(config).toContain("poweredByHeader: false");
  });
});
