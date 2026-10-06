#!/usr/bin/env node
/**
 * Phone audit: loads each route in headless Chrome at phone widths and runs
 * scripts/qa/overflow-audit.js on it. Exits 1 when a page scrolls sideways or
 * an element reaches past the right edge of the screen.
 *
 *   node scripts/qa/phone-audit.mjs [--base http://127.0.0.1:3410] [route...]
 *
 * Point it at a running app, such as scripts/qa/preview-local.py. Chrome comes
 * from $CHROME, else Playwright's chrome-headless-shell cache. Each run uses
 * its own profile, so no saved preference cookie changes the layout.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES = [
  "/", "/library", "/authors", "/publishers", "/recommenders", "/series",
  "/places", "/provenance", "/locations", "/collections", "/taxonomy",
  "/harmonize", "/settings",
];
const WIDTHS = [375, 390];

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args.splice(baseAt, 2)[1] : "http://127.0.0.1:3410";
const routes = args.length ? args : ROUTES;
const audit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "overflow-audit.js"), "utf8");

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const dir of existsSync(cache) ? readdirSync(cache).sort().reverse() : []) {
    if (!dir.startsWith("chromium_headless_shell-")) continue;
    for (const build of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64"]) {
      const bin = join(cache, dir, build, "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("No headless Chrome found: set CHROME to its path");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9200 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), "phone-audit-"));
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
});

let socketUrl;
for (let i = 0; i < 50 && !socketUrl; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socketUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  if (!socketUrl) await sleep(200);
}
const ws = new WebSocket(socketUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
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
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Page.enable");
let failed = 0;
for (const width of WIDTHS) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 812, deviceScaleFactor: 2, mobile: true });
  for (const route of routes) {
    const loaded = new Promise((resolve) => waiters.push({ method: "Page.loadEventFired", resolve }));
    await send("Page.navigate", { url: base + route });
    await Promise.race([loaded, sleep(60000)]);
    // Wait for streamed content and fonts, then for transitions to end
    for (let i = 0; i < 100 && !(await evaluate(`!document.querySelector('div[hidden][id^="S:"]')`)); i++) await sleep(200);
    await evaluate("document.fonts.ready.then(() => true)");
    await sleep(500);
    const result = await evaluate(audit);
    const pass = result.overflow <= 0 && result.offenders.length === 0;
    if (!pass) failed++;
    console.log(`${pass ? "ok  " : "FAIL"} ${width}px ${route}: overflow ${result.overflow}px`);
    for (const o of result.offenders) console.log(`       ${o.element} (right ${o.right}px${o.fixed ? ", fixed" : ""})`);
  }
}
ws.close();
console.log(failed ? `${failed} page(s) wider than the screen` : "No page scrolls sideways");
process.exit(failed ? 1 : 0);
