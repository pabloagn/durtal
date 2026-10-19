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

// SLN-1137: Postgres refuses a NUL character in text, so one in a search or a
// path showed the error screen on the lists and was a 500 on record paths and APIs
describe("an address with a NUL character", () => {
  const LISTS = ["/library", "/people", "/series", "/recommenders", "/publishers", "/organizations", "/places",
    "/collections", "/films", "/perfumes", "/paintings", "/reading/journal", "/reading/notes", "/ebooks",
    "/ebooks/highlights", "/taxonomy/themes", "/publishers/gallimard", "/publishers/review"];
  const location = (response: Response | undefined) => new URL(response!.headers.get("location")!);

  it.each(LISTS)("sends %s with a NUL in its search to the same list without it", (list) => {
    const response = proxy(request(`${list}?q=%00`))!;
    expect(response.status).toBe(307);
    const target = location(response);
    expect(target.pathname).toBe(list);
    expect(target.searchParams.get("q")).toBe("");
  });

  it("drops it from every key and value, keeping the rest of the query", () => {
    const target = location(proxy(request("/people?zodiac=%00&q=na%00dja&page=2&%00=x&so%00rt=name")));
    expect([...target.searchParams]).toEqual([["zodiac", ""], ["q", "nadja"], ["page", "2"], ["sort", "name"]]);
    expect(location(proxy(request("/publishers/review?publisher=%00"))).search).toBe("?publisher=");
    expect(location(proxy(request("/publishers?country=%00"))).search).toBe("?country=");
  });

  it.each(["/api/works?q=%00", "/api/authors?q=%00", "/api/ebooks?q=%00"])("sends the API call %s on without it", (address) => {
    const target = location(proxy(request(address)));
    expect(target.pathname).toBe(address.split("?")[0]);
    expect(target.search).toBe("?q=");
  });

  it.each(["/films/%00", "/perfumes/%00", "/paintings/%00", "/organizations/%00", "/library/a%00b", "/reader/%00"])(
    "shows the not-found view for the path %s", (address) => {
      const target = new URL(rewrittenTo(proxy(request(`${address}?tab=books`)))!);
      expect(target.pathname).toBe("/_missing");
      expect(target.search).toBe("");
    });

  it("answers 404 for an API path holding one", async () => {
    const response = proxy(request("/api/works/%00"))!;
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Not found");
  });

  it("still refuses another name first", () => {
    expect(proxy(request("/library?q=%00", { method: "POST", host: "evil.example" }))?.status).toBe(421);
  });

  it("leaves an escaped percent and other control characters alone", () => {
    for (const address of ["/library?q=%2500", "/library?q=%01", "/library/%2500"]) {
      const response = proxy(request(address));
      expect(response?.headers.get("location")).toBeFalsy();
      expect(rewrittenTo(response)).toBeFalsy();
    }
  });
});

describe("headers on every answer", () => {
  const config = readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");

  it("lets only Durtal's own pages frame a page (SLN-897)", () => {
    expect(config).toMatch(/source: "\/:path\*",\s*headers: \[\s*\{ key: "X-Frame-Options", value: "SAMEORIGIN" \}/);
  });

  it("does not name the framework (SLN-899)", () => {
    expect(config).toContain("poweredByHeader: false");
  });
});
