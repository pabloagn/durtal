/**
 * Address policy for server-side requests to user-supplied URLs (SSRF guard).
 * Pure functions, no Node imports: used by the URL pre-check and by the
 * connect-time DNS check in `safe-fetch.ts`.
 */

/** Parse a dotted IPv4 address to an unsigned 32-bit integer, or null. */
export function parseIPv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

/** Parse an IPv6 address (with optional brackets, zone or embedded IPv4) to 8 groups, or null. */
export function parseIPv6(address: string): number[] | null {
  let a = address.toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);

  const lastColon = a.lastIndexOf(":");
  if (lastColon === -1) return null;
  const last = a.slice(lastColon + 1);
  if (last.includes(".")) {
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    a = `${a.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;

  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

// IPv4 special-purpose ranges (IANA registry) that a server must never fetch.
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT, also Tailscale addresses
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

const V4_BLOCKED_PARSED = V4_BLOCKED.map(([base, len]) => {
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return { net: (parseIPv4(base)! & mask) >>> 0, mask };
});

function isBlockedIPv4(ip: number): boolean {
  return V4_BLOCKED_PARSED.some(({ net, mask }) => ((ip & mask) >>> 0) === net);
}

function isBlockedIPv6(g: number[]): boolean {
  const embeddedV4 = (hi: number, lo: number) => ((hi << 16) >>> 0) + lo;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  if (zeros(0, 8)) return true; // :: unspecified
  if (zeros(0, 7) && g[7] === 1) return true; // ::1 loopback
  if (zeros(0, 5) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4(g[6], g[7])); // ::ffff:a.b.c.d mapped
  if (zeros(0, 6)) return isBlockedIPv4(embeddedV4(g[6], g[7])); // ::a.b.c.d compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isBlockedIPv4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedIPv4(embeddedV4(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && zeros(1, 4)) return true; // discard-only 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7 (also Tailscale fd7a:115c:a1e0::/48)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True when a string is an IPv4 or IPv6 address literal (brackets allowed). */
export function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || parseIPv6(host) !== null;
}

/**
 * True when the server must not connect to this address: private, loopback,
 * link-local, metadata, CGNAT/Tailscale, documentation, multicast or reserved.
 * Anything that does not parse as an IP address is blocked (fail closed).
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4 !== null) return isBlockedIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6 !== null) return isBlockedIPv6(v6);
  return true;
}
