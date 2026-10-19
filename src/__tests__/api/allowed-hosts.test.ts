import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { hostName, isAllowedHost, parseAllowedHosts } from "@/lib/api/allowed-hosts";
import { serverEnv } from "@/lib/env";
import { perPageCookieName } from "@/lib/utils/preference-cookies";
import { config, proxy } from "@/proxy";
/** Goes on to Next.js: no refusal or redirect, at most the page policy on it (SLN-1240) */
const passes = (res: Response | undefined | null | void) => !res || res.headers.get("x-middleware-next") === "1";

// Task 0608: requests on a name that is not Durtal's (DNS rebinding) are refused.

afterEach(() => vi.unstubAllEnvs());

const none = new Set<string>();
const request = (url: string, host: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, { method: init.method, headers: { host, ...init.headers } });

describe("isAllowedHost", () => {
  it.each([
    "localhost", "localhost:3100", "LOCALHOST:3110", "localhost.", "app.localhost:3000",
    "127.0.0.1", "127.0.0.1:3410", "[::1]:3000", "[::1]",
    "192.168.1.20:3110", "100.101.102.103:3110", "10.0.0.5",
    "studio.local:3100", "Studio-Mac.local", "studio.tail1234.ts.net:3110",
    "studio:3110", "Studio", "studio.:3110",
  ])("allows %s, which no outside page can own", (host) => {
    expect(isAllowedHost(host, none)).toBe(true);
  });

  it.each([
    "evil.example:3410", "evil.example", "localhost.evil.example", "127.0.0.1.nip.io",
    "studio.local.evil.example", "studio.ts.net.evil.example", "evilts.net", "256.1.1.1", "01.2.3.4",
    "", "a b", "evil.example:", "evil.example:x", "[::1]x", "[::1", "[evil.example]",
    "evil.example#.local", "evil.example/.ts.net", "studio_mac", "-studio",
  ])("refuses %s", (host) => {
    expect(isAllowedHost(host, none)).toBe(false);
  });

  it("allows a listed name on any port, in any case", () => {
    const { names } = parseAllowedHosts(" studio.home.arpa, Durtal.Example.com ");
    expect(isAllowedHost("studio.home.arpa", names)).toBe(true);
    expect(isAllowedHost("STUDIO.home.arpa:3110", names)).toBe(true);
    expect(isAllowedHost("durtal.example.com", names)).toBe(true);
    expect(isAllowedHost("other.home.arpa", names)).toBe(false);
    expect(isAllowedHost("evil.durtal.example.com", names)).toBe(false);
  });

  it("names the entries that are not host names", () => {
    expect(parseAllowedHosts("ok.example, https://bad.example, bad.example:3110, *.example,,").invalid)
      .toEqual(["https://bad.example", "bad.example:3110", "*.example"]);
    expect([...parseAllowedHosts(undefined).names]).toEqual([]);
  });

  it("reads the name of a Host header without its port", () => {
    expect(hostName("Studio.Local:3100")).toBe("studio.local");
    expect(hostName("[::1]:3000")).toBe("[::1]");
    expect(hostName("evil.example:x")).toBeNull();
  });
});

describe("the proxy on another name", () => {
  it.each([
    ["a page", "http://evil.example:3410/library", "GET"],
    ["a server action", "http://evil.example:3410/library", "POST"],
    ["an API route", "http://evil.example:3410/api/ebooks/upload", "POST"],
    ["a reader page", "http://evil.example:3410/reader/5fbb1291-cccb-4e84-b5ca-3f27634bc580", "GET"],
  ])("refuses %s with 421 before anything runs", async (_, url, method) => {
    // The #218 review's simulation: the browser calls it same-origin
    const response = proxy(request(url, "evil.example:3410", {
      method,
      headers: { origin: "http://evil.example:3410", "sec-fetch-site": "same-origin" },
    }));
    expect(response?.status).toBe(421);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("content-security-policy")).toBeNull();
    expect(await response?.text()).toContain("add the name to DURTAL_ALLOWED_HOSTS");
  });

  it("never trusts X-Forwarded-Host, which a page on a rebound name can set", () => {
    const response = proxy(request("http://evil.example:3410/api/stats", "evil.example:3410", {
      headers: { "x-forwarded-host": "localhost:3410" },
    }));
    expect(response?.status).toBe(421);
  });

  it("lets the app's own names through, and a name listed in DURTAL_ALLOWED_HOSTS", () => {
    expect(passes(proxy(request("http://localhost:3100/library", "localhost:3100")))).toBe(true);
    expect(proxy(request("http://studio.local:3110/api/stats", "studio.local:3110"))).toBeUndefined();
    expect(passes(proxy(request("http://studio.tail1234.ts.net:3110/library", "studio.tail1234.ts.net:3110")))).toBe(true);
    // A Tailscale short name (MagicDNS)
    expect(passes(proxy(request("http://studio:3110/library", "studio:3110")))).toBe(true);
    expect(proxy(request("http://durtal.example.com/library", "durtal.example.com"))?.status).toBe(421);
    vi.stubEnv("DURTAL_ALLOWED_HOSTS", "durtal.example.com");
    expect(passes(proxy(request("http://durtal.example.com/library", "durtal.example.com")))).toBe(true);
  });
});

describe("DURTAL_ALLOWED_HOSTS at startup", () => {
  it("stops the server on an entry that is not a host name", () => {
    vi.stubEnv("DURTAL_ALLOWED_HOSTS", "mac.tail1234.ts.net, https://durtal.example.com");
    expect(() => serverEnv()).toThrow(/DURTAL_ALLOWED_HOSTS: must be host names separated by commas/);
  });

  it("accepts names, and no value", () => {
    vi.stubEnv("DURTAL_ALLOWED_HOSTS", "mac.tail1234.ts.net,durtal.example.com");
    expect(serverEnv().DURTAL_ALLOWED_HOSTS).toBe("mac.tail1234.ts.net,durtal.example.com");
    vi.stubEnv("DURTAL_ALLOWED_HOSTS", "");
    expect(serverEnv().DURTAL_ALLOWED_HOSTS).toBeUndefined();
  });
});

describe("which requests the guard sees", () => {
  it.each(["/library", "/zz.y", "/library/a.b", "/api/stats", "/ebooks/x", "/favicon.ico", "/sw.js"])(
    "runs on %s: a server action posted to a path with a dot reaches the catch-all page",
    (path) => {
      expect(unstable_doesMiddlewareMatch({ config, url: `http://evil.example${path}` })).toBe(true);
    },
  );

  it("runs under /_next/ too, where Next.js also runs a server action posted to any path", () => {
    for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/_next/x"])
      expect(unstable_doesMiddlewareMatch({ config, url: `http://evil.example${path}` })).toBe(true);
  });
});

describe("the build's own files", () => {
  const files = [
    "/_next/static/chunks/app.js",
    "/_next/static/media/cirka.woff2",
    "/_next/webpack-hmr",
    "/_next/image?url=%2Ficons%2Fdurtal-192.png&w=64&q=85",
  ];

  it.each(files)("load on any name: %s", (path) => {
    for (const method of ["GET", "HEAD"]) {
      expect(proxy(request(`http://evil.example${path}`, "evil.example", { method }))).toBeUndefined();
      expect(proxy(request(`http://localhost:3100${path}`, "localhost:3100", { method }))).toBeUndefined();
    }
  });

  it("are never redirected to a saved page size", () => {
    const response = proxy(request("http://localhost:3100/_next/static/chunks/app.js", "localhost:3100", {
      headers: { cookie: `${perPageCookieName("/_next/static/chunks/app.js")}=48` },
    }));
    expect(response).toBeUndefined();
  });

  it.each([
    ["a server action", { method: "POST", headers: { "next-action": "7f00", origin: "http://evil.example" } }],
    ["a form posted without JavaScript", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" } }],
    ["a PUT", { method: "PUT" }],
    ["a DELETE", { method: "DELETE" }],
  ])("refuse %s under /_next/ on another name with 421", async (_, init) => {
    for (const path of ["/_next/x", "/_next/static/chunks/app.js", "/_next/image"]) {
      const response = proxy(request(`http://evil.example${path}`, "evil.example", init));
      expect(response?.status).toBe(421);
      expect(await response?.text()).toContain("add the name to DURTAL_ALLOWED_HOSTS");
      // On Durtal's own name it goes on to Next.js as before
      expect(passes(proxy(request(`http://localhost:3100${path}`, "localhost:3100", init)))).toBe(true);
    }
  });
});
