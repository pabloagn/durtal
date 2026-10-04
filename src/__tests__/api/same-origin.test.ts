import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { proxy } from "@/proxy";

const request = (path: string, headers: Record<string, string> = {}, method = "POST") =>
  new NextRequest(`http://localhost:3100${path}`, {
    method,
    headers: { host: "localhost:3100", ...headers },
  });

describe("crossOriginRefusal", () => {
  it.each(["same-origin", "none"])("lets Sec-Fetch-Site %s through", (site) => {
    expect(crossOriginRefusal(request("/api/comments", { "sec-fetch-site": site }))).toBeNull();
  });

  it.each(["cross-site", "same-site"])("refuses Sec-Fetch-Site %s", async (site) => {
    const refused = crossOriginRefusal(request("/api/comments", { "sec-fetch-site": site }));
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toEqual({
      error: "Refused: the request comes from another site",
    });
  });

  it("checks Origin against Host when Sec-Fetch-Site is missing", () => {
    expect(crossOriginRefusal(request("/api/x", { origin: "http://localhost:3100" }))).toBeNull();
    expect(crossOriginRefusal(request("/api/x", { origin: "http://localhost:3000" }))?.status).toBe(403);
    expect(crossOriginRefusal(request("/api/x", { origin: "https://evil.example" }))?.status).toBe(403);
    expect(crossOriginRefusal(request("/api/x", { origin: "null" }))?.status).toBe(403);
  });

  it("lets a request from no web page through (curl, the TUI)", () => {
    expect(crossOriginRefusal(request("/api/media/process"))).toBeNull();
  });
});

describe("proxy", () => {
  it("refuses a cross-site API call before the route runs", () => {
    const res = proxy(request("/api/export", { "sec-fetch-site": "cross-site" }));
    expect(res?.status).toBe(403);
  });

  it("passes a same-origin API call on to the route", () => {
    expect(proxy(request("/api/export", { "sec-fetch-site": "same-origin" }))).toBeUndefined();
  });

  it("leaves pages to the page-size redirect", () => {
    expect(proxy(request("/library", { "sec-fetch-site": "cross-site" }, "GET"))).toBeUndefined();
  });
});
