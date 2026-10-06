import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createPageFetcher, EvidenceFetchError, type OutletPolicy } from "@/lib/net/safe-fetch-page";

/*
 * The evidence fetcher (SLN-468) against local servers. Each test gets its
 * own servers, so robots.txt, cached per origin, never leaks between tests.
 * The address policy allows only 127.0.0.1, as the image fetcher's tests do.
 */

const servers: http.Server[] = [];
const requests: { path: string; headers: http.IncomingHttpHeaders }[] = [];
const testOptions = { allowHttp: true, isBlockedAddress: (address: string) => address !== "127.0.0.1", minGapMs: 5 };

async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url ?? "/", headers: req.headers });
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A fetcher whose registry holds the given origins with one policy each */
function fetcherFor(policies: Record<string, OutletPolicy["fetchPolicy"]>, extra: object = {}) {
  return createPageFetcher({
    ...testOptions,
    ...extra,
    outletFor: (url) => (policies[url.origin] ? { key: `outlet-${url.port}`, fetchPolicy: policies[url.origin] } : null),
  });
}

const reason = async (work: Promise<unknown>) => {
  try {
    await work;
    return "ok";
  } catch (error) {
    return error instanceof EvidenceFetchError ? error.reason : `other: ${(error as Error).message}`;
  }
};

const html = (res: http.ServerResponse, body = "<html><body><p>A review.</p></body></html>", type = "text/html; charset=utf-8") =>
  res.writeHead(200, { "Content-Type": type }).end(body);
const noRobots = (req: http.IncomingMessage, res: http.ServerResponse) => req.url === "/robots.txt" && (res.writeHead(404).end(), true);

beforeAll(() => {
  process.env.ENRICHMENT_CONTACT = "test@example.org";
});
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

describe("the page fetcher", () => {
  it("fetches a page of a fetch outlet, with our User-Agent and no Cookie, Authorization or Referer", async () => {
    const base = await serve((req, res) => noRobots(req, res) || html(res));
    const page = await fetcherFor({ [base]: "fetch" }).fetchPage(`${base}/review`);
    expect(page).toMatchObject({ httpStatus: 200, contentType: "text/html", charset: "utf-8", outlet: expect.stringMatching(/^outlet-/) });
    expect(page.html).toContain("A review.");
    expect(page.robots).toMatchObject({ status: 404, group: "none", decision: "allowed" });
    const sent = requests.filter((r) => r.path === "/review").at(-1)!.headers;
    expect(sent["user-agent"]).toBe("DurtalBot/1.0 (personal book catalogue; test@example.org)");
    expect(sent.cookie ?? sent.authorization ?? sent.referer).toBeUndefined();
  });

  it("refuses to start without ENRICHMENT_CONTACT", () => {
    const contact = process.env.ENRICHMENT_CONTACT;
    delete process.env.ENRICHMENT_CONTACT;
    try {
      expect(() => fetcherFor({})).toThrow(/ENRICHMENT_CONTACT is not set/);
    } finally {
      process.env.ENRICHMENT_CONTACT = contact;
    }
  });

  it("refuses Goodreads and StoryGraph, subdomains included, before any network call", async () => {
    const all = createPageFetcher({ ...testOptions, outletFor: () => ({ key: "any", fetchPolicy: "fetch" }) });
    for (const url of ["https://www.goodreads.com/book/show/1", "https://goodreads.com/x", "https://app.thestorygraph.com/books/1"])
      expect(await reason(all.fetchPage(url))).toBe("blocked_host");
  });

  it("refuses a URL off the registry, and the outlets that are excluded or keep snippets only", async () => {
    const base = await serve((req, res) => noRobots(req, res) || html(res));
    expect(await reason(fetcherFor({}).fetchPage(`${base}/x`))).toBe("off_registry");
    expect(await reason(fetcherFor({ [base]: "excluded" }).fetchPage(`${base}/x`))).toBe("outlet_excluded");
    expect(await reason(fetcherFor({ [base]: "snippet_only" }).fetchPage(`${base}/x`))).toBe("snippet_only");
  });

  it("checks the registry and robots.txt on every hop: a redirect off the registry or into a disallowed path fails", async () => {
    const other = await serve((req, res) => noRobots(req, res) || html(res));
    const base = await serve((req, res) => {
      if (req.url === "/robots.txt") return res.writeHead(200, { "Content-Type": "text/plain" }).end("User-agent: *\nDisallow: /private/");
      if (req.url === "/off") return res.writeHead(302, { Location: `${other}/page` }).end();
      if (req.url === "/to-private") return res.writeHead(302, { Location: "/private/page" }).end();
      html(res);
    });
    const fetcher = fetcherFor({ [base]: "fetch" });
    expect(await reason(fetcher.fetchPage(`${base}/off`))).toBe("off_registry");
    expect(await reason(fetcher.fetchPage(`${base}/to-private`))).toBe("robots_disallowed");
    expect(requests.some((r) => r.path === "/private/page")).toBe(false);
  });

  it("refuses redirects to private addresses", async () => {
    const base = await serve((req, res) => noRobots(req, res) || res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end());
    expect(await reason(fetcherFor({ [base]: "fetch" }).fetchPage(`${base}/x`))).toBe("blocked_url");
  });

  it("enforces the size cap and the deadline", async () => {
    const base = await serve((req, res) => {
      if (noRobots(req, res)) return;
      if (req.url === "/big") return html(res, "x".repeat(2048));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write("<html>"); // never ends
    });
    const fetcher = fetcherFor({ [base]: "fetch" }, { maxBytes: 1024, timeoutMs: 300 });
    expect(await reason(fetcher.fetchPage(`${base}/big`))).toBe("too_large");
    expect(await reason(fetcher.fetchPage(`${base}/stall`))).toBe("timeout");
  });

  it("refuses types other than HTML and plain text", async () => {
    const base = await serve((req, res) => noRobots(req, res) || res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.4"));
    expect(await reason(fetcherFor({ [base]: "fetch" }).fetchPage(`${base}/a.pdf`))).toBe("unsupported_type");
  });

  it("fails 401, 402 and 403 as a paywall or a login, without a retry", async () => {
    let hits = 0;
    const base = await serve((req, res) => {
      if (noRobots(req, res)) return;
      hits++;
      res.writeHead(Number(req.url!.slice(1))).end();
    });
    const fetcher = fetcherFor({ [base]: "fetch" });
    for (const status of [401, 402, 403]) expect(await reason(fetcher.fetchPage(`${base}/${status}`))).toBe("paywall_or_login");
    expect(hits).toBe(3);
  });

  it("decodes with the charset of Content-Type, then of <meta charset>", async () => {
    const latin = Buffer.from("<html><head><meta charset=\"iso-8859-1\"></head><body>Libération</body></html>", "latin1");
    const base = await serve((req, res) => noRobots(req, res) || res.writeHead(200, { "Content-Type": "text/html" }).end(latin));
    const page = await fetcherFor({ [base]: "fetch" }).fetchPage(`${base}/fr`);
    expect(page.charset).toBe("windows-1252");
    expect(page.html).toContain("Libération");
  });
});

describe("robots.txt", () => {
  it("disallows the whole host when robots.txt answers 5xx, 429 or nothing", async () => {
    for (const status of [500, 429]) {
      const base = await serve((req, res) => (req.url === "/robots.txt" ? res.writeHead(status).end() : html(res)));
      expect(await reason(fetcherFor({ [base]: "fetch" }).fetchPage(`${base}/x`))).toBe("robots_unreachable");
    }
    const silent = await serve((req) => req.url === "/robots.txt" && req.socket.destroy());
    expect(await reason(fetcherFor({ [silent]: "fetch" }).fetchPage(`${silent}/x`))).toBe("robots_unreachable");
  });

  it("follows a robots.txt redirect, even to another host", async () => {
    const rules = await serve((_req, res) => res.writeHead(200, { "Content-Type": "text/plain" }).end("User-agent: DurtalBot\nDisallow: /no/"));
    const base = await serve((req, res) => (req.url === "/robots.txt" ? res.writeHead(301, { Location: `${rules}/robots.txt` }).end() : html(res)));
    const fetcher = fetcherFor({ [base]: "fetch" });
    expect(await reason(fetcher.fetchPage(`${base}/no/x`))).toBe("robots_disallowed");
    expect(await reason(fetcher.fetchPage(`${base}/yes`))).toBe("ok");
  });

  it("respects Crawl-delay between two requests, and skips a host that asks for more than 60 s", async () => {
    const times: number[] = [];
    const slow = await serve((req, res) => {
      if (req.url === "/robots.txt") return res.writeHead(200, { "Content-Type": "text/plain" }).end("User-agent: *\nCrawl-delay: 0.4");
      times.push(Date.now());
      html(res);
    });
    const fetcher = fetcherFor({ [slow]: "fetch" });
    await fetcher.fetchPage(`${slow}/a`);
    await fetcher.fetchPage(`${slow}/b`);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(390);
    const greedy = await serve((req, res) => (req.url === "/robots.txt" ? res.writeHead(200, { "Content-Type": "text/plain" }).end("User-agent: *\nCrawl-delay: 61") : html(res)));
    expect(await reason(fetcherFor({ [greedy]: "fetch" }).fetchPage(`${greedy}/a`))).toBe("crawl_delay_too_long");
  });
});
