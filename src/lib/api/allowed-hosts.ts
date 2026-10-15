/**
 * The names Durtal answers to: a guard against DNS rebinding.
 *
 * A hostile page can point its own name at the Mac. The browser then treats
 * the app as that page's own origin, so the same-origin checks
 * (`same-origin.ts`) let its requests through. What the browser cannot hide
 * is the name it asked for: the `Host` header carries the hostile name. So
 * every page and API request whose host is not one of Durtal's own is
 * refused with 421, before anything runs.
 *
 * Always allowed, since no outside page can own them:
 * - `localhost` and any name under `.localhost` (browsers keep them on the
 *   machine);
 * - any IP address, such as 127.0.0.1, a LAN or a Tailscale address;
 * - any name under `.local` (the Mac's own network name, such as
 *   `studio.local`, which only the local network answers);
 * - any name under `.ts.net` (a Tailscale name): Tailscale assigns these
 *   names and their addresses, and outside a tailnet a name there resolves
 *   only to Tailscale's own relays, never to an address a page chooses.
 *
 * Any other name (a public or a custom name) is listed in
 * `DURTAL_ALLOWED_HOSTS`, comma-separated, without a port: it is allowed on
 * any port. `X-Forwarded-Host` is never read: a page on a rebound name can
 * set it.
 */
export const ALLOWED_HOSTS_VARIABLE = "DURTAL_ALLOWED_HOSTS";

const NAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The names in DURTAL_ALLOWED_HOSTS, lower-cased, and the entries that are not host names */
export function parseAllowedHosts(value: string | undefined) {
  const entries = (value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return {
    names: new Set(entries.filter((entry) => NAME.test(entry))),
    invalid: entries.filter((entry) => !NAME.test(entry)),
  };
}

/** The host name of a Host header, without its port and lower-cased; null when it is not one */
export function hostName(host: string) {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0 || (end + 1 < value.length && !/^:\d+$/.test(value.slice(end + 1)))) return null;
    return value.slice(0, end + 1);
  }
  const match = /^([^:]+)(:\d+)?$/.exec(value);
  return match ? match[1].replace(/\.$/, "") : null;
}

export function isAllowedHost(host: string, allowed: ReadonlySet<string>) {
  const name = hostName(host);
  if (!name) return false;
  if (name.startsWith("[")) return /^\[[0-9a-f:.]+\]$/.test(name);
  if (IPV4.test(name)) return true;
  if (name === "localhost" || [".localhost", ".local", ".ts.net"].some((suffix) => name.endsWith(suffix))) return true;
  return allowed.has(name);
}

let cached: { value: string | undefined; names: ReadonlySet<string> } | null = null;

/**
 * The 421 for a request on another name, or null. A request with no Host
 * header does not come from a browser (HTTP/1.0 scripts) and passes.
 */
export function hostRefusal(request: Request): Response | null {
  const host = request.headers.get("host");
  if (host === null) return null;
  const value = process.env[ALLOWED_HOSTS_VARIABLE];
  if (!cached || cached.value !== value) cached = { value, names: parseAllowedHosts(value).names };
  if (isAllowedHost(host, cached.names)) return null;
  return new Response(
    `Refused: Durtal does not answer to ${hostName(host) ?? "this address"}. To open it under this name, add the name to ${ALLOWED_HOSTS_VARIABLE}.`,
    { status: 421, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
