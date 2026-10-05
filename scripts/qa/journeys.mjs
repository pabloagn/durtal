/**
 * Collection journeys: drives a headless Chrome through each open collection
 * (perfumes, films, paintings) the way a reader would, against a running
 * server, and fails on the first step that does not hold:
 *
 *   create (the add form) → reload → favourite → edit the title → reload →
 *   find it by search and by the favourites filter → export it → delete it →
 *   its page shows the not-found view and the export leaves it out.
 *
 *   node scripts/qa/journeys.mjs --disposable [baseUrl] [collection ...]
 *
 * The "reading" journey (SLN-447) drives the book page's reading tracker on the
 * book that scripts/qa/reading-journey.sql seeds: start mid-book, log, fix a
 * log and undo it, go back, pause, resume, switch edition, log a sitting in the
 * audiobook, finish with a rating and review, undo, finish again and see the
 * next volume, re-read, abandon, undo, resume, log past reads, delete and undo.
 * Then the reading hub (SLN-448): log from /reading, log "212" from the
 * command palette, filter the journal by year, and add a book that is not in
 * Durtal from the book picker's link, landing on its page with Start reading
 * open.
 *
 * The "import" journey (SLN-450) imports a Goodreads file written here into
 * the books scripts/qa/reading-import-journey.sql seeds: upload it, see the
 * summary and "Book rating 3 kept (the file says 4)", use the file's rating
 * and back, choose a book with the picker, add a missing book and see its row match, commit, check a book
 * page, the journal and the imported review in Edit, undo, commit again, and
 * upload the same file again to see nothing left to import. Run the preview
 * with --s3-dir and the list shows the raw file kept; without, "Raw file not
 * kept" (pass --no-s3).
 *
 * It writes and deletes records, so it runs against a disposable database
 * only (scripts/qa/preview-local.py): it refuses to start without
 * --disposable, on any host but this computer, and on port 3100 (the live
 * app). Chrome comes from CHROME, else the Playwright cache
 * (chrome-headless-shell). No dependency: it speaks the DevTools protocol over
 * Node's own WebSocket.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const disposable = argv.includes("--disposable");
const noS3 = argv.includes("--no-s3");
const [baseArg, ...only] = argv.filter((a) => a !== "--disposable" && a !== "--no-s3");
const base = (baseArg ?? "http://127.0.0.1:3410").replace(/\/$/, "");
const target = URL.parse(base);
const refusal = !target
  ? `${base} is not a URL`
  : !disposable
  ? "it writes and deletes records: pass --disposable to confirm the server runs on a disposable database (scripts/qa/preview-local.py)"
  : !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    ? `${target.hostname} is not this computer`
    : target.port === "3100"
      ? "port 3100 is the live app"
      : null;
if (refusal) {
  console.error(`Refused: ${refusal}`);
  process.exit(2);
}
const COLLECTIONS = {
  perfumes: { form: "Add perfume", placeholder: "Shalimar", entity: "perfumes", missing: "Perfume not found" },
  films: { form: "Add film", placeholder: "The Thing", entity: "films", missing: "Film not found" },
  paintings: { form: "Add painting", placeholder: "The Garden of Earthly Delights", entity: "paintings", missing: "Painting not found" },
};
const JOURNEYS = [...Object.keys(COLLECTIONS), "reading", "import"];
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

/** The reading journey on /library/journey-reading (seed: scripts/qa/reading-journey.sql) */
async function readingJourney() {
  const path = "/library/journey-reading";
  const steps = [];
  const step = async (label, fn) => {
    await fn();
    steps.push(label);
  };
  const control = "[...document.querySelectorAll('main button')].find((b) => /^(Start reading|Reading ·|Paused at|Read|Abandoned at)/.test(b.textContent.trim()))";
  const label = () => evaluate(`${control}?.textContent.trim() ?? ''`);
  const expectLabel = (pattern) => waitFor(`/${pattern}/.test(${control}?.textContent ?? '')`, `the control to read ${pattern}`);
  const menu = async (item) => {
    await evaluate(`${control}.click()`);
    await waitFor("document.querySelector('[role=menu]')", "the reading menu");
    await click(item, "[...document.querySelectorAll('[role=menu]')].pop()");
  };
  /** A field of the open dialog by its label's text */
  const field = (text) =>
    `(() => { const byAria = ${DIALOG}.querySelector('input[aria-label=' + ${JSON.stringify(JSON.stringify(text))} + ']'); if (byAria) return byAria; const l = [...${DIALOG}.querySelectorAll('label')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)})); return document.getElementById(l.htmlFor); })()`;
  const fill = async (text, value) => {
    await evaluate(`(() => { const el = ${field(text)}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(200);
  };
  /** Picks an option of a custom Select, found by its label or aria-label, in that Select's own list */
  const choose = async (text, option) => {
    const box = `(${DIALOG}.querySelector('[role=combobox][aria-label=' + ${JSON.stringify(JSON.stringify(text))} + ']') ?? ${field(text)})`;
    await evaluate(`${box}.click(), true`);
    await waitFor(`${box}.parentElement.querySelector('[role=listbox]')`, `the ${text} list`);
    const ok = await evaluate(`(() => { const o = [...${box}.parentElement.querySelectorAll('[role=option]')].find((e) => e.textContent.trim().replace(/^✓\\s*/, '').startsWith(${JSON.stringify(option)})); if (!o) return false; o.click(); return true; })()`);
    if (!ok) throw new Error(`No "${option}" in ${text}`);
    await sleep(250);
  };
  const save = async (text) => {
    await click(text, DIALOG);
    await waitFor(`!document.querySelector('dialog[open]')`, "the dialog to close").catch(() => {});
    await sleep(600);
  };
  /** Clicks Undo on the toast that says `message` */
  const undo = async (message) => {
    const button = `[...document.querySelectorAll('[data-sonner-toast]')].find((t) => t.textContent.includes(${JSON.stringify(message)}))?.querySelector('button[data-button], button:not([aria-label])')`;
    await waitFor(button, `the Undo of "${message}"`);
    await evaluate(`${button}.click()`);
    await sleep(1000);
  };
  const log = async (value, choice) => {
    await menu("Log progress");
    await waitFor(`${DIALOG}?.querySelector('form')`, "Log progress");
    await fill("Where are you?", value);
    if (choice) await evaluate(`${DIALOG}.querySelector('input[value=${choice}]').click()`);
    await save("Log");
  };
  try {
    await step("start at p. 150", async () => {
      await go(path);
      await menu("Start reading");
      await waitFor(`${DIALOG}?.textContent.includes("I'm at")`, "the Start dialog");
      await choose("I'm at", "Amsterdam");
      await fill("Already at", "150");
      await waitFor(`${DIALOG}.textContent.includes('Starting at p. 150 of 600 · 25%')`, "the start line");
      await save("Start reading");
      await expectLabel("Reading · p\\. 150 of 600 · 25%");
    });
    await step("log 212, +20", async () => {
      await log("212");
      await expectLabel("p\\. 212 of 600");
      await log("+20");
      await expectLabel("p\\. 232 of 600");
    });
    await step("fix a log and undo; go back", async () => {
      await log("200", "fix_last_log");
      await expectLabel("p\\. 200 of 600");
      await undo("Logged p. 200");
      await go(path);
      await expectLabel("p\\. 232 of 600");
      await log("200", "went_back");
      await expectLabel("p\\. 200 of 600");
    });
    await step("pause, resume, switch edition", async () => {
      await menu("Pause");
      await expectLabel("Paused at 33%");
      await menu("Resume");
      await expectLabel("Reading ·");
      await menu("Edit reading");
      await choose("Edition", "English · 2010 · 480 p.");
      await waitFor(`${DIALOG}.textContent.includes('p. 200 of 600 becomes p. 160 of 480')`, "the remap line");
      await save("Save");
      await expectLabel("p\\. 160 of 480");
    });
    await step("a sitting in the audiobook", async () => {
      await menu("Log progress");
      await click("Read in another edition or format", DIALOG);
      await choose("Read in another edition or format", "English · 2015");
      await fill("Where are you?", "50%");
      await waitFor(`${DIALOG}.textContent.includes('the reading moves to p. 240 of 480')`, "the move line");
      await save("Log");
      await expectLabel("p\\. 240 of 480 · 50%");
    });
    await step("finish with 4.5 and a review; undo; finish again", async () => {
      const finish = async (review) => {
        await menu("Finish");
        await waitFor(`${DIALOG}?.querySelector('[role=slider]')`, "the Finish dialog");
        // One key at a time: the slider renders between keys, as when typed
        for (const key of ["4", "ArrowRight"]) {
          await evaluate(`(() => { const s = ${DIALOG}.querySelector('[role=slider]'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); return true; })()`);
          await sleep(200);
        }
        await waitFor(`${DIALOG}.querySelector('[role=slider]').getAttribute('aria-valuetext') === '4.5 stars'`, "the rating 4.5");
        if (review) {
          await evaluate(`(() => { window.prompt = () => 'https://example.com/watt'; const area = ${DIALOG}.querySelector('[contenteditable=true]'); area.focus(); return true; })()`);
          await send("Input.insertText", { text: "A strange comedy" });
          await evaluate(`(() => { const sel = getSelection(); sel.selectAllChildren(${DIALOG}.querySelector('[contenteditable=true]')); return true; })()`);
          await click("Bold", DIALOG);
          await click("Link", DIALOG);
        }
        await click("Finish", DIALOG);
        await waitFor(`document.querySelector('[data-next-volume]') || !document.querySelector('dialog[open]')`, "the finish to save");
        await sleep(600);
      };
      await finish(true);
      await undo("Finished Journey Reading");
      await click("Close", "document");
      await go(path);
      await expectLabel("Reading · p\\. 240 of 480");
      if (await evaluate("!!document.querySelector('main [role=img][aria-label^=\"Rated\"]')")) throw new Error("The book's rating did not come back");
      // The review was kept through the Undo
      await finish(false);
      await waitFor("document.querySelector('[data-next-volume]')?.textContent.includes('on your shelf in Amsterdam')", "the next volume panel");
      await click("Close", "document");
      await go(path);
      await expectLabel("Read · ");
      await waitFor("document.querySelector('main [role=img][aria-label=\"Rated 4.5 out of 5\"]')", "the book's rating");
      await waitFor("document.querySelector('#reading strong') && document.querySelector('#reading a[href=\"https://example.com/watt\"]')", "the review's bold and link");
    });
    await step("re-read, abandon, undo, abandon, resume", async () => {
      await menu("Start a re-read");
      await waitFor(`${DIALOG}?.textContent.includes("I'm at")`, "the Start dialog");
      await save("Start reading");
      await expectLabel("Reading ·");
      const abandon = async () => {
        await menu("Abandon");
        await choose("Why", "The prose");
        await save("Abandon");
        await expectLabel("Abandoned at");
      };
      await abandon();
      await undo("Abandoned Journey Reading");
      await go(path);
      await expectLabel("Reading ·");
      await abandon();
      await menu("Resume this reading");
      await expectLabel("Reading ·");
    });
    /** Presses keys as the keyboard does: "r", then "l" opens Log a past read */
    const press = async (...keys) => {
      await evaluate("document.activeElement?.blur(), true");
      for (const key of keys) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key, code: `Key${key.toUpperCase()}` });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: `Key${key.toUpperCase()}` });
        await sleep(300);
      }
    };
    await step("past reads in 2009 and Apr 2019", async () => {
      // While a reading is open, Log a past read is on the R menu
      await press("r", "l");
      await choose("Finished: how precise", "Year");
      await fill("Finished: year", "2009");
      await save("Log read");
      await press("r", "l");
      await choose("Started: how precise", "Day");
      await fill("Started: year", "2019");
      await choose("Started: month", "April");
      await fill("Started: day", "14");
      await choose("Finished: how precise", "Month");
      await fill("Finished: year", "2019");
      await choose("Finished: month", "April");
      await click("Log read", DIALOG);
      await waitFor("!document.querySelector('dialog[open]')", "the second past read to save", 8000);
      await go(path);
      await waitFor("document.getElementById('reading')?.innerText.includes('Finished 2009')", "the 2009 read");
      await waitFor("document.getElementById('reading')?.innerText.includes('14 Apr 2019 to Apr 2019')", "the April 2019 read");
    });
    await step("delete a reading and undo", async () => {
      const count = () => evaluate("document.querySelectorAll('#reading [data-reading]').length");
      const before = await count();
      await evaluate("document.querySelector('#reading [data-reading=history] [data-reading-menu]').click()");
      await sleep(300);
      await click("Delete");
      await waitFor(DIALOG, "the delete dialog");
      await click("Delete", DIALOG);
      await waitFor(`document.querySelectorAll('#reading [data-reading]').length === ${before - 1}`, "the reading to go");
      await undo("Reading deleted");
      await go(path);
      if ((await count()) !== before) throw new Error("The reading did not come back");
    });
    // The reading hub (SLN-448): the reading is open again
    const card = "[...document.querySelectorAll('[data-hub-card]')].find((c) => c.textContent.includes('Journey Reading'))";
    await step("log from the hub", async () => {
      await go("/reading");
      await waitFor(card, "the hub's card");
      await evaluate(`${card}.querySelector('[data-hub-log]').click()`);
      await waitFor(`${DIALOG}?.querySelector('form')`, "Log progress");
      await fill("Where are you?", "200");
      // Behind the last log: say it was a mistyped one
      await evaluate(`${DIALOG}.querySelector('input[value=fix_last_log]')?.click(), true`);
      await save("Log");
      await waitFor(`${card}.querySelector('[data-hub-position]').textContent.startsWith('p. 200 of')`, "the card at p. 200");
    });
    await step('log "212" from the palette', async () => {
      // Cmd+K on a Mac, Ctrl+K elsewhere: the palette refuses both at once
      await evaluate("(() => { const mac = /Mac|iPhone|iPad/.test(navigator.platform); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: mac, ctrlKey: !mac, bubbles: true })); return true; })()");
      await waitFor("document.querySelector('[cmdk-input]')", "the palette");
      const item = "[...document.querySelectorAll('[cmdk-item]')].find((e) => e.textContent.includes('Log p. 212 · Journey Reading'))";
      await evaluate("(() => { const i = document.querySelector('[cmdk-input]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '212'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
      await waitFor(item, "Log p. 212 in the palette");
      await evaluate(`${item}.click()`);
      await waitFor(`${DIALOG}?.querySelector('form') && ${field("Where are you?")}.value === '212'`, "Log progress with 212");
      await save("Log");
      await waitFor(`${card}.querySelector('[data-hub-position]').textContent.startsWith('p. 212 of')`, "the card at p. 212");
    });
    await step("filter the journal by year", async () => {
      await go("/reading/journal?yearMin=2009&yearMax=2009");
      await waitFor("document.querySelector('[data-journal-summary]')", "the journal");
      const rows = await evaluate("[...document.querySelectorAll('[data-journal-row]')].map((r) => r.textContent)");
      const groups = await evaluate("[...document.querySelectorAll('#list-start h3')].map((h) => h.textContent)");
      if (!rows.length || !rows.every((r) => r.includes('2009')) || groups.join() !== "2009")
        throw new Error(`The 2009 filter shows ${rows.length} rows in ${groups.join(", ")}`);
      if (!rows.some((r) => r.includes("Journey Reading"))) throw new Error("The 2009 read of Journey Reading is not in the journal");
    });
    await step("add a book from the picker and start it", async () => {
      const title = `Journey Loan ${Date.now() % 100000}`;
      await go("/reading");
      await evaluate("document.querySelector('[data-hub-start]').click()");
      await waitFor(`${DIALOG}?.querySelector('input[aria-label="Search books"]')`, "the book picker");
      await fill("Search books", title);
      await waitFor(`${DIALOG}.querySelector('[data-picker-empty] [data-picker-add]')`, "Not in Durtal? Add");
      await evaluate(`${DIALOG}.querySelector('[data-picker-empty] [data-picker-add]').click()`);
      await waitFor(`location.pathname === '/library/new' && document.querySelector('input[placeholder^="Search by title"]')?.value === ${JSON.stringify(title)}`, "the add page searching the title");
      await click("Enter details manually");
      await waitFor("document.getElementById('title')", "the details step");
      await type("document.getElementById('title')", title);
      await type("document.getElementById('author')", "Journey Author");
      await click("Fast Track");
      await waitFor(`location.pathname.startsWith('/library/journey-loan') && !location.search.includes('then')`, "the new book's page");
      await waitFor(`${DIALOG}?.open && ${DIALOG}.textContent.includes("I'm at")`, "Start reading on the new book");
    });
    console.log(`ok    reading: ${steps.join(" → ")}`);
    return true;
  } catch (error) {
    const toastText = await evaluate("[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.replace(/\\s+/g, ' ')).join(' | ')").catch(() => "");
    const dialogText = await evaluate(`${DIALOG}?.open ? ${DIALOG}.innerText.replace(/\\s+/g, ' ').slice(0, 300) : ''`).catch(() => "");
    console.log(`FAIL  reading: ${steps.join(" → ")}${steps.length ? " → " : ""}✗ ${error.message} (control: ${await label().catch(() => "?")})${toastText ? ` [toasts: ${toastText}]` : ""}${dialogText ? ` [dialog: ${dialogText}]` : ""}`);
    return false;
  }
}

/** The import journey (seed: scripts/qa/reading-import-journey.sql) */
async function importJourney() {
  const steps = [];
  const step = async (label, fn) => {
    await fn();
    steps.push(label);
  };
  const header = ["Book Id", "Title", "Author", "Author l-f", "Additional Authors", "ISBN", "ISBN13", "My Rating", "Average Rating", "Publisher", "Binding", "Number of Pages", "Year Published", "Original Publication Year", "Date Read", "Date Added", "Bookshelves", "Bookshelves with positions", "Exclusive Shelf", "My Review", "Spoiler", "Private Notes", "Read Count", "Owned Copies"];
  const rows = [
    { "Book Id": "9000001", Title: "Import Journey Reread", Author: "Journey Author", "My Rating": "5", "Date Read": "2020/03/14", "Exclusive Shelf": "read", "My Review": "<b>Bold</b> review", "Read Count": "2" },
    { "Book Id": "9000002", Title: "Import Journey Rated", Author: "Journey Author", ISBN13: '="9780000000019"', "My Rating": "4", "Date Read": "2021/05/05", "Exclusive Shelf": "read", "Read Count": "1" },
    { "Book Id": "9000003", Title: "Import Journey Current", Author: "Journey Author", "Date Read": "2018/08/08", "Exclusive Shelf": "currently-reading", "Read Count": "1" },
    { "Book Id": "9000004", Title: "Import Journey Dropped", Author: "Journey Author", "Date Read": "2022/02/02", Bookshelves: "dnf", "Exclusive Shelf": "read", "Read Count": "1" },
    { "Book Id": "9000005", Title: "Import Journey Twin", Author: "Someone Else", "Exclusive Shelf": "read", "Read Count": "1" },
    { "Book Id": "9000006", Title: "Import Journey Missing", Author: "Journey Newcomer", "Date Read": "2023/07/01", "Exclusive Shelf": "read", "Read Count": "1" },
    { "Book Id": "9000007", Title: "Import Journey Wanted", Author: "Journey Author", "Exclusive Shelf": "to-read", "Read Count": "0" },
    { "Book Id": "9000008", Title: "Import Journey Wanted Too", Author: "Journey Author", "Exclusive Shelf": "to-read", "Read Count": "0" },
  ];
  const cell = (v) => (/[",\n]/.test(v) && !v.startsWith("=") ? `"${v.replace(/"/g, '""')}"` : v);
  const file = join(mkdtempSync(join(tmpdir(), "import-journey-")), "goodreads_library_export.csv");
  writeFileSync(file, [header.join(","), ...rows.map((r) => header.map((h) => cell(r[h] ?? "")).join(","))].join("\n") + "\n");
  const row = (n) => `document.querySelector('[data-import-row="${n}"]')`;
  const toast = (text) => `[...document.querySelectorAll('[data-sonner-toast]')].some((t) => t.textContent.includes(${JSON.stringify(text)}))`;
  let importId = "";
  const upload = async () => {
    await go("/reading/import");
    await waitFor("document.querySelector('[data-import-file]')", "the upload area");
    const { result } = await send("DOM.getDocument", { depth: 0 });
    const { result: input } = await send("DOM.querySelector", { nodeId: result.root.nodeId, selector: "[data-import-file]" });
    await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [file] });
    await waitFor("/^\\/reading\\/import\\/[0-9a-f-]{36}$/.test(location.pathname) && document.querySelector('[data-import-summary]')", "the preview", 60000);
    importId = await evaluate("location.pathname.split('/').pop()");
  };
  try {
    await step("upload a Goodreads file", upload);
    await step("see the summary and the rating kept", async () => {
      const summary = await evaluate("document.querySelector('[data-import-summary]').textContent");
      if (summary !== "8 rows · 4 exact · 1 to choose · 1 not in Durtal · 2 want to read · 1 book rating differs") throw new Error(`The summary reads "${summary}"`);
      await waitFor(`${row(2)}?.textContent.includes('Book rating 3 kept (the file says 4)')`, "the kept rating");
      await waitFor(`${row(1)}?.textContent.includes('+1 earlier read, date unknown') && ${row(1)}.textContent.includes('Book rating set to 5')`, "the re-read's line");
      await waitFor("document.querySelector('[data-import-commit]').textContent === 'Import 6 readings'", "Import 6 readings");
    });
    await step("use the file's rating, then keep the book's", async () => {
      const box = `${row(2)}.querySelector('[data-import-rating] input')`;
      await evaluate(`${box}.click(), true`);
      await waitFor(`${row(2)}.textContent.includes('Book rating 3 replaced by 4') && ${box}.checked`, "the rating replaced");
      await evaluate(`${box}.click(), true`);
      await waitFor(`${row(2)}.textContent.includes('Book rating 3 kept (the file says 4)') && !${box}.checked`, "the rating kept again");
    });
    await step("choose a book with the picker", async () => {
      await evaluate(`${row(5)}.querySelector('[data-import-pick]').click()`);
      await waitFor(`${DIALOG}?.querySelector('[data-picker-results] button')`, "the picker's books");
      const ok = await evaluate(`(() => { const b = [...${DIALOG}.querySelectorAll('[data-picker-results] button')].find((e) => e.textContent.includes('Import Journey Twin') && e.textContent.includes('Journey Author')); if (!b) return false; b.click(); return true; })()`);
      if (!ok) throw new Error("No Import Journey Twin by Journey Author in the picker");
      await waitFor(`${row(5)}?.textContent.includes('Chosen by you') && ${row(5)}.querySelector('[data-import-decide=import][aria-pressed=true]')`, "the chosen book, to import");
    });
    await step("add a missing book and see its row match", async () => {
      const href = await evaluate(`${row(6)}.querySelector('[data-import-add]').getAttribute('href')`);
      if (href !== "/library/new?q=Import+Journey+Missing+Journey+Newcomer") throw new Error(`Add this book links to ${href}`);
      await evaluate(`sessionStorage.setItem('durtal-import-added', ${JSON.stringify(importId)}), true`);
      await go(href);
      await click("Enter details manually");
      await waitFor("document.getElementById('title')", "the details step");
      await type("document.getElementById('title')", "Import Journey Missing");
      await type("document.getElementById('author')", "Journey Newcomer");
      await click("Fast Track");
      await waitFor("location.pathname.startsWith('/library/import-journey-missing')", "the new book's page", 30000);
      await go(`/reading/import/${importId}`);
      await waitFor(`${row(6)}?.querySelector('[data-import-book]')`, "the row matched to the new book", 30000);
      await evaluate(`${row(6)}.querySelector('[data-import-decide=import]').click()`);
      await waitFor("document.querySelector('[data-import-commit]').textContent === 'Import 8 readings'", "Import 8 readings");
    });
    await step("commit", async () => {
      await evaluate("document.querySelector('[data-import-commit]').click()");
      await waitFor(toast("8 readings written"), "8 readings written", 60000);
      await waitFor(`${row(1)}?.querySelector('[data-import-outcome]')?.textContent.includes('Written (2)')`, "the re-read's outcome");
    });
    await step("check the book page and the journal", async () => {
      await go("/library/import-journey-reread");
      await waitFor("document.getElementById('reading')?.innerText.includes('14 Mar 2020')", "the 2020 read on the book page");
      await go("/reading/journal?q=Import+Journey");
      await waitFor("document.querySelectorAll('[data-journal-row]').length === 8", "8 imported readings in the journal");
    });
    await step("open the imported review in Edit", async () => {
      const menu = "[...document.querySelectorAll('[data-journal-row]')].find((r) => r.textContent.includes('Import Journey Reread') && r.textContent.includes('2020'))?.querySelector('[data-journal-menu]')";
      await evaluate(`${menu}.click()`);
      await waitFor("document.querySelector('[role=menu]')", "the row's menu");
      await click("Edit", "[...document.querySelectorAll('[role=menu]')].pop()");
      await waitFor(`${DIALOG}?.querySelector('form strong')?.textContent === 'Bold'`, "the review's bold text in Edit");
      await evaluate(`${DIALOG}.querySelector('button[data-variant=ghost]')?.click(), true`);
      await sleep(500);
    });
    await step("undo", async () => {
      await go(`/reading/import/${importId}`);
      await evaluate(`document.querySelector('[data-import-undo="${importId}"]').click()`);
      await waitFor("document.querySelector('[data-import-undo-confirm]')", "the undo question");
      await evaluate("document.querySelector('[data-import-undo-confirm]').click()");
      await waitFor(toast("8 readings removed"), "8 readings removed", 60000);
    });
    await step("commit again", async () => {
      await waitFor("document.querySelector('[data-import-commit]')?.textContent === 'Import 8 readings'", "Import 8 readings again");
      await evaluate("document.querySelector('[data-import-commit]').click()");
      await waitFor(toast("8 readings written"), "8 readings written again", 60000);
    });
    await step("upload the same file again: nothing to import", async () => {
      await upload();
      const summary = await evaluate("document.querySelector('[data-import-summary]').textContent");
      if (summary !== "8 rows · 2 want to read · 6 already in Durtal") throw new Error(`The second upload's summary reads "${summary}"`);
      await waitFor("document.querySelector('[data-import-commit]').disabled && document.querySelector('[data-import-commit]').textContent === 'Nothing to import'", "Nothing to import");
    });
    await step(noS3 ? "the list says Raw file not kept" : "the list shows the raw file kept", async () => {
      await go("/reading/import");
      const text = await evaluate(`document.querySelector('[data-import-item="${importId}"]')?.textContent ?? ''`);
      if (!text) throw new Error("The import is not in the list");
      if (noS3 !== text.includes("Raw file not kept")) throw new Error(`The list reads "${text}"`);
    });
    console.log(`ok    import: ${steps.join(" → ")}`);
    return true;
  } catch (error) {
    const toastText = await evaluate("[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText.replace(/\\s+/g, ' ')).join(' | ')").catch(() => "");
    console.log(`FAIL  import: ${steps.join(" → ")}${steps.length ? " → " : ""}✗ ${error.message}${toastText ? ` [toasts: ${toastText}]` : ""}`);
    return false;
  }
}

// A fresh next dev compiles each route on its first request: compile them here,
// so the journeys' waits measure the app, not the compiler
for (const name of chosen.filter((n) => COLLECTIONS[n]))
  for (const path of [`/${name}`, `/${name}/new`, `/${name}/journey-warm-up`])
    await fetch(base + path, { signal: AbortSignal.timeout(180000) }).catch(() => {});

if (chosen.includes("reading"))
  await fetch(`${base}/library/journey-reading`, { signal: AbortSignal.timeout(180000) }).catch(() => {});
if (chosen.includes("import"))
  for (const path of ["/reading/import", "/library/new", "/reading/journal"])
    await fetch(base + path, { signal: AbortSignal.timeout(180000) }).catch(() => {});

let failed = 0;
for (const name of chosen) {
  if (name === "reading") {
    if (!(await readingJourney())) failed++;
    continue;
  }
  if (name === "import") {
    if (!(await importJourney())) failed++;
    continue;
  }
  if (!COLLECTIONS[name]) {
    console.log(`FAIL  ${name}: not a journey (${JOURNEYS.join(", ")})`);
    failed++;
    continue;
  }
  if (!(await journey(name))) failed++;
}
ws.close();
chrome.kill();
console.log(failed ? `\n${failed} of ${chosen.length} journeys failed` : `\nAll ${chosen.length} journeys passed`);
process.exit(failed ? 1 : 0);
