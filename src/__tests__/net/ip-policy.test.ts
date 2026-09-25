import { describe, expect, it } from "vitest";
import { isBlockedAddress, isIpLiteral, parseIPv4, parseIPv6 } from "@/lib/net/ip-policy";
import { isSafeUrl } from "@/lib/validations/media-security";

describe("parseIPv4 / parseIPv6", () => {
  it("parses dotted IPv4 and rejects malformed input", () => {
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff);
    expect(parseIPv4("256.0.0.1")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
    expect(parseIPv4("a.b.c.d")).toBeNull();
  });

  it("parses IPv6 forms: compressed, bracketed, zone, embedded IPv4", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("[::1]")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("fe80::1%en0")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("2001:db8:0:0:0:0:0:1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(parseIPv6("12345::1")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7")).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.100.100.100", "127.0.0.1", "127.255.255.254",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.10", "192.168.1.1",
    "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ])("blocks IPv4 %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::127.0.0.1",
    "64:ff9b::a9fe:a9fe", "2002:7f00:1::1", "2001:0:4136:e378::1", "2001:db8::1", "100::1",
    "fc00::1", "fd7a:115c:a1e0::1", "fe80::1", "fec0::1", "ff02::1",
  ])("blocks IPv6 %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2a00:1450:4001::200e"])(
    "allows public address %s",
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it("fails closed on anything that is not an IP address", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });

  it("recognizes IP literals", () => {
    expect(isIpLiteral("10.0.0.1")).toBe(true);
    expect(isIpLiteral("[::1]")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });
});

describe("isSafeUrl (extended SSRF checks)", () => {
  it.each([
    "https://2130706433/x.png", // decimal 127.0.0.1
    "https://0x7f.1/x.png", // hex
    "https://017700000001/x.png", // octal
    "https://[::1]/x.png",
    "https://[::ffff:127.0.0.1]/x.png",
    "https://[fd7a:115c:a1e0::1]/x.png", // Tailscale IPv6
    "https://169.254.169.254/latest/meta-data",
    "https://100.101.102.103/x.png", // Tailscale IPv4
    "https://0.0.0.0/x.png",
    "https://osmium/x.png", // single-label intranet name
    "https://osmium.tail1234.ts.net/x.png", // Tailscale MagicDNS
    "https://printer.lan/x.png",
    "https://nas.home.arpa/x.png",
    "https://app.localhost/x.png",
    "https://localhost./x.png",
    "https://user:pass@example.com/x.png", // credentials
    "ftp://example.com/x.png",
    "javascript:alert(1)",
  ])("rejects %s", (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });

  it("accepts public https URLs", () => {
    expect(isSafeUrl("https://covers.openlibrary.org/b/isbn/9780679722762-L.jpg")).toBe(true);
    expect(isSafeUrl("https://8.8.8.8/x.png")).toBe(true);
  });

  it("accepts http only when allowed", () => {
    expect(isSafeUrl("http://books.google.com/x.jpg")).toBe(false);
    expect(isSafeUrl("http://books.google.com/x.jpg", { allowHttp: true })).toBe(true);
    expect(isSafeUrl("http://127.0.0.1/x.jpg", { allowHttp: true })).toBe(false);
  });
});
