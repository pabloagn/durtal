#!/usr/bin/env node
/**
 * Reader memory check (SLN-1291, SLN-1292): reads a book for 300 page turns
 * and measures at 20 turns and at the end, in headless Chrome over the raw
 * DevTools protocol. Each measure forces three garbage collections, then
 * reads the documents alive (Memory.getDOMCounters), the JS heap
 * (Runtime.getHeapUsage) and, for an EPUB, the chapters loaded. Exits 1 when
 * a book's documents grew by more than 2 between the two measures (a chapter
 * preloaded ahead, and the one kept behind for a spread or a back turn), or an
 * EPUB keeps more than 3 chapters loaded paginated or 4 scrolled. A book shorter than the
 * turns is read back and forth.
 *
 * Then, on the many-chapter EPUB, a highlight made in the chapter being read
 * must be drawn again after the reader has unloaded that chapter and a back
 * turn has loaded it again.
 *
 *   node scripts/qa/reader-memory.mjs [--base http://127.0.0.1:3410] [--turns 300] [--books 2,16,17]
 *
 * Books: the 4-page text PDF (2), the 300 MB scanned PDF (16) and the
 * 100-chapter EPUB (17), paginated and scrolled. Needs a production preview
 * with the large fixtures:
 *   node scripts/qa/make-ebook-fixtures.mjs --large DIR
 *   pnpm build
 *   python3.12 scripts/qa/preview-local.py --start --s3-dir S3 --seed-reader --reader-large DIR
 * It changes only seeded fixtures on the preview's own database: it clears
 * their places and flow before and after, and leaves the highlight it makes. It refuses any host but this computer, and port 3100 (the live
 * app). Chrome comes from $CHROME, else Playwright's chrome-headless-shell.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const base = option("--base", "http://127.0.0.1:3410").replace(/\/$/, "");
const turns = Number(option("--turns", 300));
const only = option("--books", null)?.split(",").map(Number);
const EARLY = 20;

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
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), "Library/Caches/ms-playwright"), join(homedir(), ".cache/ms-playwright")];
  for (const cache of caches.filter(Boolean)) {
    for (const dir of existsSync(cache) ? readdirSync(cache).sort().reverse() : []) {
      if (!dir.startsWith("chromium_headless_shell-")) continue;
      for (const build of ["chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64", "chrome-headless-shell-linux64"]) {
        const bin = join(cache, dir, build, "chrome-headless-shell");
        if (existsSync(bin)) return bin;
      }
    }
  }
  throw new Error("No headless Chrome found: set CHROME to its path");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9200 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), "reader-memory-"));
// Chrome refuses to run as root with its sandbox (a container)
const sandbox = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...sandbox, "about:blank"], { stdio: "ignore" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
process.on("exit", () => {
  chrome.kill();
  // Chrome can still be writing its profile as it goes
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
});

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
  } else if (msg.method) for (const listener of listeners) listener(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

// Each relocate reaches the script through a binding
const PROBE = `addEventListener("relocate", (event) => window.__durtalTurn?.(JSON.stringify({ index: event.detail?.index ?? null, fraction: event.detail?.fraction ?? null })), true);`;

const ebook = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
async function newPage() {
  const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const page = {
    call,
    turns: [],
    async evaluate(expression) {
      const { result, exceptionDetails } = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    close: () => send("Target.disposeBrowserContext", { browserContextId }).catch(() => {}),
  };
  const listener = (msg) => msg.sessionId === sessionId && msg.method === "Runtime.bindingCalled" && msg.params.name === "__durtalTurn" && page.turns.push(JSON.parse(msg.params.payload));
  listeners.add(listener);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Runtime.addBinding", { name: "__durtalTurn" });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return page;
}

async function waitFor(test, timeout, what) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await test();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function key(page, code) {
  const virtual = { ArrowRight: 39, ArrowLeft: 37, Escape: 27 }[code];
  await page.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: code, code, windowsVirtualKeyCode: virtual });
  await page.call("Input.dispatchKeyEvent", { type: "keyUp", key: code, code, windowsVirtualKeyCode: virtual });
}

/** One turn; false when the book ends that way */
async function turn(page, code) {
  const seen = page.turns.length;
  await key(page, code);
  try {
    await waitFor(() => page.turns.length > seen, 4000, "the turn");
  } catch {
    return false;
  }
  await sleep(80);
  return true;
}

const LOADED = `document.querySelector("foliate-view")?.renderer?.getContents?.().map((c) => c.index) ?? null`;
async function measure(page) {
  for (let i = 0; i < 3; i++) await page.call("HeapProfiler.collectGarbage");
  const { documents, nodes } = await page.call("Memory.getDOMCounters");
  const { usedSize } = await page.call("Runtime.getHeapUsage");
  const loaded = await page.evaluate(LOADED);
  return { documents, nodes, heapMB: usedSize / 1024 / 1024, chapters: loaded?.length ?? null };
}

// The preview's own guarded database bridge, as reader-engine-check uses it
let bridge;
async function sql(query, params) {
  bridge ??= (async () => {
    const state = JSON.parse(readFileSync(join(tmpdir(), `durtal-preview-${target.port || 80}.json`), "utf8"));
    if (!state.s3Dir || typeof state.databaseUrl !== "string") throw new Error("Needs the seeded disposable preview state");
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = state.databaseUrl;
    try { await import(new URL("./neon-local-bridge.mjs", import.meta.url).href); }
    finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  })();
  await bridge;
  const response = await fetch("http://127.0.0.1/sql", { method: "POST", body: JSON.stringify({ query, params }) });
  if (!response.ok) throw new Error(`Preview database change failed: ${response.status}`);
}
// Only seeded fixtures: their places, and their flow on every device
const FIXTURE = `select e.id from ebooks e where e.id = $1::uuid and e.authors = ARRAY['Durtal Fixtures']::text[]`;
const resetPlace = (n) => sql(`with fixture as (${FIXTURE}) delete from ebook_positions p using fixture f where p.ebook_id = f.id`, [ebook(n)]);
const setFlow = (n, flow) => sql(`with fixture as (${FIXTURE}), cleared as (
    delete from reader_preferences p using fixture f where p.ebook_id = f.id returning p.id
  ) insert into reader_preferences (device_class, ebook_id, presentation)
    select d, f.id, jsonb_build_object('flow', $2::text) from fixture f, unnest(ARRAY['phone', 'tablet', 'desktop']) d
    where $2::text is not null`, [ebook(n), flow]);

async function open(page, n) {
  page.turns.length = 0;
  await page.call("Page.navigate", { url: `${base}/reader/${ebook(n)}` });
  await waitFor(() => page.turns.length > 0, 120_000, `the first page of ${ebook(n)}`);
  await waitFor(() => page.evaluate(`!!document.querySelector('[data-reader="ready"]')`), 30_000, "the reader");
  await sleep(1500);
}

/** Reads `turns` pages, back and forth when the book is shorter; measures at EARLY and at the end */
async function read(page) {
  let code = "ArrowRight", stuck = 0;
  const measures = [];
  const EDGE = `(() => { const r = document.querySelector("foliate-view")?.renderer; return { ArrowLeft: !!r?.atStart, ArrowRight: !!r?.atEnd }; })()`;
  for (let done = 0; done < turns;) {
    // At an end of the book, back the other way without waiting out a turn
    if ((await page.evaluate(EDGE))[code]) code = code === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
    if (await turn(page, code)) {
      done++; stuck = 0;
      if (done === EARLY || done === turns) measures.push(await measure(page));
    } else if (await page.evaluate(`!!document.querySelector("dialog[open]")`)) {
      // "Finished this book?" at the end of a tracked book: not now
      await key(page, "Escape");
      await sleep(300);
    } else {
      if (++stuck > 1) throw new Error(`the reader stopped turning after ${done} turns`);
      code = code === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
    }
  }
  return measures;
}

const results = [];
const BOOKS = [
  { n: 2, label: "4-page text PDF" },
  { n: 16, label: "300 MB scanned PDF" },
  { n: 17, label: "100-chapter EPUB, paginated", flow: "paginated", chapters: 3, highlight: true },
  { n: 17, label: "100-chapter EPUB, scrolled", flow: "scrolled", chapters: 4 },
];
for (const book of BOOKS.filter((b) => !only || only.includes(b.n))) {
  await resetPlace(book.n);
  if (book.flow) await setFlow(book.n, book.flow);
  const page = await newPage();
  try {
    await open(page, book.n);
    const [early, late] = await read(page);
    const problems = [];
    if (late.documents > early.documents + 2) problems.push(`documents grew from ${early.documents} to ${late.documents}`);
    if (book.chapters && late.chapters > book.chapters) problems.push(`${late.chapters} chapters loaded, over ${book.chapters}`);
    if (book.highlight) {
      const drawn = await highlightAfterBackTurn(page);
      if (!drawn.ok) problems.push(drawn.why);
    }
    results.push({ book, early, late, problems });
    const row = (m) => `${m.documents} documents, ${m.nodes} nodes, ${m.heapMB.toFixed(1)} MB${m.chapters === null ? "" : `, ${m.chapters} chapters`}`;
    console.log(`${problems.length ? "over" : "ok  "}  ${book.label}: at ${EARLY} turns ${row(early)}; at ${turns} ${row(late)}${problems.length ? ` (${problems.join("; ")})` : ""}`);
  } finally {
    await page.close();
    if (book.flow) await setFlow(book.n, null);
    await resetPlace(book.n);
  }
}

/**
 * Highlights the first line of the chapter on screen, reads on until that
 * chapter is unloaded, then turns back into it: its highlight is drawn again.
 */
async function highlightAfterBackTurn(page) {
  // Back to the start of a chapter, where its first paragraph is on screen
  const line = await page.evaluate(`(() => {
    const view = document.querySelector("foliate-view");
    const content = view.renderer.getContents().find((c) => c.index === view.lastLocation.index);
    const frame = content.doc.defaultView.frameElement.getBoundingClientRect();
    const p = [...content.doc.querySelectorAll("p")].find((p) => {
      const r = p.getClientRects()[0];
      return r && frame.left + r.left > 0 && frame.left + r.right < innerWidth && frame.top + r.top > 80 && frame.top + r.bottom < innerHeight - 120;
    });
    if (!p) return null;
    const r = p.getClientRects()[0];
    return { index: content.index, x0: frame.left + r.left + 4, x1: frame.left + r.right - 4, y: frame.top + (r.top + r.bottom) / 2 };
  })()`);
  if (!line) return { ok: false, why: "no line on screen to highlight" };
  const mouse = (type, x, y, buttons = 1) => page.call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
  await mouse("mouseMoved", line.x0, line.y, 0);
  await mouse("mousePressed", line.x0, line.y);
  for (let i = 1; i <= 8; i++) await mouse("mouseMoved", line.x0 + ((line.x1 - line.x0) * i) / 8, line.y);
  await mouse("mouseReleased", line.x1, line.y);
  const button = `[...document.querySelectorAll('[role="toolbar"][aria-label="Selection actions"] button')].find((b) => b.getAttribute("aria-label")?.startsWith("Highlight in"))`;
  try {
    await waitFor(() => page.evaluate(`!!${button}`), 5000, "the selection toolbar");
  } catch {
    return { ok: false, why: "the selection toolbar did not open" };
  }
  await page.evaluate(`${button}.click()`);
  const drawnIn = (index) => page.evaluate(`(() => {
    const content = document.querySelector("foliate-view").renderer.getContents().find((c) => c.index === ${index});
    return !!content?.overlayer?.element?.querySelector("g");
  })()`);
  try {
    await waitFor(() => drawnIn(line.index), 10_000, "the new highlight");
  } catch {
    return { ok: false, why: "the new highlight was not drawn" };
  }
  // Read on until the chapter is unloaded
  let ahead = 0;
  while ((await page.evaluate(LOADED)).includes(line.index)) {
    if (!(await turn(page, "ArrowRight")) || ++ahead > 200) return { ok: false, why: "the highlighted chapter was never unloaded" };
  }
  // Then back into it
  for (let back = 0; !(await page.evaluate(`document.querySelector("foliate-view").lastLocation.index === ${line.index}`)); back++) {
    if (!(await turn(page, "ArrowLeft")) || back > ahead + 5) return { ok: false, why: "the back turns never reached the highlighted chapter" };
  }
  try {
    await waitFor(() => drawnIn(line.index), 10_000, "the highlight after the back turn");
  } catch {
    return { ok: false, why: "the highlight was not drawn after a back turn into its unloaded chapter" };
  }
  return { ok: true };
}

ws.close();
process.exit(results.some((r) => r.problems.length) ? 1 : 0);
