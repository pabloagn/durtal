#!/usr/bin/env node
/**
 * Reader engine check (eBooks sub-issue 3): the engine's contract with the
 * reading view, in headless Chrome (DevTools protocol), WebKit (standing in
 * for Safari) and patched Firefox (Playwright native protocol), with system
 * Firefox using WebDriver BiDi, all driven by playwright-core:
 *
 *   opens      every fixture opens at its first text, at 1440, 768 and 390 px;
 *              the corrupt zip shows the error state and the DRM book the
 *              cannot-be-read state
 *   script     the scripted EPUB's inline and file scripts never run: their
 *              globals stay unset in the page and in every section frame
 *   font       with publisher typography the obfuscated font loads on a secure
 *              origin; on plain http (Chrome: durtal.test mapped to this
 *              computer) it cannot be decoded and the book still opens
 *   direction  after a click into the text, → turns forward in a
 *              left-to-right book and ← in the right-to-left and vertical
 *              Japanese ones, and the other key turns back
 *   place      a saved place reopens at the same first visible words; at
 *              390 px with touch, also when the tab was only hidden before it
 *              closed (the save goes out with sendBeacon)
 *   touch      at 390 px with touch (Chrome, WebKit): a tap in the middle
 *              shows or hides the bars, a tap just inside the edge strips
 *              stays, the outer right strip turns forward, the left back, a
 *              swipe to the left forward
 *   bars       both bars show on open, hide together after 3 s and come back
 *              together on a mouse move; a click anywhere in the text keeps
 *              the place, and the Next page edge button turns
 *   pointer    SLN-662, at 1440: a double-click selects a word and a drag a
 *              line without turning; with the selection toolbar open, a click
 *              in the text or the margin closes it without turning; a click on
 *              a link follows it; once the bars hide, the page button of the
 *              margin the mouse rests in stays up. At 390 with touch (Chrome,
 *              WebKit): a long press keeps the place; with a selection, a tap
 *              in an edge strip closes it without turning; a tap on a link
 *              follows it
 *   dialogs    Contents and Settings take focus, keep Tab inside, close with
 *              Escape and give focus back to their button
 *   pdfmarks   a highlight made by dragging across a line of the PDF fixture
 *              is drawn on the page, and still drawn after a reload (SLN-670)
 *   turns      no frame of a jump in the EPUB 3 (Back from a far page), of
 *              a turn in the text PDF or of a turn in the comic shows a blank
 *              page, at 1440 and 390 (SLN-660). Chrome's frames come from
 *              its screencast, WebKit's from screenshots taken back to back,
 *              leaving out those taken while a transition's update runs;
 *              a lone blank frame between two of the unchanged page, as a
 *              snapshot is taken, is counted apart. Headless Firefox
 *              captures leave out the View Transition layers, so it is not
 *              checked
 *   endurance  only with --only endurance, on a preview started with
 *              --reader-large: the 50 MB EPUB and the 300 MB PDF open at
 *              390 px and take 300 page turns without the page crashing or
 *              reloading (the memory check for WebKit, which reports no heap)
 *
 *   node scripts/qa/reader-engine-check.mjs [--base http://127.0.0.1:3410]
 *        [--browsers chromium,webkit,firefox] [--only opens,script,...]
 *
 * Needs a preview with the reader fixtures: pnpm build, then
 * scripts/qa/preview-local.py --start --s3-dir DIR --seed-reader. It sends
 * page loads and the reader's own position saves, so it refuses any host but
 * this computer, and port 3100 (the live app). playwright-core comes from
 * $PLAYWRIGHT_CORE, else /opt/durtal-qa (the cloud setup), else this
 * project's node_modules; the browsers from $PLAYWRIGHT_BROWSERS_PATH, and
 * Chrome/WebKit optionally from $CHROME/$WEBKIT (else Playwright defaults),
 * and Firefox from $FIREFOX, else Playwright's build, else the system Firefox.
 * First-page checks reset only synthetic fixture positions through the existing
 * disposable-preview DB bridge. Its state file defaults to the preview port
 * in the temp directory; --preview-state FILE selects a relocated state file.
 * Run alone against that preview, after other reader checks have finished.
 * Exits 1 on any failure.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkNavigation, goto } from "./reader-navigation-checks.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const base = option("--base", "http://127.0.0.1:3410").replace(/\/$/, "");
const previewState = option("--preview-state", undefined);
const browsers = option("--browsers", "chromium,webkit,firefox").split(",");
const CHECKS = ["opens", "script", "font", "direction", "place", "touch", "bars", "pointer", "dialogs", "navigation", "pdfmarks", "turns", "endurance"];
// endurance needs the large fixtures: it runs only when asked for
const only = option("--only", CHECKS.filter((c) => c !== "endurance").join(",")).split(",");

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

process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/opt/pw-browsers";
const playwrightPath =
  process.env.PLAYWRIGHT_CORE ??
  ["/opt/durtal-qa/node_modules/playwright-core/index.mjs"].find((path) => existsSync(path));
const { chromium, webkit, firefox } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : "playwright-core");

/** Patched Playwright builds use its native protocol; system Firefox uses BiDi. */
function firefoxLaunchOptions() {
  const override = process.env.FIREFOX;
  const overridePath = override && existsSync(override) ? realpathSync(override) : null;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (const build of existsSync(dir) ? readdirSync(dir).sort().reverse() : []) {
    if (!build.startsWith("firefox-")) continue;
    for (const bin of ["firefox/firefox", "firefox/Nightly.app/Contents/MacOS/firefox"]) {
      const executablePath = join(dir, build, bin);
      if (!existsSync(executablePath)) continue;
      if (!override || overridePath === realpathSync(executablePath))
        return { executablePath: override || executablePath };
    }
  }
  return { channel: "moz-firefox", executablePath: override };
}

// The fixtures scripts/qa/preview-local.py --seed-reader stores, by e-book id
const ebook = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const FIXTURES = [
  { n: 1, file: "epub3.epub", name: "EPUB 3", first: "Chapter 1" },
  { n: 2, file: "text.pdf", name: "text PDF", text: true },
  { n: 3, file: "mobi.mobi", name: "MOBI", first: "Contents" },
  { n: 4, file: "fb2.fb2", name: "FB2", first: "Chapter 1" },
  { n: 5, file: "epub2.epub", name: "EPUB 2", first: "Chapter 1" },
  { n: 6, file: "azw3.azw3", name: "AZW3", first: "Chapter 1" },
  { n: 7, file: "cbz.cbz", name: "CBZ", image: true },
  { n: 8, file: "rtl.epub", name: "right-to-left EPUB", first: "الفصل 1" },
  { n: 9, file: "vertical-ja.epub", name: "vertical Japanese EPUB", first: "第1章" },
  { n: 10, file: "obfuscated-font.epub", name: "obfuscated-font EPUB", first: "Chapter 1" },
  { n: 11, file: "scripted.epub", name: "scripted EPUB", first: "Chapter 1" },
];
const CORRUPT = 12;
const DRM = 13;
const WIDTHS = [1440, 768, 390];

let previewBridge;
/** Reset a seeded book only for first-page assertions; never reset saved-place reopens. */
async function resetFixturePosition(n) {
  const fixture = FIXTURES.find((item) => item.n === n);
  if (!fixture) throw new Error("Position reset refused: not an opening fixture");
  if (!previewBridge) {
    previewBridge = (async () => {
      const statePath = previewState ?? join(tmpdir(), `durtal-preview-${target.port || 80}.json`);
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      if (!state.s3Dir || typeof state.databaseUrl !== "string")
        throw new Error("Position reset requires the seeded disposable preview state");
      // Reuse the preview's actual guard: loopback host and /durtal_preview only.
      // Never load .env or fall back to an inherited database URL.
      const previous = process.env.DATABASE_URL;
      process.env.DATABASE_URL = state.databaseUrl;
      try { await import(new URL("./neon-local-bridge.mjs", import.meta.url).href); }
      finally {
        if (previous === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previous;
      }
    })();
  }
  await previewBridge;
  const id = ebook(n);
  const fileId = `00000000-0000-4000-a000-f${String(n).padStart(11, "0")}`;
  // The ID alone is insufficient: require the exact preview import, author and
  // seeded file identity too. Only ebook_positions for this synthetic book
  // are removed (including its seeded alternate format), no other reader data.
  const response = await fetch("http://127.0.0.1/sql", {
    method: "POST",
    body: JSON.stringify({
      query: `with fixture as (
        select e.id from ebooks e join ebook_files f on f.ebook_id = e.id
        where e.id = $1::uuid and e.import_source = 'folder' and e.import_ref = $2
          and e.authors = ARRAY['Durtal Fixtures']::text[]
          and f.id = $3::uuid and f.original_filename = $4
      ), removed as (
        delete from ebook_positions p using fixture f where p.ebook_id = f.id returning p.id
      ) select exists(select 1 from fixture), (select count(*) from removed)`,
      params: [id, `fixtures/${fixture.file}`, fileId, fixture.file],
    }),
  });
  if (!response.ok) throw new Error("Synthetic fixture position reset failed");
  const result = await response.json();
  if (result.rows?.[0]?.[0] !== "t")
    throw new Error("Position reset refused: seeded fixture identity did not match");
}

async function revealBars(page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Reader QA requires an explicit viewport");
  // Two samples: the reader ignores a pointer's first position (SLN-663)
  await page.mouse.move(viewport.width / 2, Math.min(8, viewport.height - 1));
  await page.mouse.move(viewport.width / 2 + 12, Math.min(16, viewport.height - 1));
  await sleep(200);
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const results = [];
function record(browser, check, what, ok, detail = "") {
  results.push({ browser, check, what, ok, detail });
  if (!ok) failures.push(`${browser} ${check} ${what}: ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${browser.padEnd(8)} ${check.padEnd(9)} ${what}${detail ? `  (${detail})` : ""}`);
}

/** The reading view as the page sees it */
function readState() {
  const view = document.querySelector("foliate-view");
  const location = view?.lastLocation;
  const contents = view?.renderer?.getContents?.() ?? [];
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  return {
    state: document.querySelector("[data-reader]")?.getAttribute("data-reader") ?? null,
    index: location?.index ?? null,
    fraction: location?.fraction ?? null,
    first: location?.range ? squash(location.range.toString()).slice(0, 48) : null,
    text: squash(contents.map(({ doc }) => doc.body?.innerText ?? "").join(" ")).slice(0, 80),
    images: contents.reduce(
      (n, { doc }) => n + [...doc.querySelectorAll("img, canvas")].filter((el) => (el.naturalWidth ?? el.width) > 0).length,
      0,
    ),
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
  };
}

async function open(page, n, url = base) {
  const started = Date.now();
  await page.goto(`${url}/reader/${ebook(n)}`);
  await page.waitForSelector('[data-reader="ready"], [data-reader="error"]', { timeout: 60_000 });
  // The first relocate lands a frame after ready
  await page.waitForFunction(
    () => document.querySelector("[data-reader]")?.getAttribute("data-reader") === "error" || !!document.querySelector("foliate-view")?.lastLocation,
    null,
    { timeout: 10_000 },
  );
  return { ms: Date.now() - started, ...(await page.evaluate(readState)) };
}

/** Waits for the place to move away from `fraction`; returns the new state */
async function moved(page, fraction, timeout = 4000) {
  try {
    await page.waitForFunction((f) => document.querySelector("foliate-view")?.lastLocation?.fraction !== f, fraction, { timeout });
  } catch {}
  await sleep(150);
  return page.evaluate(readState);
}

const desktop = { viewport: { width: 1440, height: 900 } };
const phone = (name) => ({
  viewport: { width: 390, height: 844 },
  ...(name === "firefox" ? {} : { hasTouch: true, isMobile: true }),
});

async function checkOpens(name, browser) {
  for (const width of WIDTHS) {
    const context = await browser.newContext(width === 390 ? phone(name) : { viewport: { width, height: 900 } });
    for (const fixture of FIXTURES) {
      await resetFixturePosition(fixture.n);
      const page = await context.newPage();
      const s = await open(page, fixture.n).catch((error) => ({ state: `failed: ${error.message.split("\n")[0]}` }));
      let ok = s.state === "ready" && s.index === 0;
      if (ok && fixture.first) ok = s.first?.startsWith(fixture.first) ?? false;
      if (ok && fixture.text) ok = s.text.length > 0;
      if (ok && fixture.image) ok = s.images > 0;
      record(name, "opens", `${width} ${fixture.name}`, ok, ok ? `${s.ms} ms` : JSON.stringify(s));
      await page.close();
    }
    for (const [n, label, expect] of [
      [CORRUPT, "corrupt zip", "not a valid eBook"],
      [DRM, "DRM EPUB", "cannot be read here"],
    ]) {
      const page = await context.newPage();
      const s = await open(page, n).catch((error) => ({ state: `failed: ${error.message.split("\n")[0]}` }));
      const ok = s.state === "error" && (s.alert ?? "").includes(expect);
      record(name, "opens", `${width} ${label} shows its error`, ok, ok ? "" : JSON.stringify(s));
      await page.close();
    }
    await context.close();
  }
}

async function checkScript(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  const violations = [];
  page.on("console", (m) => {
    if (/content security policy|script-src|blocked an inline script|refused to (execute|load)/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (/script-src|content security policy/i.test(e.message)) violations.push(e.message);
  });
  const s = await open(page, 11);
  await sleep(1000);
  const globals = await page.evaluate(() => {
    const view = document.querySelector("foliate-view");
    const frames = view.renderer.getContents().map(({ doc }) => doc.defaultView);
    const set = [window, ...frames].filter((w) => w && ("__durtalBookScript" in w || "__durtalBookScriptFile" in w)).length;
    return { frames: frames.length, set };
  });
  const ok = s.state === "ready" && globals.frames > 0 && globals.set === 0;
  record(name, "script", "the book's scripts stay unrun", ok, `${globals.frames} frames, ${globals.set} with the globals, ${violations.length} policy reports`);
  await context.close();
}

/** Exercise the current publisher typography controls, then close Settings. */
async function pickPublisherFont(page) {
  await revealBars(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
  await dialog.getByRole("radio", { name: "This book", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Font", exact: true }).selectOption("publisher");
  await dialog.getByRole("checkbox", { name: "Use publisher typography", exact: true }).check();
  await dialog.getByRole("status").filter({ hasText: /^Settings saved$/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
}

async function fontStatus(page) {
  return page.evaluate(async () => {
    const view = document.querySelector("foliate-view");
    const statuses = [];
    for (const { doc } of view.renderer.getContents()) {
      await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
      for (const face of doc.fonts) if (face.family.replace(/"/g, "") === "Fixture Garamond") statuses.push(face.status);
    }
    return { statuses, secure: isSecureContext };
  });
}

async function checkFont(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  await resetFixturePosition(10);
  let s = await open(page, 10);
  await pickPublisherFont(page);
  await sleep(800);
  const fonts = await fontStatus(page);
  record(
    name,
    "font",
    "the obfuscated font loads on a secure origin",
    s.state === "ready" && fonts.secure && fonts.statuses.includes("loaded"),
    `secure ${fonts.secure}, faces ${fonts.statuses.join(", ") || "none"}`,
  );
  await context.close();

  if (name !== "chromium") return;
  // Plain http on a name that is not this computer's: no crypto.subtle, so no de-obfuscation
  const insecure = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: [`--host-resolver-rules=MAP durtal.test 127.0.0.1`] });
  const http = await (await insecure.newContext(desktop)).newPage();
  await resetFixturePosition(10);
  s = await open(http, 10, `http://durtal.test:${target.port || 80}`).catch((error) => ({ state: `failed: ${error.message}` }));
  if (s.state === "ready") await pickPublisherFont(http);
  const secure = await http.evaluate(() => isSecureContext).catch(() => null);
  record(
    name,
    "font",
    "the book still opens on plain http",
    s.state === "ready" && secure === false && (s.first ?? "").startsWith("Chapter 1"),
    `secure ${secure}, ${JSON.stringify({ state: s.state, first: s.first })}`,
  );
  await insecure.close();
}

async function checkDirection(name, browser) {
  const context = await browser.newContext(desktop);
  for (const [n, label, forward, back] of [
    [5, "left-to-right", "ArrowRight", "ArrowLeft"],
    [8, "right-to-left", "ArrowLeft", "ArrowRight"],
    [9, "vertical Japanese", "ArrowLeft", "ArrowRight"],
  ]) {
    const page = await context.newPage();
    const start = await open(page, n);
    // Into the text first: the middle of the page shows or hides the bars, and focus goes into the book
    await page.mouse.click(720, 450);
    await sleep(300);
    await page.keyboard.press(forward);
    const after = await moved(page, start.fraction);
    await page.keyboard.press(back);
    const backAgain = await moved(page, after.fraction);
    const ok = after.fraction > start.fraction && backAgain.fraction < after.fraction;
    record(name, "direction", `${label}: ${forward} forward, ${back} back`, ok, `${start.fraction?.toFixed(3)} → ${after.fraction?.toFixed(3)} → ${backAgain.fraction?.toFixed(3)}`);
    await page.close();
  }
  await context.close();
}

const isSave = (n) => (response) =>
  response.url().endsWith(`/api/reader/${ebook(n)}/position`) && response.request().method() === "POST";

async function checkPlace(name, browser) {
  // Turns, the save after them, and a reopen in the same browser (the same device)
  const context = await browser.newContext(desktop);
  let page = await context.newPage();
  let s = await open(page, 1);
  await page.mouse.click(720, 450);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowRight");
    s = await moved(page, s.fraction);
  }
  const saved = await page.waitForResponse(isSave(1), { timeout: 10_000 }).catch(() => null);
  const left = s.first;
  await page.close();
  page = await context.newPage();
  let back = await open(page, 1);
  record(
    name,
    "place",
    "a saved place reopens at the same first words",
    !!saved?.ok() && !!left && back.first === left,
    `left at "${left}", reopened at "${back.first}"`,
  );
  await context.close();

  // At 390 px: turns, the tab hidden at once (before the 2 s save), closed, reopened
  const touch = name !== "firefox";
  const mobile = await browser.newContext(phone(name));
  page = await mobile.newPage();
  s = await open(page, 1);
  // The landing place is saved first; wait for it so only the hidden tab's beacon can carry the turns
  await page.waitForResponse(isSave(1), { timeout: 10_000 }).catch(() => null);
  for (let i = 0; i < 2; i++) {
    if (touch) await page.touchscreen.tap(360, 420);
    else await page.mouse.click(360, 420);
    s = await moved(page, s.fraction);
  }
  const hiddenAt = s.first;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(500);
  await page.close();
  page = await mobile.newPage();
  back = await open(page, 1);
  record(
    name,
    "place",
    `390${touch ? " touch" : ""}: hidden then closed, reopens at the same first words`,
    !!hiddenAt && back.first === hiddenAt,
    `hidden at "${hiddenAt}", reopened at "${back.first}"`,
  );
  await mobile.close();
}

async function checkTouch(name, browser) {
  if (name === "firefox") return; // Firefox has no touch emulation in Playwright
  const context = await browser.newContext(phone(name));
  const page = await context.newPage();
  const start = await open(page, 5);
  const width = 390;
  // Only the outer 12% strips turn (SLN-662); the middle shows the bars
  const bars = () => page.evaluate(() => !document.querySelector("footer[data-reader-chrome]").inert);
  const before = await bars();
  await page.touchscreen.tap(width * 0.5, 420);
  await sleep(400);
  const toggled = (await bars()) !== before;
  const middle = await moved(page, start.fraction);
  await page.touchscreen.tap(width * 0.7, 420);
  await sleep(400);
  const inner = await moved(page, start.fraction);
  await page.touchscreen.tap(width * 0.95, 420);
  const right = await moved(page, start.fraction);
  await page.touchscreen.tap(width * 0.05, 420);
  const left = await moved(page, right.fraction);
  await page.evaluate(() => {
    const view = document.querySelector("foliate-view");
    const { doc } = view.renderer.getContents()[0];
    const win = doc.defaultView;
    const target = doc.body;
    // WebKit builds touches with createTouch and lists with createTouchList; Chrome with the constructors
    const touch = (x, y) =>
      doc.createTouch ? doc.createTouch(win, target, 1, x, y, x, y) : new win.Touch({ identifier: 1, target, clientX: x, clientY: y });
    const list = (...touches) => (doc.createTouchList ? doc.createTouchList(...touches) : touches);
    const fire = (type, x, down) =>
      target.dispatchEvent(
        new win.TouchEvent(type, { bubbles: true, cancelable: true, touches: down ? list(touch(x, 300)) : list(), changedTouches: list(touch(x, 300)) }),
      );
    fire("touchstart", 300, true);
    fire("touchmove", 220, true);
    fire("touchend", 150, false);
  });
  const swiped = await moved(page, left.fraction);
  record(name, "touch", "390: a tap in the middle shows or hides the bars and stays", toggled && middle.fraction === start.fraction, `bars ${before} → ${!before === toggled ? !before : before}, ${start.fraction?.toFixed(3)} → ${middle.fraction?.toFixed(3)}`);
  record(name, "touch", "390: a tap inside the edge strips does not turn", inner.fraction === start.fraction, `${start.fraction?.toFixed(3)} → ${inner.fraction?.toFixed(3)}`);
  record(name, "touch", "390: the right zone turns forward", right.fraction > start.fraction, `${start.fraction?.toFixed(3)} → ${right.fraction?.toFixed(3)}`);
  record(name, "touch", "390: the left zone turns back", left.fraction < right.fraction, `${right.fraction?.toFixed(3)} → ${left.fraction?.toFixed(3)}`);
  record(name, "touch", "390: a swipe to the left turns forward", swiped.fraction > left.fraction, `${left.fraction?.toFixed(3)} → ${swiped.fraction?.toFixed(3)}`);
  await context.close();
}

async function checkBars(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  const bars = () =>
    page.evaluate(() => [...document.querySelectorAll("header[data-reader-chrome], footer[data-reader-chrome]")].map((el) => !el.inert && getComputedStyle(el).opacity !== "0"));
  // Its own book: the turns below save places other checks must not reopen at
  await open(page, 10);
  const shown = await bars();
  await sleep(3600);
  const hidden = await bars();
  // Any mouse movement brings them back, not a hot strip (SLN-663)
  await page.mouse.move(700, 450);
  await page.mouse.move(720, 460);
  await sleep(400);
  const back = await bars();
  const ok = shown.length === 2 && shown.every(Boolean) && hidden.every((v) => !v) && back.every(Boolean);
  record(name, "bars", "show on open, hide together, come back together on a mouse move", ok, `${JSON.stringify(shown)} ${JSON.stringify(hidden)} ${JSON.stringify(back)}`);
  await sleep(3600);
  // A click in the text never turns the page (SLN-662); the edge button does.
  // The clicks stay off the 12% edge strips: headless Chrome reads as a tablet,
  // where tapping the edges turns by default.
  const start = await page.evaluate(readState);
  for (const [x, y] of [[300, 300], [300, 314], [720, 400], [1100, 300], [1100, 314], [200, 450], [1240, 450]]) {
    await page.mouse.click(x, y);
    await sleep(120);
  }
  const clicked = await moved(page, start.fraction);
  record(name, "bars", "a click anywhere in the text keeps the place", clicked.fraction === start.fraction, `${start.fraction?.toFixed(3)} → ${clicked.fraction?.toFixed(3)}`);
  await page.mouse.move(1380, 450);
  await page.mouse.move(1410, 452);
  await sleep(300);
  await page.getByRole("button", { name: "Next page" }).click();
  const edge = await moved(page, clicked.fraction);
  record(name, "bars", "the Next page button at the edge turns forward", edge.fraction > clicked.fraction, `${clicked.fraction?.toFixed(3)} → ${edge.fraction?.toFixed(3)}`);
  await context.close();
}

/** A word and its line in the first loaded section, in viewport pixels */
const wordAt = (page) =>
  page.evaluate(() => {
    const { doc } = document.querySelector("foliate-view").renderer.getContents()[0];
    const host = doc.defaultView.frameElement.getBoundingClientRect();
    const visible = (rect) => rect.width > 0 && host.left + rect.left > 0 && host.left + rect.right < innerWidth * 0.8;
    for (const p of doc.querySelectorAll("p")) {
      const text = p.firstChild;
      if (text?.nodeType !== 3 || text.data.length < 60) continue;
      const at = text.data.indexOf(" ", 12) + 1;
      const end = text.data.indexOf(" ", at);
      const range = doc.createRange();
      range.setStart(text, at);
      range.setEnd(text, end);
      const box = range.getBoundingClientRect();
      if (!visible(box)) continue;
      return { x: host.left + box.left + box.width / 2, y: host.top + box.top + box.height / 2, left: host.left + box.left + 1, width: box.width };
    }
    return null;
  });
/** The selected text in the book, the selection toolbar, and the place */
const selectionState = (page) =>
  page.evaluate(() => {
    const view = document.querySelector("foliate-view");
    const text = view.renderer.getContents().map(({ doc }) => doc.getSelection()?.toString() ?? "").join("").trim();
    const bar = document.querySelector('[role="toolbar"][aria-label="Selection actions"]');
    const toolbar = !!bar && !bar.closest("[inert]") && getComputedStyle(bar).opacity !== "0" && bar.getBoundingClientRect().width > 0;
    return { text, toolbar, fraction: view.lastLocation?.fraction ?? null };
  });
/** Selects a word in the first loaded section from script, as a long press would */
const selectWord = (page) =>
  page.evaluate(() => {
    const { doc } = document.querySelector("foliate-view").renderer.getContents()[0];
    const text = [...doc.querySelectorAll("p")].map((p) => p.firstChild).find((t) => t?.nodeType === 3 && t.data.length > 60);
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.data.indexOf(" ", 4));
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(range);
    doc.dispatchEvent(new Event("selectionchange"));
  });
/** A link to the notes, not covered by the reader's own controls. The Back
 * to chip stays over the bottom lines for three turns after a jump, and where
 * the link falls depends on the browser's layout: Go to page 24, then turn on
 * until it shows */
const turnToNotesLink = async (page, turn) => {
  await goto(notesDriver(page), "Page", "24");
  for (let turns = 0; turns < 12; turns++) {
    await sleep(300);
    const link = await notesLink(page);
    if (link) return link;
    const before = await page.evaluate(readState);
    await turn();
    await moved(page, before.fraction);
  }
  const at = await page.evaluate(() => document.querySelector("footer[data-reader-chrome]")?.textContent.slice(0, 40));
  throw new Error(`No uncovered notes link within twelve turns of page 24 at ${page.viewportSize().width} (ended at ${at})`);
};
const notesLink = (page) =>
  page.evaluate(() => {
    for (const { doc } of document.querySelector("foliate-view").renderer.getContents()) {
      const host = doc.defaultView.frameElement.getBoundingClientRect();
      for (const a of doc.querySelectorAll('a[href*="notes.xhtml"]')) {
        const box = a.getBoundingClientRect();
        const x = host.left + box.left + box.width / 2, y = host.top + box.top + box.height / 2;
        // Hidden bars are inert, so a press passes through them to the book.
        // On touch a press in the outer strips turns; a mouse only needs to
        // stay clear of the page buttons
        const edge = matchMedia("(pointer: coarse)").matches ? 0.15 : 0.04;
        const over = document.elementFromPoint(x, y);
        if (box.width > 0 && x > innerWidth * edge && x < innerWidth * (1 - edge) && y > 0 && y < innerHeight
          && (over?.tagName === "FOLIATE-VIEW" || !!over?.closest("[inert]"))) return { x, y };
      }
    }
    return null;
  });
const footer = (page) => page.evaluate(() => document.querySelector("footer[data-reader-chrome]")?.textContent ?? "");
const notesDriver = (page) => ({
  evaluate: (expression) => page.evaluate(expression),
  selectMode: (mode) => page.getByRole("dialog", { name: "Go to", exact: true }).getByRole("radio", { name: mode, exact: true }).click(),
  fill: (text) => page.locator("dialog[open] input").fill(text),
  commit: () => page.locator("dialog[open] input").press("Enter"),
  key: (key) => page.keyboard.press(key),
});

/** SLN-662: pointer presses select, mark and follow links; they never turn.
 * The link rows use fixture 20: the navigation check's history rows start
 * from wherever fixture 19 was left. */
async function checkPointer(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  await open(page, 6);
  await sleep(400);
  const word = await wordAt(page);
  if (!word) throw new Error("No word on the first page");
  const start = await selectionState(page);
  // A double-click selects the word and looks it up; Escape closes the lookup
  await page.mouse.dblclick(word.x, word.y);
  await sleep(500);
  const double = await selectionState(page);
  record(name, "pointer", "1440: a double-click selects a word and keeps the place",
    double.text.length > 0 && !double.text.includes(" ") && double.fraction === start.fraction, `"${double.text}", ${start.fraction?.toFixed(3)} → ${double.fraction?.toFixed(3)}`);
  await page.keyboard.press("Escape");
  await sleep(300);
  // Low in the text column, clear of the toolbar above the selection
  await page.mouse.click(word.x, 760);
  await sleep(500);
  const closed = await selectionState(page);
  record(name, "pointer", "1440: with a selection, a click in the text clears it and keeps the place",
    double.toolbar && !closed.toolbar && !closed.text && closed.fraction === start.fraction, `toolbar ${double.toolbar} → ${closed.toolbar}, "${closed.text.slice(0, 20)}", ${closed.fraction?.toFixed(3)}`);
  const drag = async () => {
    await page.mouse.move(word.left, word.y);
    await page.mouse.down();
    await page.mouse.move(word.left + 220, word.y, { steps: 10 });
    await page.mouse.up();
    await sleep(500);
    return selectionState(page);
  };
  const dragged = await drag();
  record(name, "pointer", "1440: a drag selects and keeps the place",
    dragged.text.includes(" ") && dragged.toolbar && dragged.fraction === start.fraction, `"${dragged.text.slice(0, 30)}", toolbar ${dragged.toolbar}, ${dragged.fraction?.toFixed(3)}`);
  // The margin beside the text, above the Next page button
  await page.mouse.click(1400, 220);
  await sleep(500);
  const margin = await selectionState(page);
  record(name, "pointer", "1440: with a selection, a click in the margin clears it and keeps the place",
    !margin.toolbar && !margin.text && margin.fraction === start.fraction, `toolbar ${margin.toolbar}, ${margin.fraction?.toFixed(3)}`);
  // The mouse rests in the right margin: once the bars hide, only its button stays
  await page.mouse.move(1405, 300);
  await page.mouse.move(1410, 306);
  await sleep(3700);
  const edges = await page.evaluate(() => {
    const up = (el) => !!el && !el.inert && !el.closest("[inert]") && getComputedStyle(el).opacity !== "0";
    return { bars: up(document.querySelector("header[data-reader-chrome]")),
      next: up(document.querySelector('[aria-label="Next page"]')), previous: up(document.querySelector('[aria-label="Previous page"]')) };
  });
  record(name, "pointer", "1440: once the bars hide, the button of the margin the mouse rests in stays up",
    !edges.bars && edges.next && !edges.previous, JSON.stringify(edges));
  await open(page, 20);
  const link = await turnToNotesLink(page, () => page.keyboard.press("ArrowRight"));
  await page.mouse.click(link.x, link.y);
  await page.waitForFunction(() => document.querySelector("footer[data-reader-chrome]")?.textContent.includes("Outside the reading order"), null, { timeout: 5000 }).catch(() => {});
  record(name, "pointer", "1440: a click on a link follows it", (await footer(page)).includes("Outside the reading order"), (await footer(page)).slice(0, 60));
  await context.close();
  if (name === "firefox") return; // Firefox has no touch emulation in Playwright
  const phoneContext = await browser.newContext(phone(name));
  const touch = await phoneContext.newPage();
  await open(touch, 6);
  await sleep(400);
  const before = await selectionState(touch);
  // A long press in the middle of the text: Playwright has none, so the touches are sent to the book's page
  await touch.evaluate(async () => {
    const { doc } = document.querySelector("foliate-view").renderer.getContents()[0];
    const win = doc.defaultView, target = doc.body;
    const point = (x, y) => (doc.createTouch ? doc.createTouch(win, target, 1, x, y, x, y) : new win.Touch({ identifier: 1, target, clientX: x, clientY: y }));
    const list = (...touches) => (doc.createTouchList ? doc.createTouchList(...touches) : touches);
    const fire = (type, down) =>
      target.dispatchEvent(new win.TouchEvent(type, { bubbles: true, cancelable: true, touches: down ? list(point(win.innerWidth * 0.9, 300)) : list(), changedTouches: list(point(win.innerWidth * 0.9, 300)) }));
    fire("touchstart", true);
    await new Promise((r) => setTimeout(r, 800));
    fire("touchend", false);
  });
  const pressed = await moved(touch, before.fraction, 1500);
  record(name, "pointer", "390: a long press keeps the place", pressed.fraction === before.fraction, `${before.fraction?.toFixed(3)} → ${pressed.fraction?.toFixed(3)}`);
  await selectWord(touch);
  await sleep(500);
  const selected = await selectionState(touch);
  await touch.touchscreen.tap(390 * 0.95, 420);
  await sleep(600);
  const tapped = await selectionState(touch);
  record(name, "pointer", "390: with a selection, a tap in an edge strip clears it and does not turn",
    !!selected.text && !tapped.text && !tapped.toolbar && tapped.fraction === before.fraction, `"${selected.text}" → "${tapped.text}", ${before.fraction?.toFixed(3)} → ${tapped.fraction?.toFixed(3)}`);
  await open(touch, 20);
  const phoneLink = await turnToNotesLink(touch, () => touch.touchscreen.tap(390 * 0.95, 420));
  await touch.touchscreen.tap(phoneLink.x, phoneLink.y);
  await touch.waitForFunction(() => document.querySelector("footer[data-reader-chrome]")?.textContent.includes("Outside the reading order"), null, { timeout: 5000 }).catch(() => {});
  record(name, "pointer", "390: a tap on a link follows it", (await footer(touch)).includes("Outside the reading order"), (await footer(touch)).slice(0, 60));
  await phoneContext.close();
}

/** Rectangles drawn by the PDF marks overlay, over every page frame */
const pdfMarkRects = async (page) => {
  let count = 0;
  for (const frame of page.frames())
    if (frame !== page.mainFrame())
      count += await frame.evaluate(() => document.querySelectorAll("[data-durtal-pdf-marks] rect").length).catch(() => 0);
  return count;
};

async function checkPdfMarks(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  await open(page, 2);
  let line = null;
  for (let i = 0; i < 40 && !line; i++) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      line = await frame.evaluate(() => {
        const span = [...document.querySelectorAll(".textLayer span")].filter((s) => s.textContent.trim().length > 20)[6];
        if (!span) return null;
        const host = window.frameElement.getBoundingClientRect(), box = span.getBoundingClientRect();
        const scale = host.width / (window.frameElement.offsetWidth || host.width);
        // 4 px in: Chromium can leave a drag collapsed when it starts on a glyph's exact midpoint
        return { left: host.left + box.left * scale + 4, right: host.left + box.right * scale - 2, y: host.top + (box.top + box.height / 2) * scale };
      }).catch(() => null);
      if (line) break;
    }
    if (!line) await sleep(250);
  }
  if (!line) throw new Error("No PDF text layer line");
  const before = await pdfMarkRects(page);
  // Marks take no pointer events, so the drag selects even across an earlier run's mark
  await page.mouse.move(line.left, line.y);
  await page.mouse.down();
  await page.mouse.move(line.right, line.y, { steps: 8 });
  await page.mouse.up();
  await page.locator('[role="toolbar"][aria-label="Selection actions"] [aria-label="Highlight in sage"]').click({ timeout: 5000 });
  await page.waitForFunction(
    (count) => [...document.querySelectorAll("iframe")].reduce((n, f) => n + (f.contentDocument?.querySelectorAll("[data-durtal-pdf-marks] rect").length ?? 0), 0) > count,
    before, { timeout: 8000 },
  ).catch(() => {});
  const drawn = await pdfMarkRects(page);
  record(name, "pdfmarks", "a new PDF highlight is drawn on its page", drawn > before, `${before} → ${drawn} rectangles`);
  await page.reload();
  await page.waitForSelector('[data-reader="ready"]', { timeout: 60_000 });
  await page.waitForFunction(
    (count) => [...document.querySelectorAll("iframe")].reduce((n, f) => n + (f.contentDocument?.querySelectorAll("[data-durtal-pdf-marks] rect").length ?? 0), 0) >= count,
    drawn, { timeout: 10_000 },
  ).catch(() => {});
  const reloaded = await pdfMarkRects(page);
  record(name, "pdfmarks", "PDF highlights are drawn again after a reload", reloaded >= drawn, `${drawn} → ${reloaded} rectangles`);
  await context.close();
}

async function checkDialogs(name, browser) {
  const context = await browser.newContext(phone(name));
  const page = await context.newPage();
  await open(page, 1);
  for (const label of ["Contents", "Settings"]) {
    await revealBars(page);
    const button = page.getByRole("button", { name: label });
    await button.click();
    await page.waitForSelector("dialog[open]");
    await sleep(200);
    // A modal <dialog> lets Tab pass through the browser's own controls (the body here) on its way round
    const inside = () =>
      page.evaluate(() => document.activeElement === document.body || !!document.querySelector("dialog[open]")?.contains(document.activeElement));
    let trapped = await page.evaluate(() => !!document.querySelector("dialog[open]")?.contains(document.activeElement));
    for (let i = 0; i < 12 && trapped; i++) {
      await page.keyboard.press("Tab");
      trapped = await inside();
    }
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"), null, { timeout: 3000 }).catch(() => {});
    const closed = await page.evaluate(() => !document.querySelector("dialog[open]"));
    const returned = await button.evaluate((el) => el === document.activeElement);
    record(name, "dialogs", `${label}: focus kept inside, Escape closes, focus back on its button`, trapped && closed && returned, `inside ${trapped}, closed ${closed}, back ${returned}`);
  }
  await context.close();
}

// The large fixtures of preview-local.py --reader-large
const LARGE = [
  { n: 15, name: "50 MB illustrated EPUB" },
  { n: 16, name: "300 MB scanned PDF" },
];
const ENDURANCE_TURNS = 300;

async function checkEndurance(name, browser) {
  const context = await browser.newContext(phone(name));
  for (const fixture of LARGE) {
    const page = await context.newPage();
    let crashed = false;
    let loads = 0;
    page.on("crash", () => (crashed = true));
    page.on("load", () => loads++);
    const opened = await open(page, fixture.n).catch((error) => ({ state: `failed: ${error.message.split("\n")[0]}`, fraction: null }));
    if (opened.state !== "ready") {
      record(name, "endurance", `${fixture.name} opens`, false, JSON.stringify(opened));
      await page.close();
      continue;
    }
    loads = 0;
    let fraction = opened.fraction;
    let turned = 0;
    let stuck = 0;
    for (let i = 0; i < ENDURANCE_TURNS && !crashed; i++) {
      await page.keyboard.press("ArrowRight").catch(() => (crashed = true));
      const now = await moved(page, fraction).catch(() => null);
      if (!now) crashed = true;
      else if (now.fraction !== fraction) turned++;
      // At the last page a turn has nowhere to go
      else if ((now.fraction ?? 0) < 0.999) stuck++;
      fraction = now?.fraction ?? fraction;
    }
    const alive = !crashed && (await page.evaluate(readState).catch(() => null))?.state === "ready";
    const ok = alive && loads === 0 && stuck === 0;
    record(name, "endurance", `${fixture.name}: ${ENDURANCE_TURNS} turns at 390 px`, ok, `${turned} moved, ${stuck} stuck, ${loads} reloads${crashed ? ", crashed" : ""}`);
    await page.close();
  }
  await context.close();
}

/** Every frame painted while `action` runs, as base64 PNGs, with one before */
async function paintedFrames(page, name, action) {
  const shots = [];
  let cdp = null;
  let shooting = null;
  let stop = false;
  if (name === "chromium") {
    cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      shots.push(data);
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  } else {
    // A screenshot paints the page as it is, even while a View Transition's
    // update runs, when the screen still shows the snapshot taken before it;
    // a shot taken then is left out
    await page.evaluate(() => {
      const start = document.startViewTransition?.bind(document);
      if (!start) return;
      window.__inUpdate = 0;
      document.startViewTransition = (update) => start(async () => {
        window.__inUpdate++;
        try {
          return await update?.();
        } finally {
          window.__inUpdate--;
        }
      });
    });
    const inUpdate = () => page.evaluate(() => window.__inUpdate > 0).catch(() => false);
    shooting = (async () => {
      while (!stop) {
        const before = await inUpdate();
        const shot = (await page.screenshot()).toString("base64");
        if (!before && !(await inUpdate())) shots.push(shot);
      }
    })();
  }
  await sleep(400);
  await action();
  await sleep(600);
  stop = true;
  await shooting;
  if (cdp) {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
  }
  return shots;
}

/** How much each frame varies inside `rect`: a blank page is one flat colour */
async function frameVariation(context, shots, rect) {
  const page = await context.newPage();
  try {
    return await page.evaluate(async ({ shots, rect }) => {
      const canvas = new OffscreenCanvas(Math.ceil(rect.width / 4), Math.ceil(rect.height / 4));
      const g = canvas.getContext("2d", { willReadFrequently: true });
      const out = [];
      for (const shot of shots) {
        const blob = await (await fetch(`data:image/png;base64,${shot}`)).blob();
        const image = await createImageBitmap(blob);
        const scale = image.width / innerWidth || 1;
        g.drawImage(image, rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale, 0, 0, canvas.width, canvas.height);
        const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0, squares = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += y;
          squares += y * y;
        }
        out.push(Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)));
      }
      return out;
    }, { shots, rect });
  } finally {
    await page.close();
  }
}

// A frame is blank below 15% of the first frame's variation. Headless
// Chromium's screencast and WebKit's screenshots can show one blank frame as
// a View Transition takes its snapshot, with the unchanged page on the frames
// either side, even for a transition that changes nothing; a lone blank frame
// like that is counted apart, not as the page going blank.
function blankFrames(variation) {
  const baseline = variation[0];
  const isBlank = (value) => value < baseline * 0.15;
  const unchanged = (value) => value !== undefined && value >= baseline * 0.9;
  let blank = 0;
  let ignored = 0;
  variation.forEach((value, i) => {
    if (!isBlank(value)) return;
    if (unchanged(variation[i - 1]) && unchanged(variation[i + 1])) ignored++;
    else blank++;
  });
  return { blank, ignored };
}

async function checkTurns(name, browser) {
  if (name === "firefox") return; // headless Firefox captures leave out the View Transition layers
  const cases = [
    // Go to keeps its dialog up until the page opens, so the jump measured is
    // the one back, which has none
    {
      n: 1,
      label: "a jump back from a far page of the EPUB 3",
      prepare: (page) => goto(navigationDriver(page), "Page", "1500"),
      run: (page) => page.keyboard.press("Alt+ArrowLeft"),
    },
    { n: 2, label: "a turn of the text PDF", run: (page) => page.keyboard.press("ArrowRight") },
    { n: 7, label: "a turn of the comic", run: (page) => page.keyboard.press("ArrowRight") },
  ];
  for (const width of [1440, 390]) {
    for (const { n, label, prepare, run } of cases) {
      await resetFixturePosition(n);
      const context = await browser.newContext(width === 390 ? phone(name) : desktop);
      const page = await context.newPage();
      try {
        const opened = await open(page, n);
        if (opened.state !== "ready") throw new Error(`the book did not open (${opened.state})`);
        await sleep(1500);
        await prepare?.(page);
        // The bars hide once the mouse rests
        if (width !== 390) await page.mouse.move(width / 2, 450);
        await sleep(3600);
        const rect = await page.evaluate(() => {
          const box = document.querySelector("foliate-view").getBoundingClientRect();
          return { x: box.x, y: box.y + box.height * 0.1, width: box.width, height: box.height * 0.8 };
        });
        const start = await page.evaluate(readState);
        const shots = await paintedFrames(page, name, () => run(page));
        const after = await page.evaluate(readState);
        const variation = await frameVariation(context, shots, rect);
        const baseline = variation[0];
        const { blank, ignored } = blankFrames(variation);
        record(name, "turns", `${width}: no blank frame during ${label}`,
          shots.length > 1 && baseline > 0 && after.fraction !== start.fraction && blank === 0,
          `${blank} of ${shots.length} frames blank${ignored ? `, ${ignored} lone capture frame${ignored > 1 ? "s" : ""} ignored` : ""} (lowest ${Math.min(...variation).toFixed(1)} against ${baseline?.toFixed(1)}), ${start.fraction?.toFixed(3)} → ${after.fraction?.toFixed(3)}`);
      } catch (error) {
        record(name, "turns", `${width}: no blank frame during ${label}`, false, error.message.split("\n")[0]);
      } finally {
        await context.close();
      }
    }
  }
}

const navigationDriver = (page) => ({
  evaluate: (expression) => page.evaluate(expression),
  selectMode: (mode) => page.getByRole("dialog", { name: "Go to", exact: true }).getByRole("radio", { name: mode, exact: true }).click(),
  fill: (text) => page.locator("dialog[open] input").fill(text),
  commit: () => page.locator("dialog[open] input").press("Enter"),
  key: (key) => page.keyboard.press(key),
});

const RUN = {
  turns: checkTurns,
  pdfmarks: checkPdfMarks,
  opens: checkOpens,
  script: checkScript,
  font: checkFont,
  direction: checkDirection,
  place: checkPlace,
  touch: checkTouch,
  bars: checkBars,
  pointer: checkPointer,
  dialogs: checkDialogs,
  navigation: async (name, browser) => {
    for (const width of WIDTHS) {
      const context = await browser.newContext(width === 390 ? phone(name) : { viewport: { width, height: 900 } });
      const page = await context.newPage();
      try {
        await checkNavigation({
          historyFixture: 19,
          open: n => open(page, n),
          evaluate: expression => page.evaluate(expression),
          selectMode: mode => page.getByRole("dialog", { name: "Go to", exact: true }).getByRole("radio", { name: mode, exact: true }).click(),
          fill: text => page.locator("dialog[open] input").fill(text),
          commit: () => page.locator("dialog[open] input").press("Enter"),
          key: (key, _code, modifiers = 0) => page.keyboard.press((modifiers & 1 ? "Alt+" : "") + key),
        });
        record(name, "navigation", width + " contents, pages, notes, history and ends", true);
      } catch (error) { record(name, "navigation", width + " functional assertions", false, error.message); }
      finally { await context.close(); }
    }
  },
  endurance: checkEndurance,
};

for (const name of browsers) {
  const launch = {
    chromium: () => chromium.launch({ executablePath: process.env.CHROME || undefined }),
    webkit: () => webkit.launch({ executablePath: process.env.WEBKIT || undefined }),
    firefox: () => firefox.launch(firefoxLaunchOptions()),
  }[name];
  if (!launch) throw new Error(`Unknown browser ${name}: chromium, webkit or firefox`);
  const browser = await launch();
  for (const check of CHECKS.filter((c) => only.includes(c))) {
    try {
      await RUN[check](name, browser);
    } catch (error) {
      record(name, check, "ran", false, error.message.split("\n")[0]);
    }
  }
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} of ${results.length} checks passed${failures.length ? `; failures:\n  ${failures.join("\n  ")}` : ""}`);
process.exit(failures.length ? 1 : 0);
