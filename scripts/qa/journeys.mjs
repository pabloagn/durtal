/**
 * Collection journeys: drives a headless Chrome through each open collection
 * (perfumes, films, paintings) the way a reader would, against a running
 * server, and fails on the first step that does not hold:
 *
 *   create (the add form) → reload → favourite → edit the title → reload →
 *   find it by search and by the favourites filter → export it → delete it →
 *   its page shows the not-found view and the export leaves it out.
 *
 *   node scripts/qa/journeys.mjs [baseUrl] [collection ...]
 *
 * Run it against a disposable database only (scripts/qa/preview-local.py):
 * it writes and deletes records. Chrome comes from CHROME, else the
 * Playwright cache (chrome-headless-shell). No dependency: it speaks the
 * DevTools protocol over Node's own WebSocket.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [baseArg, ...only] = process.argv.slice(2);
const base = (baseArg ?? "http://127.0.0.1:3410").replace(/\/$/, "");
const COLLECTIONS = {
  perfumes: { form: "Add perfume", placeholder: "Shalimar", entity: "perfumes", missing: "Perfume not found" },
  films: { form: "Add film", placeholder: "The Thing", entity: "films", missing: "Film not found" },
  paintings: { form: "Add painting", placeholder: "The Garden of Earthly Delights", entity: "paintings", missing: "Painting not found" },
};
const chosen = only.length ? only : Object.keys(COLLECTIONS);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright");
  if (!existsSync(cache)) throw new Error("Set CHROME to a Chrome or chrome-headless-shell binary");
  for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort().reverse())
    for (const sub of readdirSync(join(cache, dir))) {
      const bin = join(cache, dir, sub, "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  throw new Error("No chrome-headless-shell in the Playwright cache: set CHROME");
}

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  findChrome(),
  [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "journeys-"))}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "Page script failed");
  return r.result?.result?.value;
}
async function waitFor(predicate, what, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(`(() => { try { return !!(${predicate}); } catch { return false; } })()`)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function go(path) {
  await send("Page.navigate", { url: base + path });
  await waitFor("document.readyState === 'complete' && !document.getElementById('S:0')", `${path} to load`);
  await sleep(500);
}
/** Clicks the visible element whose own text (or label) is `text`, inside `scope` */
async function click(text, scope = "document") {
  const ok = await evaluate(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const all = [...(${scope}).querySelectorAll('button, a, [role=menuitem], [role=option], div, span')];
    const el = all.find((e) => visible(e) && (e.getAttribute('aria-label') === ${JSON.stringify(text)} || (e.children.length === 0 || e.tagName === 'BUTTON') && e.textContent.trim() === ${JSON.stringify(text)}));
    if (!el) return false;
    (el.closest('button, a, [role=menuitem]') ?? el).click();
    return true;
  })()`);
  if (!ok) throw new Error(`No "${text}" to click`);
  await sleep(400);
}
async function type(selector, text) {
  await evaluate(`(() => { const el = ${selector}; el.focus(); el.select?.(); return true; })()`);
  await send("Input.insertText", { text });
  await sleep(200);
}
/** The whole collection as CSV, through the export the Settings › Data page uses; "" for an empty collection (404) */
const exportCsv = (entity) =>
  evaluate(`fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity: ${JSON.stringify(entity)}, all: true, format: 'csv' }) })
    .then((r) => { if (r.status === 404) return ''; if (!r.ok) throw new Error('The export answered ' + r.status); return r.text(); })`);
const DIALOG = "([...document.querySelectorAll('[role=dialog], dialog')].pop())";
const pageText = () => evaluate("document.querySelector('main')?.innerText ?? ''");

async function journey(name) {
  const c = COLLECTIONS[name];
  const stamp = Date.now().toString(36);
  const title = `Journey ${name} ${stamp}`;
  const renamed = `${title} renamed`;
  const steps = [];
  const step = async (label, fn) => {
    await fn();
    steps.push(label);
  };
  try {
    await step("create", async () => {
      await go(`/${name}/new`);
      await type(`document.querySelector('input[placeholder=${JSON.stringify(c.placeholder)}]')`, title);
      await click(c.form, "document.querySelector('main')");
      await waitFor(`location.pathname !== '/${name}/new' && location.pathname.startsWith('/${name}/')`, "the new record's page");
    });
    const path = await evaluate("location.pathname");
    await step("reload", async () => {
      await go(path);
      if (!(await pageText()).includes(title)) throw new Error("The page does not show the title");
    });
    await step("favourite", async () => {
      await click("Add to favourites");
      await waitFor("document.querySelector('[aria-label=\"Remove from favourites\"]')", "the favourite to save");
      await go(path);
      await waitFor("document.querySelector('[aria-label=\"Remove from favourites\"]')", "the favourite after a reload");
    });
    await step("edit", async () => {
      await click("Actions", "document.querySelector('main')");
      await click("Edit");
      await waitFor(`${DIALOG}?.querySelector('input[placeholder=${JSON.stringify(c.placeholder)}]')`, "the edit form");
      await type(`${DIALOG}.querySelector('input[placeholder=${JSON.stringify(c.placeholder)}]')`, renamed);
      await click("Save", DIALOG);
      await waitFor(`!${DIALOG} || !${DIALOG}.open && !document.querySelector('[role=dialog]')`, "the edit form to close", 20000).catch(() => {});
      await go(path);
      if (!(await pageText()).includes(renamed)) throw new Error("The new title did not save");
    });
    await step("search", async () => {
      await go(`/${name}?q=${encodeURIComponent(renamed)}`);
      await waitFor(`document.querySelector('main').innerText.includes(${JSON.stringify(renamed)})`, "the record in the search");
    });
    await step("favourites filter", async () => {
      await go(`/${name}?favourite=1`);
      await waitFor(`document.querySelector('main').innerText.includes(${JSON.stringify(renamed)})`, "the record in favourites");
    });
    await step("export", async () => {
      const csv = await exportCsv(c.entity);
      if (!csv.includes(renamed)) throw new Error("The export does not hold the record");
    });
    await step("delete", async () => {
      await go(path);
      await click("Actions", "document.querySelector('main')");
      await click("Delete");
      await waitFor(DIALOG, "the delete dialog");
      await click("Delete", DIALOG);
      await waitFor(`location.pathname === '/${name}'`, "the collection home after the delete");
      // A loading boundary streams the page, so a missing record answers 200 with its not-found view
      await go(path);
      await waitFor(`document.querySelector('main').innerText.includes(${JSON.stringify(c.missing)})`, `"${c.missing}"`);
      const csv = await exportCsv(c.entity);
      if (csv.includes(renamed)) throw new Error("The export still holds the deleted record");
    });
    console.log(`ok    ${name}: ${steps.join(" → ")}`);
    return true;
  } catch (error) {
    console.log(`FAIL  ${name}: ${steps.join(" → ")}${steps.length ? " → " : ""}✗ ${error.message}`);
    return false;
  }
}

let failed = 0;
for (const name of chosen) {
  if (!COLLECTIONS[name]) {
    console.log(`FAIL  ${name}: not a collection (${Object.keys(COLLECTIONS).join(", ")})`);
    failed++;
    continue;
  }
  if (!(await journey(name))) failed++;
}
ws.close();
chrome.kill();
console.log(failed ? `\n${failed} of ${chosen.length} journeys failed` : `\nAll ${chosen.length} journeys passed`);
process.exit(failed ? 1 : 0);
