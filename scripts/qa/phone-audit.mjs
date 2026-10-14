#!/usr/bin/env node
/**
 * Phone audit: loads each route in headless Chrome at phone widths and runs
 * scripts/qa/overflow-audit.js on it. Exits 1 when a page scrolls sideways or
 * an element reaches past the right edge of the screen.
 *
 * It also runs scripts/qa/layout-audit.js (SLN-695): squeezed titles, commands
 * that look like text, drifting edges in cards and, on list pages, a first
 * card below the top 60% of the screen. Its findings are listed under each
 * route; those in scripts/qa/layout-audit-known.json are marked known, with
 * their ticket. Only --strict makes a new layout finding fail the run.
 *
 *   node scripts/qa/phone-audit.mjs [--base http://127.0.0.1:3410] [--strict] [route...]
 *
 * A route ending in /* is the first record its list page links to.
 *
 * Point it at a running app, such as scripts/qa/preview-local.py. Chrome comes
 * from $CHROME, else Playwright's chrome-headless-shell cache. Each run uses
 * its own profile, so no saved preference cookie changes the layout.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES = [
  "/",
  "/library",
  "/ebooks",
  "/authors",
  "/publishers",
  "/recommenders",
  "/series",
  "/places",
  "/provenance",
  "/locations",
  "/collections",
  "/taxonomy",
  "/harmonize",
  "/settings",
  // Detail pages, for the layout audit's titles, cards and commands
  "/library/*",
  "/publishers/*",
  "/films/*",
];
const WIDTHS = [375, 390];
/** The list pages: their first card should be on the first screen */
const LISTS = new Set(
  ROUTES.filter((r) => !r.endsWith("/*") && !["/", "/harmonize", "/settings", "/taxonomy"].includes(r)),
);

const args = process.argv.slice(2);
const strict = args.includes("--strict");
if (strict) args.splice(args.indexOf("--strict"), 1);
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args.splice(baseAt, 2)[1] : "http://127.0.0.1:3410";
const routes = args.length ? args : ROUTES;
const here = dirname(fileURLToPath(import.meta.url));
const audit = readFileSync(join(here, "overflow-audit.js"), "utf8");
const layoutAudit = readFileSync(join(here, "layout-audit.js"), "utf8");
/** "kind route element" -> the ticket that owns it */
const known = JSON.parse(readFileSync(join(here, "layout-audit-known.json"), "utf8"));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const dir of existsSync(cache)
    ? readdirSync(cache).sort().reverse()
    : []) {
    if (!dir.startsWith("chromium_headless_shell-")) continue;
    for (const build of [
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell-mac-x64",
      "chrome-headless-shell-linux64",
    ]) {
      const bin = join(cache, dir, build, "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("No headless Chrome found: set CHROME to its path");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9200 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), "phone-audit-"));
const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
const chromeExited = new Promise((resolve) => chrome.once("exit", resolve));
process.on("exit", () => {
  chrome.kill();
  // After a crash Chrome may still be writing its profile: retry a file it wrote last
  rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
});

let socketUrl;
for (let i = 0; i < 50 && !socketUrl; i++) {
  try {
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    socketUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  if (!socketUrl) await sleep(200);
}
const ws = new WebSocket(socketUrl);
await new Promise((resolve) =>
  ws.addEventListener("open", resolve, { once: true }),
);
let nextId = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    waiters.filter((w) => w.method === msg.method).forEach((w) => w.resolve());
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (
    await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
  ).result.value;

await send("Page.enable");
await send("Network.enable");

async function load(url) {
  const loaded = new Promise((resolve) =>
    waiters.push({ method: "Page.loadEventFired", resolve }),
  );
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(60000)]);
}

// A route ending in /* is the first record its list page links to
const resolved = new Map();
for (const route of routes) {
  if (!route.endsWith("/*")) continue;
  const list = route.slice(0, -2);
  await load(base + list);
  let href = null;
  // Streamed lists fill in after the load event
  for (let i = 0; i < 50 && !href; i++, await sleep(200))
    href = await evaluate(
      `[...document.querySelectorAll('main a[href^="${list}/"]')].map((a) => a.getAttribute("href").split(/[?#]/)[0]).find((h) => h.split("/").length === ${list.split("/").length + 1} && !/\\/(new|import|identify|review)$/.test(h)) ?? null`,
    );
  resolved.set(route, href);
}

let failed = 0;
let layoutNew = 0;
let layoutKnown = 0;
const knownSeen = new Set();
for (const width of WIDTHS) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  });
  // A phone's coarse pointer: controls grow to 44px, as on the phone itself
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  for (const route of routes) {
    const path = route.endsWith("/*") ? resolved.get(route) : route;
    if (!path) {
      console.log(`skip ${width}px ${route}: its list links to no record`);
      continue;
    }
    const timed = width === 390 && route.split("?")[0] === "/ebooks";
    await send("Emulation.setCPUThrottlingRate", { rate: timed ? 4 : 1 });
    await send("Network.emulateNetworkConditions", {
      offline: false,
      latency: timed ? 150 : 0,
      downloadThroughput: timed ? (9 * 1000000) / 8 : -1,
      uploadThroughput: timed ? (1.6 * 1000000) / 8 : -1,
    });
    await send("Network.setCacheDisabled", { cacheDisabled: timed });
    if (timed) await send("Network.clearBrowserCache");
    await load(base + path);
    // Wait for streamed content and fonts, then for transitions to end
    for (
      let i = 0;
      i < 100 &&
      !(await evaluate(`!document.querySelector('div[hidden][id^="S:"]')`));
      i++
    )
      await sleep(200);
    await evaluate("document.fonts.ready.then(() => true)");
    await sleep(500);
    const result = await evaluate(audit);
    const fcp = timed
      ? await evaluate(
          "performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null",
        )
      : null;
    const pass =
      result.overflow <= 0 &&
      result.offenders.length === 0 &&
      (!timed || (fcp !== null && fcp <= 1500));
    if (!pass) failed++;
    console.log(
      `${pass ? "ok  " : "FAIL"} ${width}px ${route}: overflow ${result.overflow}px`,
    );
    if (timed)
      console.log(
        `       Cold FCP ${fcp === null ? "missing" : Math.round(fcp) + "ms"} / 1500ms · 4× CPU, 9Mbps down, 150ms RTT`,
      );
    for (const o of result.offenders)
      console.log(
        `       ${o.element} (right ${o.right}px${o.fixed ? ", fixed" : ""})`,
      );
    const layout = await evaluate(layoutAudit);
    const findings = [
      ...layout.squeezed.map((f) => ["squeezed", "title", `"${f.title}": ${f.why}`]),
      ...layout.plainCommands.map((f) => ["plain", f.element, `"${f.text}" looks like its text (${f.ratio}:1, no box, underline or icon)`]),
      ...layout.drift.map((f) => ["drift", f.element, `"${f.text}" starts ${f.off}px off its column's edge in ${f.card}`]),
      ...(layout.firstContent?.late && LISTS.has(route)
        ? [["first", "card", `first card at ${layout.firstContent.top}px of a ${layout.firstContent.screen}px screen`]]
        : []),
    ];
    // One line per kind of element: a list of 50 credits is one finding
    const grouped = new Map();
    for (const [kind, element, detail] of findings) {
      const key = `${kind} ${route} ${element}`;
      const group = grouped.get(key) ?? { kind, element, detail, count: 0 };
      group.count++;
      grouped.set(key, group);
    }
    for (const [key, { kind, element, detail, count }] of grouped) {
      const ticket = known[key];
      if (ticket) knownSeen.add(key);
      if (ticket) layoutKnown++;
      else layoutNew++;
      console.log(
        `       layout ${ticket ? `known (${ticket})` : "NEW"}: ${kind} ${element} ${detail}${count > 1 ? ` (and ${count - 1} more like it)` : ""}`,
      );
    }
  }
}
ws.close();
console.log(
  failed
    ? `${failed} page(s) wider than the screen`
    : "No page scrolls sideways",
);
// A known finding that no longer shows on a route that ran: fixed, so its line can go
for (const key of Object.keys(known))
  if (routes.includes(key.split(" ")[1]) && !knownSeen.has(key))
    console.log(`Layout: no longer found, remove it from layout-audit-known.json: ${key}`);
console.log(
  `Layout: ${layoutNew} new and ${layoutKnown} known finding(s)${layoutNew && !strict ? " (pass --strict to fail on new ones)" : ""}`,
);
if (strict && layoutNew) failed++;
// Chrome writes its profile until it has exited: wait for that, so removing the profile never races it
chrome.kill();
await chromeExited;
process.exit(failed ? 1 : 0);
