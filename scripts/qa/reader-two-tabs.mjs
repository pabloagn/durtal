#!/usr/bin/env node
/**
 * Two reader tabs in a fresh browser (SLN-668): one device id, and the newest
 * place wins everywhere without the tabs fighting. In headless Chrome, WebKit
 * and Firefox, each with a new profile (no durtal-device cookie):
 *
 *   one id     two tabs open the same e-book at the same moment; the app makes
 *              one durtal-device id for both (two first requests used to make
 *              two, and the losing tab kept the stale one), the browser keeps
 *              it, and every place and sitting request from either tab names
 *              it (X-Durtal-Expected-Device)
 *   newest     tab A turns two pages, then tab B four; with both still open
 *              the stored place is B's, and stays B's after A closes (its
 *              leave save must not put its older place back)
 *   reopen     a third tab opens at B's place, not A's
 *   quiet      no place, sitting or annotation request is refused, and
 *              neither tab shows "Sync paused" or a device notice
 *
 *   node scripts/qa/reader-two-tabs.mjs [--base http://127.0.0.1:3410]
 *        [--browsers chromium,webkit,firefox]
 *
 * Needs a preview with the reader fixtures: pnpm build, then
 * scripts/qa/preview-local.py --start --s3-dir DIR --seed-reader. It saves
 * places, so it refuses any host but this computer, and port 3100 (the live
 * app). Before each browser it removes the saved places of the EPUB 3 fixture
 * only, through the disposable preview's database bridge (as
 * reader-engine-check.mjs does). Exits 1 on any failure.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const base = option("--base", "http://127.0.0.1:3410").replace(/\/$/, "");
const browsers = option("--browsers", "chromium,webkit,firefox").split(",");

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

// The EPUB 3 fixture scripts/qa/preview-local.py --seed-reader stores, linked
// to a seeded book's copy, so its sittings are tracked as well as its places
const EBOOK = "00000000-0000-4000-a000-000000000001";
const FILE = "00000000-0000-4000-a000-f00000000001";
const DEVICE_HEADER = "x-durtal-expected-device";

let previewBridge;
/** Removes the fixture's saved places, and nothing else */
async function resetPlaces() {
  previewBridge ??= (async () => {
    const state = JSON.parse(readFileSync(join(tmpdir(), `durtal-preview-${target.port || 80}.json`), "utf8"));
    if (!state.s3Dir || typeof state.databaseUrl !== "string")
      throw new Error("Place reset requires the seeded disposable preview state");
    // The preview's own guard: loopback host and /durtal_preview only
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = state.databaseUrl;
    try { await import(new URL("./neon-local-bridge.mjs", import.meta.url).href); }
    finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  })();
  await previewBridge;
  const response = await fetch("http://127.0.0.1/sql", {
    method: "POST",
    body: JSON.stringify({
      query: `with fixture as (
        select e.id from ebooks e join ebook_files f on f.ebook_id = e.id
        where e.id = $1::uuid and e.import_source = 'folder' and e.import_ref = 'fixtures/epub3.epub'
          and e.authors = ARRAY['Durtal Fixtures']::text[] and f.id = $2::uuid
      ), removed as (
        delete from ebook_positions p using fixture f where p.ebook_id = f.id returning p.id
      ) select exists(select 1 from fixture)`,
      params: [EBOOK, FILE],
    }),
  });
  if (!response.ok || (await response.json()).rows?.[0]?.[0] !== "t")
    throw new Error("Place reset refused: the seeded fixture did not match");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function record(browser, check, what, ok, detail = "") {
  if (!ok) failures.push(`${browser} ${check} ${what}: ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${browser.padEnd(8)} ${check.padEnd(7)} ${what}${detail ? `  (${detail})` : ""}`);
}

function readState() {
  const location = document.querySelector("foliate-view")?.lastLocation;
  return {
    fraction: location?.fraction ?? null,
    cfi: location?.cfi ?? null,
    first: location?.range ? location.range.toString().replace(/\s+/g, " ").trim().slice(0, 48) : null,
  };
}

async function opened(page) {
  await page.waitForSelector('[data-reader="ready"], [data-reader="error"]', { timeout: 60_000 });
  await page.waitForFunction(() => !!document.querySelector("foliate-view")?.lastLocation, null, { timeout: 10_000 });
  return page.evaluate(readState);
}

async function turn(page, times) {
  await page.bringToFront();
  await page.mouse.click(720, 450);
  await sleep(300);
  let state = await page.evaluate(readState);
  for (let i = 0; i < times; i++) {
    const before = state.fraction;
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((f) => document.querySelector("foliate-view")?.lastLocation?.fraction !== f, before, { timeout: 4000 }).catch(() => {});
    await sleep(150);
    state = await page.evaluate(readState);
  }
  return state;
}

/** A range's start, as a stored place keeps it: epubcfi(/6/6!/4,/2,/8) is epubcfi(/6/6!/4/2) */
const startOf = (cfi) => cfi?.replace(/^epubcfi\((.*?),(.*?),.*\)$/, "epubcfi($1$2)") ?? null;

/** This browser's stored place, as the reader's own route answers it */
async function storedPlace(context) {
  const response = await context.request.get(`${base}/api/reader/${EBOOK}/position`);
  const { positions = [] } = await response.json();
  return { mine: positions.find((p) => p.thisDevice) ?? null, devices: new Set(positions.map((p) => p.deviceId)) };
}

const notices = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"]')]
    .map((el) => el.textContent.trim())
    .filter((text) => /sync paused|device changed|could not be saved/i.test(text)));

async function run(name, launcher, launchOptions) {
  const browser = await launcher.launch({ headless: true, ...launchOptions });
  try {
    await resetPlaces();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const requests = [];
    const refused = [];
    context.on("request", (request) => {
      if (/\/api\/reader\/[^/]+\/(position|session|annotations)/.test(request.url()) && request.method() === "POST")
        requests.push({ url: request.url(), device: request.headers()[DEVICE_HEADER] ?? null });
    });
    const minted = [];
    context.on("response", (response) => {
      if (new URL(response.url()).origin === new URL(base).origin)
        void response.headerValue("set-cookie").then((value) => {
          const id = value?.match(/durtal-device=([^;]+)/)?.[1];
          if (id) minted.push(id);
        });
      if (/\/api\/reader\//.test(response.url()) && response.status() >= 400)
        refused.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
    });
    const a = await context.newPage();
    const b = await context.newPage();
    // Both first requests leave without a cookie
    await Promise.all([a.goto(`${base}/reader/${EBOOK}`), b.goto(`${base}/reader/${EBOOK}`)]);
    await Promise.all([opened(a), opened(b)]);

    const atA = await turn(a, 2);
    await sleep(3000);
    const atB = await turn(b, 4);
    await sleep(3000);
    // Both tabs open, A idle: the stored place is B's
    await a.bringToFront();
    await sleep(2500);
    const both = await storedPlace(context);
    await a.close({ runBeforeUnload: true });
    await sleep(1500);
    const afterClose = await storedPlace(context);

    const cookies = (await context.cookies(base)).filter((c) => c.name === "durtal-device");
    const id = cookies[0]?.value ?? null;
    const stray = [...new Set(requests.map((r) => r.device).filter((device) => device && device !== id))];
    record(name, "one id", "one device id is made for both first requests", new Set(minted).size === 1 && minted[0] === id,
      `${new Set(minted).size} made`);
    record(name, "one id", "the browser keeps one device id", cookies.length === 1 && both.devices.size <= 1 && afterClose.devices.size <= 1,
      `${cookies.length} cookie(s), ${afterClose.devices.size} stored device(s)`);
    record(name, "one id", "every request from both tabs names that id", requests.length > 0 && stray.length === 0,
      `${requests.length} requests${stray.length ? `, ${stray.length} other id(s)` : ""}`);
    record(name, "newest", "with both tabs open the stored place is B's", startOf(both.mine?.locator?.cfi) === startOf(atB.cfi) && startOf(atA.cfi) !== startOf(atB.cfi),
      `A at ${atA.cfi}, B at ${atB.cfi}, stored ${both.mine?.locator?.cfi ?? "none"}`);
    record(name, "newest", "after A closes it is still B's", startOf(afterClose.mine?.locator?.cfi) === startOf(atB.cfi),
      `stored ${afterClose.mine?.locator?.cfi ?? "none"}`);

    const c = await context.newPage();
    await c.goto(`${base}/reader/${EBOOK}`);
    const atC = await opened(c);
    // B's place, not A's. The exact screen is the reopen check's (reader-engine-check.mjs
    // place): headless Firefox at 1440 can reopen a screen early with one tab too
    const nearB = Math.abs(atC.fraction - atB.fraction) < Math.abs(atC.fraction - atA.fraction);
    record(name, "reopen", "a third tab opens at B's place", nearB,
      `A at ${atA.fraction?.toFixed(3)}, B at ${atB.fraction?.toFixed(3)} "${atB.first}", opened at ${atC.fraction?.toFixed(3)} "${atC.first}"`);
    const said = [...(await notices(b)), ...(await notices(c))];
    record(name, "quiet", "no request refused and no sync notice", refused.length === 0 && said.length === 0,
      [...refused, ...said].join("; "));
    await context.close();
  } finally {
    await browser.close();
  }
}

const LAUNCHERS = {
  chromium: [chromium, { executablePath: process.env.CHROME || undefined }],
  webkit: [webkit, { executablePath: process.env.WEBKIT || undefined }],
  firefox: [firefox, firefoxLaunchOptions()],
};
for (const name of browsers) {
  const [launcher, options] = LAUNCHERS[name] ?? [];
  if (!launcher) throw new Error(`Unknown browser ${name}`);
  try {
    await run(name, launcher, options);
  } catch (error) {
    record(name, "run", "the check ran", false, error.message.split("\n")[0]);
  }
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll two-tab checks pass");
process.exit(failures.length ? 1 : 0);
