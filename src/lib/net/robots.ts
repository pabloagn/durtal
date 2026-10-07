/**
 * robots.txt (RFC 9309) for the evidence fetcher (SLN-468). The parser keeps
 * the groups for our product token, merged, else the `*` groups; the longest
 * matching path wins and `Allow` wins a tie; `*` and `$` are wildcards.
 * `Crawl-delay` is not in the RFC but it is respected.
 */

/** The bytes the parser reads at most: RFC 9309 asks for at least 500 KiB */
const MAX_ROBOTS_BYTES = 500 * 1024;

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsRules {
  /** The group the rules came from: our product token, `*`, or none */
  group: "agent" | "*" | "none";
  rules: RobotsRule[];
  /** Seconds, from the chosen group; null when it sets none */
  crawlDelay: number | null;
}

/**
 * A path as RFC 9309 (2.2.2) compares it: characters outside US-ASCII
 * percent-encoded as UTF-8, an encoded unreserved character decoded, every
 * other code in upper case. A URL's path arrives encoded, a rule often not.
 */
function comparablePath(path: string): string {
  return path
    .replace(/%([0-9a-f]{2})/gi, (code, hex: string) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9._~-]/.test(char) ? char : code.toUpperCase();
    })
    .replace(/[^\x00-\x7f]+/g, (run) => encodeURIComponent(run));
}

/** The rules for `agent` in a robots.txt body */
export function parseRobots(body: string, agent: string): RobotsRules {
  const token = agent.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of body.slice(0, MAX_ROBOTS_BYTES).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      // Consecutive user-agent lines name one group
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [], crawlDelay: null }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    // Only a group's own lines end its list of user agents; a Sitemap line does not
    if (!current || !["allow", "disallow", "crawl-delay"].includes(field)) continue;
    lastWasAgent = false;
    // An empty Disallow allows everything: it is no rule
    if (field !== "crawl-delay" && value) current.rules.push({ allow: field === "allow", path: comparablePath(value) });
    if (field === "crawl-delay" && /^\d+(\.\d+)?$/.test(value)) current.crawlDelay = Number(value);
  }
  const ours = groups.filter((g) => g.agents.includes(token));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);
  return {
    group: ours.length ? "agent" : chosen.length ? "*" : "none",
    rules: chosen.flatMap((g) => g.rules),
    crawlDelay: delays.length ? Math.max(...delays) : null,
  };
}

/** Whether a rule path matches a URL's path and query: `*` is any run of characters, `$` ends the URL */
function matches(rulePath: string, target: string): boolean {
  const anchored = rulePath.endsWith("$");
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(target);
}

/** The decision for one URL path (with its query): the longest matching rule wins, `Allow` on a tie */
export function robotsDecision(rules: RobotsRules, pathAndQuery: string): { allowed: boolean; rule: string | null } {
  // The robots.txt itself is always allowed
  if (pathAndQuery === "/robots.txt") return { allowed: true, rule: null };
  const target = comparablePath(pathAndQuery);
  let best: RobotsRule | null = null;
  for (const rule of rules.rules) {
    if (!matches(rule.path, target)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow && !best.allow)) best = rule;
  }
  return { allowed: best?.allow ?? true, rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.path}` : null };
}

/** What a robots.txt answer means for the whole host */
export function robotsFromAnswer(status: number, body: string | null, agent: string): RobotsRules | "unreachable" {
  if (status >= 200 && status < 300) return parseRobots(body ?? "", agent);
  // RFC 9309: a 4xx means no rules. A 429 is treated like a 5xx, which is stricter
  if (status >= 400 && status < 500 && status !== 429) return { group: "none", rules: [], crawlDelay: null };
  return "unreachable";
}
