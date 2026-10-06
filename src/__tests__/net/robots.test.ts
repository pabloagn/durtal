import { describe, expect, it } from "vitest";
import { parseRobots, robotsDecision, robotsFromAnswer } from "@/lib/net/robots";

/* robots.txt (RFC 9309) for the evidence fetcher (SLN-468) */

const allowed = (body: string, path: string) => robotsDecision(parseRobots(body, "DurtalBot"), path).allowed;

describe("group choice", () => {
  it("uses the groups that name our product token, case-insensitively, and merges them", () => {
    const body = ["User-agent: *", "Disallow: /", "", "User-agent: durtalbot", "Disallow: /private/", "", "User-agent: DurtalBot", "Disallow: /drafts/"].join("\n");
    const rules = parseRobots(body, "DurtalBot");
    expect(rules.group).toBe("agent");
    expect(allowed(body, "/reviews/a")).toBe(true);
    expect(allowed(body, "/private/x")).toBe(false);
    expect(allowed(body, "/drafts/x")).toBe(false);
  });

  it("falls back to the * groups, and allows everything without a group", () => {
    expect(allowed("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search", "/search?q=x")).toBe(false);
    expect(allowed("User-agent: Googlebot\nDisallow: /", "/anything")).toBe(true);
    expect(parseRobots("User-agent: Googlebot\nDisallow: /", "DurtalBot").group).toBe("none");
  });

  it("keeps consecutive user-agent lines in one group, across a Sitemap line", () => {
    const body = "User-agent: Googlebot\nSitemap: https://x/s.xml\nUser-agent: DurtalBot\nDisallow: /x/";
    expect(allowed(body, "/x/1")).toBe(false);
  });
});

describe("matching", () => {
  it("takes the longest matching path, and Allow on a tie", () => {
    const body = "User-agent: *\nDisallow: /books/\nAllow: /books/reviews/\nDisallow: /a\nAllow: /a";
    expect(allowed(body, "/books/reviews/1")).toBe(true);
    expect(allowed(body, "/books/other")).toBe(false);
    expect(allowed(body, "/a")).toBe(true);
  });

  it("supports * and $", () => {
    const body = "User-agent: *\nDisallow: /*?print=1\nDisallow: /*.pdf$";
    expect(allowed(body, "/review?print=1")).toBe(false);
    expect(allowed(body, "/file.pdf")).toBe(false);
    expect(allowed(body, "/file.pdf?x=1")).toBe(true);
    expect(allowed(body, "/review")).toBe(true);
  });

  it("treats an empty Disallow as no rule, and always allows /robots.txt", () => {
    expect(allowed("User-agent: *\nDisallow:", "/x")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /", "/robots.txt")).toBe(true);
  });

  it("reads Crawl-delay from the chosen group", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: 10\nDisallow: /x", "DurtalBot").crawlDelay).toBe(10);
  });
});

describe("answers", () => {
  it("parses a 2xx, allows on a 4xx other than 429, and disallows the host on a 5xx or a 429", () => {
    expect(robotsFromAnswer(200, "User-agent: *\nDisallow: /", "DurtalBot")).toMatchObject({ group: "*" });
    expect(robotsFromAnswer(404, null, "DurtalBot")).toEqual({ group: "none", rules: [], crawlDelay: null });
    expect(robotsFromAnswer(429, null, "DurtalBot")).toBe("unreachable");
    expect(robotsFromAnswer(503, null, "DurtalBot")).toBe("unreachable");
  });
});
