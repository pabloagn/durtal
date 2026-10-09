#!/usr/bin/env node
/**
 * Reader performance check (eBooks sub-issue 3, the epic's performance
 * targets): opens, reopens, page turns, interaction latency, memory and an
 * idle page, measured in headless Chrome over the raw DevTools protocol, with
 * the budgets in scripts/qa/reader-perf.json. Exits 1 when a row is over.
 *
 *   node scripts/qa/reader-perf.mjs [--base http://127.0.0.1:3410] [--runs N]
 *        [--rows open-5mb,turns,...] [--profiles desktop,phone] [--json FILE] [--trace]
 *
 * Each row runs under the network and CPU profiles it names
 * (Network.emulateNetworkConditions, Emulation.setCPUThrottlingRate); the
 * phone also gets a 390 px touch screen. A book "not seen before" opens in a
 * fresh browser context (no cache, no device cookie); a reopen is the second
 * open in the same one. Times run from the navigation (the click on Read) to
 * the first text painted: the engine's first relocate plus two animation
 * frames, heard through a probe the protocol adds to every frame. Bytes are
 * what the network carried until then. Page turns are → presses measured by
 * Event Timing (input to the next paint; entries under 16 ms are not
 * reported and count as 16); a turn into the next section lasts until that
 * section is painted. Long Animation Frames with a blocking duration give
 * the long tasks (a task over 50 ms); the heap is Performance.getMetrics
 * after a forced garbage collection. Each open figure is the 75th
 * percentile of the runs.
 *
 * Needs a production preview with the large fixtures:
 *   node scripts/qa/make-ebook-fixtures.mjs --large DIR
 *   pnpm build
 *   python3.12 scripts/qa/preview-local.py --start --s3-dir S3 --seed-reader --reader-large DIR
 * It refuses any host but this computer, and port 3100 (the live app). Chrome
 * comes from $CHROME, else Playwright's chrome-headless-shell cache.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { checkNavigation, goto, readerPlace, waitUI } from "./reader-navigation-checks.mjs";

const config = JSON.parse(readFileSync(new URL("./reader-perf.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const base = option("--base", "http://127.0.0.1:3410").replace(/\/$/, "");
const runs = Number(option("--runs", config.runs));
const onlyRows = option("--rows", null)?.split(",");
const onlyProfiles = option("--profiles", null)?.split(",");
const jsonOut = option("--json", null);
const trace = args.includes("--trace");

const target = URL.parse(base);
const refusal = !target
  ? `${base} is not a URL`
  : !["127.0.0.1", "localhost"].includes(target.hostname)
    ? `${target.hostname} is not this computer`
    : target.port === "3100"
      ? "port 3100 is the live app"
      : null;
if (refusal) {
  console.error(`Refused: ${refusal}`);
  process.exit(2);
}

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
const profile = mkdtempSync(join(tmpdir(), "reader-perf-"));
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const chromeExited = new Promise((resolve) => chrome.once("exit", resolve));
process.on("exit", () => {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

// ── The DevTools protocol, one browser socket with a session per page ───────

let socketUrl;
for (let i = 0; i < 50 && !socketUrl; i++) {
  try {
    socketUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
  if (!socketUrl) await sleep(200);
}
const ws = new WebSocket(socketUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    for (const listener of listeners) listener(msg);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

/**
 * What the probe does in every frame: reports the first text paint (the
 * engine's first relocate plus two frames), each later relocate and its
 * paint (two frames after it) through the __durtalPerf binding, and while `watch` is on counts animation frames
 * and timers that fire. Event Timing and Long Animation Frames are kept for
 * the script to read.
 */
const PROBE = `(() => {
  const top = window.top === window;
  const raf = window.requestAnimationFrame.bind(window);
  const state = top ? (window.__durtalPerfState = { watch: false, frames: 0, timers: [], events: [], loafs: [], tasks: [] }) : null;
  const shared = () => { try { return window.top.__durtalPerfState; } catch { return null; } };
  window.requestAnimationFrame = (cb) => raf((t) => { const s = shared(); if (s?.watch) s.frames++; cb(t); });
  for (const name of ["setTimeout", "setInterval"]) {
    const original = window[name].bind(window);
    window[name] = (cb, ms, ...rest) =>
      original(typeof cb === "function" ? (...a) => { const s = shared(); if (s?.watch) s.timers.push(name + " " + (ms ?? 0)); return cb(...a); } : cb, ms, ...rest);
  }
  if (!top) return;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.interactionId) state.events.push({ name: e.name, start: e.startTime, duration: e.duration });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.loafs.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration ?? 0 });
    }).observe({ type: "long-animation-frame", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.tasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  let first = true;
  addEventListener("relocate", (event) => {
    const index = event.detail?.index ?? event.detail?.section?.current ?? null;
    const report = (kind) => window.__durtalPerf?.(JSON.stringify({ kind, at: performance.now(), index, fraction: event.detail?.fraction ?? null }));
    if (first) { first = false; raf(() => raf(() => report("first"))); }
    else { report("relocate"); raf(() => raf(() => report("painted"))); }
  }, true);
})();`;

const ebook = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

/** A page in a fresh browser context, under a profile */
async function newPage(profileName) {
  const p = config.profiles[profileName];
  const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const page = {
    call,
    sessionId,
    reports: [],
    requests: new Map(),
    on(method, fn) {
      const listener = (msg) => msg.sessionId === sessionId && msg.method === method && fn(msg.params);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async evaluate(expression) {
      const { result, exceptionDetails } = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    async close() {
      for (const off of page.offs) off();
      await send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    },
    offs: [],
  };
  page.offs.push(
    page.on("Runtime.bindingCalled", ({ name, payload }) => name === "__durtalPerf" && page.reports.push(JSON.parse(payload))),
    page.on("Network.requestWillBeSent", ({ requestId, request, timestamp, type }) =>
      page.requests.set(requestId, {
        url: request.url,
        method: request.method,
        type,
        body: request.postData ?? null,
        range: request.headers.Range ?? request.headers.range ?? null,
        status: null,
        start: timestamp,
        chunks: [],
        finished: null,
        size: 0,
      }),
    ),
    page.on("Network.dataReceived", ({ requestId, timestamp, encodedDataLength }) =>
      page.requests.get(requestId)?.chunks.push([timestamp, encodedDataLength]),
    ),
    // A keepalive fetch (the position save) gets its response but no loadingFinished
    page.on("Network.responseReceived", ({ requestId, response }) => {
      const r = page.requests.get(requestId);
      if (r) r.status = response.status;
    }),
    page.on("Network.loadingFinished", ({ requestId, timestamp, encodedDataLength }) => {
      const r = page.requests.get(requestId);
      if (r) Object.assign(r, { finished: timestamp, size: encodedDataLength });
    }),
  );
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Performance.enable");
  await call("Runtime.addBinding", { name: "__durtalPerf" });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  await call("Network.emulateNetworkConditions", {
    offline: false,
    latency: p.rttMs,
    downloadThroughput: (p.downMbps * 1e6) / 8,
    uploadThroughput: (p.upMbps * 1e6) / 8,
  });
  await call("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  await call("Emulation.setDeviceMetricsOverride", { width: p.width, height: p.height, deviceScaleFactor: p.mobile ? 3 : 1, mobile: p.mobile });
  if (p.mobile) await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  return page;
}

async function waitFor(test, timeout, what) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = test();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Navigates to a book and waits for its first text; returns the time and the bytes carried until then */
async function openBook(page, n) {
  page.reports.length = 0;
  page.requests.clear();
  await page.call("Page.navigate", { url: `${base}/reader/${ebook(n)}` });
  const first = await waitFor(() => page.reports.find((r) => r.kind === "first"), 60_000, `the first text of ${ebook(n)}`);
  const doc = [...page.requests.values()].find((r) => r.type === "Document");
  const paintedAt = doc.start + first.at / 1000;
  let bytes = 0;
  for (const r of page.requests.values()) {
    if (r.finished !== null && r.finished <= paintedAt) bytes += r.size;
    else bytes += r.chunks.filter(([at]) => at <= paintedAt).reduce((sum, [, size]) => sum + size, 0);
  }
  if (trace) {
    // --trace: each request of this open, from the navigation, and the first text
    const ms = (at) => Math.round((at - doc.start) * 1000);
    for (const r of [...page.requests.values()].sort((a, b) => a.start - b.start)) {
      const got = r.finished !== null ? r.size : r.chunks.reduce((sum, [, size]) => sum + size, 0);
      console.log(`  ${String(ms(r.start)).padStart(6)} → ${r.finished === null ? "   ..." : String(ms(r.finished)).padStart(6)} ms ${String(Math.round(got / 1024)).padStart(7)} KB  ${r.method} ${r.url.replace(base, "").slice(0, 90)}${r.range ? ` ${r.range}` : ""}`);
    }
    console.log(`  first text at ${Math.round(first.at)} ms`);
  }
  return { ms: first.at, bytes };
}

const isSave = (r) => r.method === "POST" && r.url.endsWith("/position");
const p75 = (values) => percentile(values, 0.75);
function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}
const mb = (bytes) => bytes / 1024 / 1024;

async function heapMB(page) {
  await page.call("HeapProfiler.collectGarbage");
  const { metrics } = await page.call("Performance.getMetrics");
  return mb(metrics.find((m) => m.name === "JSHeapUsedSize").value);
}

async function key(page, k, code, modifiers = 0) {
  const virtual = { ArrowRight: 39, ArrowLeft: 37, KeyT: 84, KeyG: 71, Enter: 13, Home: 36, End: 35, BracketLeft: 219, BracketRight: 221, Escape: 27 }[code] ?? 0;
  await page.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, modifiers, windowsVirtualKeyCode: virtual });
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers, windowsVirtualKeyCode: virtual });
}
const driver = page => ({
  open: n => openBook(page, n), evaluate: expression => page.evaluate(expression),
  key: (k, code, modifiers) => key(page, k, code, modifiers),
  fill: text => page.call("Input.insertText", { text }),
  savedPage: async label => {
    const request = await waitFor(() => [...page.requests.values()].find(request => {
      if (!isSave(request) || !request.body) return false;
      try { return JSON.parse(request.body).locator?.pageLabel === label; } catch { return false; }
    }), 5000, "position with pageLabel");
    return !!request;
  },
});

// ── The rows ────────────────────────────────────────────────────────────────

const MEASURE = {
  async navigation(row, profileName) {
    const times = [], smooth = [], tasks = [], loafs = [], inputs = [];
    for (let run = 0; run < runs; run++) {
      const page = await newPage(profileName);
      try {
        const d = driver(page);
        await openBook(page, row.fixture);
        if (row.action === "index") {
          const first = page.reports.find(report => report.kind === "first").at;
          await waitUI(d, "document.querySelector('[data-reader-index]')?.getAttribute('data-reader-index') === 'ready'", 30000);
          times.push(await page.evaluate("performance.now()") - first);
          tasks.push(await page.evaluate(`window.__durtalPerfState.tasks.filter(task => task.start >= ${first} && task.duration > 50).length`));
          for (const fixture of row.additionalFixtures ?? []) {
            await openBook(page, fixture);
            const beginning = page.reports.find(report => report.kind === "first").at;
            await waitUI(d, "document.querySelector('[data-reader-index]')?.getAttribute('data-reader-index') === 'ready'", 30000);
            times.push(await page.evaluate("performance.now()") - beginning);
            tasks.push(await page.evaluate(`window.__durtalPerfState.tasks.filter(task => task.start >= ${beginning} && task.duration > 50).length`));
          }
          continue;
        }
        await waitUI(d, "document.querySelector('[data-reader-index]')?.getAttribute('data-reader-index') === 'ready'", 30000);
        let before = page.reports.length;
        let start = 0;
        const mark = async () => { before = page.reports.length; start = await page.evaluate("performance.now()"); };
        if (row.action === "goto") {
          d.beforeCommit = mark; await goto(d, "Page", "57");
        } else if (row.action === "history") {
          await goto(d, "Percent", "70"); await mark(); await key(page, "ArrowLeft", "ArrowLeft", 1);
        } else if (row.action === "contents") {
          await mark(); await key(page, "t", "KeyT");
          await waitUI(d, "!!document.querySelector('[role=tree] [role=treeitem]')");
          await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
          const state = await page.evaluate("({ now: performance.now(), events: window.__durtalPerfState.events })");
          times.push(state.now - start);
          inputs.push(Math.max(16, ...state.events.filter(event => event.start >= start && event.name === "keydown").map(event => event.duration)));
          continue;
        } else if (row.action === "toc") {
          if (row.preloaded) {
            await goto(d, "Percent", "0.95");
            await waitUI(d, "document.querySelector('foliate-view').renderer.getContents().some(section => section.index === 1)");
          }
          await key(page, "t", "KeyT");
          await waitUI(d, "!!document.querySelector('[role=tree]')");
          await page.evaluate(`(() => {
            const button = [...document.querySelectorAll('[role=treeitem] button')].find(button => button.textContent.trim() === ${JSON.stringify(row.preloaded ? "Chapter 2" : "Chapter 90")});
            if (!button) throw Error("Missing contents target");
            button.setAttribute("data-qa-toc-pick", ""); button.scrollIntoView({ block: "center" });
          })()`);
          await sleep(100);
          const rect = await page.evaluate("(() => { const r = document.querySelector('[data-qa-toc-pick]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
          await mark();
          await page.call("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
          await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
        } else if (row.action === "drag" || row.action === "release") {
          await key(page, "g", "KeyG"); await waitUI(d, "!!document.querySelector('dialog[open]')");
          await key(page, "Escape", "Escape"); await waitUI(d, "!document.querySelector('dialog[open]')");
          const rect = await page.evaluate("(() => { const r = document.querySelector('[role=slider]').getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, width: r.width }; })()");
          if (rect.width < 220) throw Error("Scrubber width under 220px");
          const origin = await page.evaluate(readerPlace);
          await page.evaluate(`(() => {
            const state = window.__durtalScrubQA = { intervals: [], start: performance.now(), stopped: false };
            let previous;
            const frame = now => { if (previous !== undefined) state.intervals.push(now - previous); previous = now; if (!state.stopped) requestAnimationFrame(frame); };
            requestAnimationFrame(frame);
          })()`);
          await page.call("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x + 1, y: rect.y, button: "left", clickCount: 1 });
          for (let tick = 0; tick <= 120; tick++) {
            await page.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + 1 + (rect.width - 2) * tick / 120, y: rect.y, buttons: 1 });
            await sleep(2000 / 120);
          }
          if ((await page.evaluate(readerPlace)).cfi !== origin.cfi) throw Error("Peek moved the book before release");
          const sampled = await page.evaluate(`(() => {
            const state = window.__durtalScrubQA; state.stopped = true; const end = performance.now();
            return { smooth: state.intervals.filter(ms => ms <= 16.7).length / Math.max(1, state.intervals.length) * 100,
              tasks: window.__durtalPerfState.tasks.filter(task => task.start >= state.start && task.start <= end && task.duration > 50).length,
              loafs: window.__durtalPerfState.loafs.filter(frame => frame.start >= state.start && frame.start <= end && frame.duration > 50).length };
          })()`);
          smooth.push(sampled.smooth); tasks.push(sampled.tasks); loafs.push(sampled.loafs);
          await mark();
          await page.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + rect.width - 1, y: rect.y, button: "left", clickCount: 1 });
        }
        const painted = await waitFor(() => page.reports.slice(before).find(report => report.kind === "painted"), 15000, row.label);
        times.push(painted.at - start);
      } finally { await page.close(); }
    }
    return { ms: p75(times), all: times.map(Math.round), inpP95: percentile(inputs, 0.95),
      smoothPercent: smooth.length ? Math.min(...smooth) : null, longTasks: Math.max(0, ...tasks), longFrames: Math.max(0, ...loafs) };
  },
  /** A book not seen before: a fresh context per run */
  async open(row, profileName) {
    const times = [];
    const bytes = [];
    for (let i = 0; i < runs; i++) {
      const page = await newPage(profileName);
      try {
        const r = await openBook(page, row.fixture);
        times.push(r.ms);
        bytes.push(r.bytes);
      } finally {
        await page.close();
      }
    }
    return { ms: p75(times), mb: mb(p75(bytes)), all: times.map(Math.round) };
  },

  /** The second open in one context: cached files and this device's place */
  async reopen(row, profileName) {
    const times = [];
    for (let i = 0; i < runs; i++) {
      const page = await newPage(profileName);
      try {
        await openBook(page, row.fixture);
        await waitFor(() => [...page.requests.values()].find((r) => isSave(r) && r.status), 15_000, "the first position save");
        await page.call("Page.navigate", { url: "about:blank" });
        await sleep(300);
        times.push((await openBook(page, row.fixture)).ms);
      } finally {
        await page.close();
      }
    }
    return { ms: p75(times), all: times.map(Math.round) };
  },

  /**
   * → pressed `turns` times through a long book: each turn inside a section
   * and across a boundary, the long frames during turns inside a section,
   * every interaction's latency, and the heap at a third and at the end
   */
  async turns(row, profileName) {
    const page = await newPage(profileName);
    try {
      await openBook(page, row.fixture);
      await sleep(1500);
      const inside = [];
      const across = [];
      const insideWindows = [];
      const heaps = [];
      let index = (await page.evaluate("document.querySelector('foliate-view').lastLocation?.index ?? null")) ?? 0;
      for (let i = 1; i <= row.turns; i++) {
        const before = page.reports.length;
        const eventsBefore = await page.evaluate("window.__durtalPerfState.events.length");
        const startedAt = await page.evaluate("performance.now()");
        await key(page, "ArrowRight", "ArrowRight");
        const moved = await waitFor(() => page.reports.slice(before).find((r) => r.kind === "relocate"), 10_000, `turn ${i}`).catch(() => null);
        await sleep(row.pauseMs);
        const [latency] = await page.evaluate(
          `window.__durtalPerfState.events.slice(${eventsBefore}).filter((e) => e.name === "keydown").map((e) => e.duration)`,
        );
        const ms = latency ?? 16;
        if (moved && moved.index !== index) {
          // The next section shows after the key's own frame: the turn lasts until it is painted
          const painted = page.reports.slice(before).find((r) => r.kind === "painted");
          across.push(Math.max(ms, painted ? painted.at - startedAt : ms));
        } else {
          inside.push(ms);
          insideWindows.push([startedAt, startedAt + row.pauseMs + 100]);
        }
        if (moved) index = moved.index;
        if (i === Math.round(row.turns / 3) || i === row.turns) heaps.push(await heapMB(page));
      }
      // A few other interactions: the contents opened and closed with t and Esc
      for (let i = 0; i < 5; i++) {
        await key(page, "t", "KeyT");
        await sleep(400);
        await key(page, "Escape", "Escape");
        await sleep(400);
      }
      const state = await page.evaluate("({ events: window.__durtalPerfState.events, loafs: window.__durtalPerfState.loafs })");
      // A long task is one that blocks input: a long frame with no task over 50 ms (the
      // headless compositor waiting) is not one
      const longInside = state.loafs.filter((l) => l.blocking > 0 && insideWindows.some(([a, b]) => l.start >= a && l.start <= b));
      const frames = await page.evaluate("document.querySelector('foliate-view').renderer.getContents().length");
      return {
        insideP95: percentile(inside, 0.95),
        acrossP95: percentile(across, 0.95),
        insideCount: inside.length,
        acrossCount: across.length,
        longTasksInside: longInside.length,
        longestInside: Math.round(Math.max(0, ...longInside.map((l) => l.duration))),
        inpP95: percentile(state.events.map((e) => e.duration), 0.95) ?? 16,
        heapMB: heaps.at(-1),
        heapGrowthMB: heaps.length > 1 ? heaps.at(-1) - heaps[0] : 0,
        sectionsLoaded: frames,
      };
    } finally {
      await page.close();
    }
  },

  /** A page left alone: frames, timers and requests over `seconds` */
  async idle(row, profileName) {
    const page = await newPage(profileName);
    try {
      if (row.runningLines) await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `try {
        localStorage.setItem("durtal-reader-running-lines", JSON.stringify({ v: 1, positions: { chapter: "headerLeft", page: "footerRight", location: "off", percent: "footerRight", timeLeftChapter: "footerLeft", timeLeftBook: "footerRight", clock: "headerRight" } }));
      } catch {}` });
      await openBook(page, row.fixture);
      await waitFor(() => [...page.requests.values()].find((r) => isSave(r) && r.status), 15_000, "the first position save");
      await waitUI(driver(page), "document.querySelector('[data-reader-index]')?.getAttribute('data-reader-index') === 'ready'", 30000);
      // The bars hide 3 s after the open
      await sleep(4000);
      const startedAt = Date.now() / 1000;
      const requests = [];
      const off = page.on("Network.requestWillBeSent", ({ request }) => requests.push(`${request.method} ${new URL(request.url).pathname}`));
      await page.evaluate("window.__durtalPerfState.watch = true");
      await sleep(row.seconds * 1000);
      off();
      const state = await page.evaluate(`(() => {
        const s = window.__durtalPerfState;
        s.watch = false;
        const frames = [...document.querySelectorAll("iframe")].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean);
        const running = [document, ...frames].reduce((n, d) => n + d.getAnimations().filter((a) => a.playState === "running").length, 0);
        return { frames: s.frames, timers: s.timers, running };
      })()`);
      const saves = requests.filter((r) => r.startsWith("POST ") && r.endsWith("/position")).length;
      const others = requests.filter((r) => !(r.startsWith("POST ") && r.endsWith("/position")));
      return { seconds: Math.round(Date.now() / 1000 - startedAt), ...state, saves, others };
    } finally {
      await page.close();
    }
  },
};

/** Each budget key against its measured value: [label, value, limit, ok] */
function judge(budget, m) {
  const checks = [];
  const at = (label, value, limit, unit, ok = value !== null && value <= limit) =>
    checks.push([label, value === null ? "none" : `${typeof value === "number" ? Math.round(value * 10) / 10 : value}${unit}`, `${limit}${unit}`, ok]);
  if ("ms" in budget) at("time", m.ms, budget.ms, " ms");
  if ("mb" in budget) at("bytes before first text", m.mb, budget.mb, " MB");
  if ("insideP95" in budget) at("turn inside a section p95", m.insideP95, budget.insideP95, " ms");
  if ("longTasksInside" in budget) at("long frames during those turns", m.longTasksInside, budget.longTasksInside, "");
  if ("acrossP95" in budget) at("turn across a section p95", m.acrossP95, budget.acrossP95, " ms");
  if ("inpP95" in budget) at("interaction to next paint p95", m.inpP95, budget.inpP95, " ms");
  if ("heapMB" in budget) at("JS heap after the turns", m.heapMB, budget.heapMB, " MB");
  if ("heapGrowthMB" in budget) at("heap growth from a third to the end", m.heapGrowthMB, budget.heapGrowthMB, " MB");
  if ("frames" in budget) at("animation frames", m.frames, budget.frames, "");
  if ("running" in budget) at("running animations", m.running, budget.running, "");
  if ("timers" in budget) at("timers fired", m.timers.length, budget.timers, "");
  if ("saves" in budget) at("position saves", m.saves, budget.saves, "");
  if ("otherRequests" in budget) at("other requests", m.others.length, budget.otherRequests, "");
  if ("smoothPercent" in budget) at("frames at 60fps", m.smoothPercent, budget.smoothPercent, "%", m.smoothPercent >= budget.smoothPercent);
  if ("longTasks" in budget) at("long tasks over 50ms", m.longTasks, budget.longTasks, "");
  if ("longFrames" in budget) at("animation frames over 50ms", m.longFrames, budget.longFrames, "");
  if ("minTimerMs" in budget) at("shortest idle timer", m.timers.length ? Math.min(...m.timers.map(timer => Number(timer.split(" ").at(-1)))) : Infinity, budget.minTimerMs, " ms", m.timers.every(timer => Number(timer.split(" ").at(-1)) >= budget.minTimerMs));
  return checks;
}

let failed = 0;
const report = [];
await sleep(300);
for (const profileName of Object.keys(config.profiles).filter(name => !onlyProfiles || onlyProfiles.includes(name))) {
  const page = await newPage(profileName);
  try { await checkNavigation(driver(page)); console.log("ok   navigation assertions (" + profileName + ")"); }
  catch (error) { failed++; console.log("FAIL navigation assertions (" + profileName + "): " + error.message); }
  finally { await page.close(); }
}
for (const row of config.rows) {
  if (onlyRows && !onlyRows.includes(row.id)) continue;
  for (const [profileName, budget] of Object.entries(row.budgets)) {
    if (onlyProfiles && !onlyProfiles.includes(profileName)) continue;
    let measured;
    try {
      measured = await MEASURE[row.kind](row, profileName);
    } catch (error) {
      failed++;
      console.log(`FAIL ${row.label} (${profileName}): ${error.message}`);
      report.push({ row: row.id, profile: profileName, error: error.message });
      continue;
    }
    const checks = judge(budget, measured);
    const ok = checks.every(([, , , pass]) => pass);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${row.label} (${profileName})`);
    for (const [label, value, limit, pass] of checks) console.log(`       ${pass ? " " : "x"} ${label}: ${value} (budget ${limit})`);
    if (measured.all) console.log(`         runs: ${measured.all.join(", ")} ms`);
    if (measured.timers?.length) console.log(`         timers: ${measured.timers.join(", ")}`);
    if (measured.others?.length) console.log(`         requests: ${measured.others.join(", ")}`);
    report.push({ row: row.id, profile: profileName, ok, measured });
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
ws.close();
console.log(failed ? `\n${failed} row(s) over budget` : "\nEvery row within budget");
chrome.kill();
await chromeExited;
process.exit(failed ? 1 : 0);
