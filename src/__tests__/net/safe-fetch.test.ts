import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createGuardedLookup, safeFetchImage, SafeFetchError, sniffImageType } from "@/lib/net/safe-fetch";

// Local test servers live on 127.0.0.1. The injected policy allows exactly that
// address (production blocks it), so every other private target stays blocked.
const allowOnlyTestServer = (address: string) => address !== "127.0.0.1";
const opts = { allowHttp: true, isBlockedAddress: allowOnlyTestServer };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const MB = 1024 * 1024;

let server: http.Server;
let canary: http.Server;
let base = "";
let canaryPort = 0;
let canaryHits = 0;
let streamedBytes = 0;

beforeAll(async () => {
  canary = http.createServer((_req, res) => {
    canaryHits++;
    res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
  });
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/png") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
    if (path === "/octet-png") return res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(PNG);
    if (path === "/html") return res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><html><body>not an image</body></html>");
    if (path === "/svg") return res.writeHead(200, { "Content-Type": "image/svg+xml" }).end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    if (path === "/redirect-ok") return res.writeHead(302, { Location: "/png" }).end();
    if (path === "/redirect-localhost") return res.writeHead(302, { Location: `http://localhost:${canaryPort}/x.png` }).end();
    if (path === "/redirect-metadata") return res.writeHead(301, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
    if (path === "/redirect-tailscale") return res.writeHead(307, { Location: "http://100.100.100.100/x.png" }).end();
    if (path === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
    if (path === "/404") return res.writeHead(404).end("missing");
    if (path === "/big-declared") {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(100 * MB) });
      res.write(PNG);
      return; // never sends the rest
    }
    if (path === "/big-stream") {
      streamedBytes = 0;
      res.writeHead(200, { "Content-Type": "image/png" }); // chunked, no length
      const chunk = Buffer.alloc(MB, 2);
      res.write(PNG);
      const pump = () => {
        while (streamedBytes < 100 * MB) {
          streamedBytes += chunk.length;
          if (!res.write(chunk)) return res.once("drain", pump);
        }
        res.end();
      };
      res.on("close", () => res.removeAllListeners("drain"));
      return pump();
    }
    if (path === "/stall") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.write(PNG.subarray(0, 16));
      return; // never ends
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => canary.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  canaryPort = (canary.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  canary.closeAllConnections();
  await new Promise((r) => server.close(r));
  await new Promise((r) => canary.close(r));
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof SafeFetchError ? err.code : `other: ${(err as Error).message}`;
  }
}

describe("sniffImageType", () => {
  it("detects the four accepted formats and nothing else", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(sniffImageType(Buffer.from("<svg xmlns=", "latin1"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("safeFetchImage", () => {
  it("downloads an image and reports the detected type", async () => {
    const img = await safeFetchImage(`${base}/png`, opts);
    expect(img.contentType).toBe("image/png");
    expect(img.buffer.equals(PNG)).toBe(true);
  });

  it("accepts a real image served as application/octet-stream", async () => {
    expect((await safeFetchImage(`${base}/octet-png`, opts)).contentType).toBe("image/png");
  });

  it("follows a safe redirect and returns the final URL", async () => {
    const img = await safeFetchImage(`${base}/redirect-ok`, opts);
    expect(img.finalUrl).toBe(`${base}/png`);
  });

  it("refuses redirects to local or private targets without connecting", async () => {
    canaryHits = 0;
    expect(await code(safeFetchImage(`${base}/redirect-localhost`, opts))).toBe("blocked_url");
    expect(await code(safeFetchImage(`${base}/redirect-metadata`, opts))).toBe("blocked_url");
    expect(await code(safeFetchImage(`${base}/redirect-tailscale`, opts))).toBe("blocked_url");
    expect(canaryHits).toBe(0);
    // control: the canary does count requests that reach it
    await safeFetchImage(`http://127.0.0.1:${canaryPort}/x.png`, opts);
    expect(canaryHits).toBe(1);
  });

  it("uses the production policy by default: loopback is refused", async () => {
    canaryHits = 0;
    expect(await code(safeFetchImage(`http://127.0.0.1:${canaryPort}/x.png`, { allowHttp: true }))).toBe("blocked_url");
    expect(canaryHits).toBe(0);
  });

  it("is https-only unless http is allowed", async () => {
    expect(await code(safeFetchImage(`${base}/png`, { isBlockedAddress: allowOnlyTestServer }))).toBe("blocked_url");
  });

  it("rejects non-images, including SVG", async () => {
    expect(await code(safeFetchImage(`${base}/html`, opts))).toBe("not_image");
    expect(await code(safeFetchImage(`${base}/svg`, opts))).toBe("not_image");
  });

  it("rejects error statuses", async () => {
    expect(await code(safeFetchImage(`${base}/404`, opts))).toBe("bad_status");
  });

  it("stops redirect loops", async () => {
    expect(await code(safeFetchImage(`${base}/loop`, { ...opts, maxRedirects: 3 }))).toBe("too_many_redirects");
  });

  it("rejects a declared oversize body before reading it", async () => {
    const started = Date.now();
    expect(await code(safeFetchImage(`${base}/big-declared`, { ...opts, maxBytes: 5 * MB }))).toBe("too_large");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rejects an oversize streamed body without buffering it all", async () => {
    expect(await code(safeFetchImage(`${base}/big-stream`, { ...opts, maxBytes: 5 * MB }))).toBe("too_large");
    // the server was stopped long before the 100 MB it wanted to send
    expect(streamedBytes).toBeLessThan(30 * MB);
  });

  it("enforces one deadline for the whole transfer", async () => {
    const started = Date.now();
    expect(await code(safeFetchImage(`${base}/stall`, { ...opts, timeoutMs: 400 }))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("createGuardedLookup", () => {
  const resolve = (lookup: ReturnType<typeof createGuardedLookup>, host: string) =>
    new Promise<string>((ok, fail) =>
      lookup(host, { family: 0 }, (err, address) => (err ? fail(err) : ok(String(address)))),
    );

  it("refuses a host name that resolves to a blocked address", async () => {
    const err = await resolve(createGuardedLookup(), "localhost").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).code).toBe("blocked_address");
  });

  it("returns the address when the policy allows it", async () => {
    const address = await resolve(createGuardedLookup(() => false), "localhost");
    expect(["127.0.0.1", "::1"]).toContain(address);
  });
});
