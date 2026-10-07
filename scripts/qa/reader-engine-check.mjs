#!/usr/bin/env node
/**
 * Reader engine check (eBooks sub-issue 3): the engine's contract with the
 * reading view, in headless Chrome (DevTools protocol), WebKit (standing in
 * for Safari) and Firefox (WebDriver BiDi), all driven by playwright-core:
 *
 *   opens      every fixture opens at its first text, at 1440, 768 and 390 px;
 *              the corrupt zip shows the error state and the DRM book the
 *              cannot-be-read state
 *   script     the scripted EPUB's inline and file scripts never run: their
 *              globals stay unset in the page and in every section frame
 *   font       with "Original" fonts the obfuscated font loads on a secure
 *              origin; on plain http (Chrome: durtal.test mapped to this
 *              computer) it cannot be decoded and the book still opens
 *   direction  after a click into the text, → turns forward in a
 *              left-to-right book and ← in the right-to-left and vertical
 *              Japanese ones, and the other key turns back
 *   place      a saved place reopens at the same first visible words; at
 *              390 px with touch, also when the tab was only hidden before it
 *              closed (the save goes out with sendBeacon)
 *   touch      at 390 px with touch (Chrome, WebKit): the right zone turns
 *              forward, the left back, a swipe to the left forward
 *   bars       both bars show on open, hide together after 3 s and come back
 *              together on a tap in the middle
 *   dialogs    Contents and Settings take focus, keep Tab inside, close with
 *              Escape and give focus back to their button
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
 * Firefox from $FIREFOX, else Playwright's build, else the system Firefox.
 * Exits 1 on any failure.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const base = option("--base", "http://127.0.0.1:3410").replace(/\/$/, "");
const browsers = option("--browsers", "chromium,webkit,firefox").split(",");
const CHECKS = ["opens", "script", "font", "direction", "place", "touch", "bars", "dialogs", "endurance"];
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

/** Playwright's own Firefox build, else none (the moz-firefox channel then finds the system Firefox) */
function findFirefox() {
  if (process.env.FIREFOX) return process.env.FIREFOX;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (const build of existsSync(dir) ? readdirSync(dir).sort().reverse() : []) {
    if (!build.startsWith("firefox-")) continue;
    for (const bin of ["firefox/firefox", "firefox/Nightly.app/Contents/MacOS/firefox"]) {
      if (existsSync(join(dir, build, bin))) return join(dir, build, bin);
    }
  }
  return undefined;
}

// The fixtures scripts/qa/preview-local.py --seed-reader stores, by e-book id
const ebook = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const FIXTURES = [
  { n: 1, name: "EPUB 3", first: "Chapter 1" },
  { n: 2, name: "text PDF", text: true },
  { n: 3, name: "MOBI", first: "Contents" },
  { n: 4, name: "FB2", first: "Chapter 1" },
  { n: 5, name: "EPUB 2", first: "Chapter 1" },
  { n: 6, name: "AZW3", first: "Chapter 1" },
  { n: 7, name: "CBZ", image: true },
  { n: 8, name: "right-to-left EPUB", first: "الفصل 1" },
  { n: 9, name: "vertical Japanese EPUB", first: "第1章" },
  { n: 10, name: "obfuscated-font EPUB", first: "Chapter 1" },
  { n: 11, name: "scripted EPUB", first: "Chapter 1" },
];
const CORRUPT = 12;
const DRM = 13;
const WIDTHS = [1440, 768, 390];

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

/** Opens Settings and picks a font, then closes it */
async function pickFont(page, label) {
  await page.mouse.move(720, 8);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: label }).click();
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
  let s = await open(page, 10);
  await pickFont(page, "Original");
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
  const insecure = await chromium.launch({ args: [`--host-resolver-rules=MAP durtal.test 127.0.0.1`] });
  const http = await (await insecure.newContext(desktop)).newPage();
  s = await open(http, 10, `http://durtal.test:${target.port || 80}`).catch((error) => ({ state: `failed: ${error.message}` }));
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
  await page.touchscreen.tap(width * 0.85, 420);
  const right = await moved(page, start.fraction);
  await page.touchscreen.tap(width * 0.15, 420);
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
  record(name, "touch", "390: the right zone turns forward", right.fraction > start.fraction, `${start.fraction?.toFixed(3)} → ${right.fraction?.toFixed(3)}`);
  record(name, "touch", "390: the left zone turns back", left.fraction < right.fraction, `${right.fraction?.toFixed(3)} → ${left.fraction?.toFixed(3)}`);
  record(name, "touch", "390: a swipe to the left turns forward", swiped.fraction > left.fraction, `${left.fraction?.toFixed(3)} → ${swiped.fraction?.toFixed(3)}`);
  await context.close();
}

async function checkBars(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  const bars = () =>
    page.evaluate(() => [...document.querySelectorAll("[data-reader-chrome]")].map((el) => !el.inert && getComputedStyle(el).opacity !== "0"));
  await open(page, 5);
  const shown = await bars();
  await sleep(3600);
  const hidden = await bars();
  await page.mouse.click(720, 450);
  await sleep(400);
  const back = await bars();
  const ok = shown.length === 2 && shown.every(Boolean) && hidden.every((v) => !v) && back.every(Boolean);
  record(name, "bars", "show on open, hide together, come back together", ok, `${JSON.stringify(shown)} ${JSON.stringify(hidden)} ${JSON.stringify(back)}`);
  await context.close();
}

async function checkDialogs(name, browser) {
  const context = await browser.newContext(desktop);
  const page = await context.newPage();
  await open(page, 1);
  for (const label of ["Contents", "Settings"]) {
    await page.mouse.move(720, 8);
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

const RUN = {
  opens: checkOpens,
  script: checkScript,
  font: checkFont,
  direction: checkDirection,
  place: checkPlace,
  touch: checkTouch,
  bars: checkBars,
  dialogs: checkDialogs,
  endurance: checkEndurance,
};

for (const name of browsers) {
  const launch = {
    chromium: () => chromium.launch(),
    webkit: () => webkit.launch(),
    firefox: () => firefox.launch({ channel: "moz-firefox", executablePath: findFirefox() }),
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
