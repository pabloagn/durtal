#!/usr/bin/env node
/**
 * Interaction audit: keyboard, focus, reduced motion and touch, with real key
 * presses and touch emulation in headless Chrome, Firefox and WebKit. For each route:
 *
 *   keyboard  Tab walks the page: every stop is visible and shows a focus
 *             indicator; no positive tabindex. Each menu opens with Enter,
 *             takes focus, moves with the arrow keys and closes with Escape,
 *             focus back on its button.
 *   dialogs   Every button and menu item that opens a dialog: focus moves
 *             into the dialog, Tab stays inside it, Escape closes it and focus
 *             goes back to the control that opened it (its menu's button for
 *             a menu item).
 *   motion    With prefers-reduced-motion, nothing on the page or in a menu
 *             or dialog loops forever or moves (transform, scale, translate).
 *   touch     At 390px with a touch screen: no control only shows on hover,
 *             and every control is at least 24px or spaced as WCAG 2.5.8
 *             allows; the ones under the design's 44px are counted.
 *
 *   node scripts/qa/interaction-audit.mjs --disposable [--base http://127.0.0.1:3410] [--browsers cdp|chromium,firefox,webkit] [route...]
 *
 * It presses buttons and menu items, so it runs against a disposable database
 * only (scripts/qa/preview-local.py): it refuses to start without
 * --disposable, on any host but this computer, and on port 3100 (the live
 * app). Even there it presses only controls whose label says they open
 * something (Edit, Add, Images, Note ...; `OPENER`) and never one that
 * writes (`WRITES`: delete, save, archive, move, checked, favourite ...);
 * dialogs it opens close with Escape, unsaved. Chrome comes from $CHROME,
 * else Playwright's chrome-headless-shell cache. The default cdp driver needs
 * no package; other engines use existing playwright-core from PLAYWRIGHT_CORE
 * (or the QA/project runtime) and PLAYWRIGHT_BROWSERS_PATH. Exits 1 on any failure.
 */
import { HELPERS, dialogFocusState } from "./interaction-page.mjs";
import { effectiveTarget } from "./interaction-target.mjs";
import { createDriver } from "./interaction-driver.mjs";
import {
  installDisclosureHelpers,
  withDisclosures,
  reachByTab,
  walkKeyboard,
} from "./interaction-disclosures.mjs";

const args = process.argv.slice(2);
const disposable = args.includes("--disposable");
if (disposable) args.splice(args.indexOf("--disposable"), 1);
const baseAt = args.indexOf("--base");
const base = (
  baseAt >= 0 ? args.splice(baseAt, 2)[1] : "http://127.0.0.1:3410"
).replace(/\/$/, "");
const target = URL.parse(base);
const refusal = !target
  ? `${base} is not a URL`
  : !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password
    ? "only a local HTTP URL without credentials is allowed"
    : !disposable
      ? "it presses buttons and menu items: pass --disposable to confirm the server runs on a disposable database (scripts/qa/preview-local.py)"
      : !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
        ? `${target.hostname} is not this computer`
        : target.port === "3100"
          ? "port 3100 is the live app"
          : null;
if (refusal) {
  console.error(`Refused: ${refusal}`);
  process.exit(2);
}
const browsersAt = args.indexOf("--browsers");
const browsers = (
  browsersAt >= 0 ? args.splice(browsersAt, 2)[1] : "cdp"
).split(",");
if (
  browsers.some((b) => !["cdp", "chromium", "firefox", "webkit"].includes(b))
) {
  console.error(
    "Refused: --browsers must name cdp, chromium, firefox or webkit",
  );
  process.exit(2);
}
const routes = args.length
  ? args
  : [
      "/perfumes",
      "/films",
      "/paintings",
      "/perfumes/new",
      "/films/new",
      "/paintings/new",
      "@details",
    ];
/** Controls the audit presses: their label says they open a dialog, a panel or a form */
const OPENER =
  /^(edit|add|new|note|write|rename|change|choose|manage|images|details|adjust|link|attach|view|open)\b/i;
/** Controls it never presses, whatever else the label says: they change data or state */
const WRITES =
  /delete|remove|save|submit|favourite|archive|unarchive|move|checked|mark|restore|duplicate|set as|make |primary|verify|sync|import|refresh|clear|reset|apply|undo|confirm|download|export|upload|merge|accept|reject|dismiss|sign out|rate /i;
const pressable = (label) => OPENER.test(label) && !WRITES.test(label);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let driver;
const send = (...args) => driver.send(...args);
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.error) throw new Error(r.error.message);
  if (r.result?.exceptionDetails)
    throw new Error(
      r.result.exceptionDetails.exception?.description ?? "Page script failed",
    );
  if (!r.result?.result)
    throw new Error("Browser evaluation returned no result");
  return r.result.result.value;
}
async function waitFor(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (
      await evaluate(
        `(() => { try { return !!(${predicate}); } catch { return false; } })()`,
      )
    )
      return true;
    await sleep(100);
  }
  return false;
}
async function go(path) {
  await send("Page.navigate", { url: base + path });
  if (
    !(await waitFor(
      "document.readyState === 'complete' && !document.getElementById('S:0') && document.querySelector('main')",
    ))
  )
    throw new Error("Route did not become ready");
  if (!(await waitFor("document.fonts.status === 'loaded'")))
    throw new Error("Fonts did not become ready");
  await evaluate("document.fonts.ready.then(() => true)");
  await sleep(600);
  await evaluate(HELPERS);
  await evaluate(`(${installDisclosureHelpers.toString()})()`);
}
const KEYS = {
  Tab: { code: "Tab", keyCode: 9 },
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  " ": { code: "Space", keyCode: 32, text: " " },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
};
async function press(key, shift = false) {
  const k = KEYS[key];
  const base = {
    key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    nativeVirtualKeyCode: k.keyCode,
    modifiers: shift ? 8 : 0,
  };
  await send("Input.dispatchKeyEvent", {
    type: k.text ? "keyDown" : "rawKeyDown",
    ...base,
    ...(k.text ? { text: k.text } : {}),
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(120);
}

/** Page helpers, defined once per page load */

const failures = [];
const notes = [];
const fail = (route, check, what) =>
  failures.push(`${route}  ${check}: ${what}`);

async function setViewport(width, touch) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: touch ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: touch,
  });
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: touch,
    maxTouchPoints: touch ? 5 : 1,
  });
}

const io = { evaluate, press };
async function reachable(route, control) {
  if (await reachByTab(io, control.id)) return true;
  fail(route, "keyboard", `${control.name} is not reachable with Tab`);
  return false;
}
async function keyboard(route, scope = "page") {
  const positive = await evaluate(
    `[...__ia.element(${JSON.stringify(scope)}).querySelectorAll('[tabindex]')].filter((e) => !__ia.hidden(e) && +e.getAttribute('tabindex') > 0).map((e) => __ia.name(e))`,
  );
  for (const p of positive)
    fail(route, "keyboard", `${p} has a positive tabindex`);
  const result = await walkKeyboard({ evaluate, press }, scope);
  for (const what of result.failures) fail(route, "keyboard", what);
  notes.push(
    `${route}: ${result.stops} tab stops, ${result.expected} expected controls`,
  );
}

async function closeMenu(route, trigger) {
  // Keyboard tooltips can take the first Escape.
  for (let i = 0; i < 2 && (await evaluate("!!__ia.menu()")); i++)
    await press("Escape");
  if (await evaluate("!!__ia.menu()"))
    fail(route, "menu", `${trigger.name}: Escape does not close the menu`);
  else if ((await evaluate("__ia.id(document.activeElement)")) !== trigger.id)
    fail(
      route,
      "menu",
      `${trigger.name}: Escape does not return focus to the exact trigger`,
    );
}
async function openMenu(route, trigger, key = "Enter") {
  if (!(await reachable(route, trigger))) return false;
  await press(key);
  if (!(await waitFor("__ia.menu()", 3000))) {
    fail(route, "menu", `${key} on ${trigger.name} opens no menu`);
    return false;
  }
  if (!(await evaluate("__ia.menu().contains(document.activeElement)")))
    fail(route, "menu", `${trigger.name}: focus does not move into the menu`);
  return true;
}
async function menuTriggers(scope) {
  return evaluate(
    `[...__ia.element(${JSON.stringify(scope)}).querySelectorAll('[aria-haspopup=menu]')].filter((b) => !__ia.hidden(b) && !b.disabled).map((b) => ({ id: __ia.id(b), name: __ia.name(b) }))`,
  );
}
async function menus(route, scope = "page") {
  let checked = 0;
  for (const trigger of await menuTriggers(scope)) {
    for (const key of ["Enter", " "]) {
      try {
        if (!(await openMenu(route, trigger, key))) continue;
        checked++;
        const first = await evaluate("__ia.id(document.activeElement)");
        await press("ArrowDown");
        const second = await evaluate("__ia.id(document.activeElement)");
        const count = await evaluate(
          "__ia.menu().querySelectorAll('[role=menuitem]:not([aria-disabled=true])').length",
        );
        if (count > 1 && first === second)
          fail(
            route,
            "menu",
            `${trigger.name}: ArrowDown does not move between items`,
          );
      } finally {
        if (await evaluate("!!__ia.menu()")) await closeMenu(route, trigger);
      }
    }
  }
  notes.push(`${route}: ${checked} keyboard menu openings`);
}

async function checkDialog(route, label, expectBack) {
  if (!(await waitFor("__ia.dialog()", 2500))) return false;
  const dialog = await evaluate("__ia.id(__ia.dialog())");
  await sleep(400);
  if (!(await evaluate("__ia.dialog().contains(document.activeElement)")))
    fail(route, "dialog", `${label}: focus does not move into the dialog`);
  try {
    // Opening a dialog may reveal its own closed/nested details.
    await withDisclosures(
      {
        evaluate,
        press,
        waitFor,
        fail: (what) => fail(route, "dialog details", what),
        note: (what) => notes.push(`${route}: ${what}`),
      },
      async (scope) => {
        await keyboard(route, scope);
        await menus(route, scope);
        if (
          await evaluate(
            "matchMedia('(prefers-reduced-motion: reduce)').matches",
          )
        )
          reportMotion(route, "dialog", await evaluate(MOTION));
      },
      dialog,
    );
    let browserChromeStops = 0;
    for (let i = 0; i < 25; i++) {
      await press("Tab");
      const focus = await evaluate(
        `(${dialogFocusState.toString()})(__ia.element(${JSON.stringify(dialog)}))`,
      );
      if (!focus.valid) {
        fail(
          route,
          "dialog",
          `${label}: Tab leaves the dialog (body=${focus.body}, documentFocused=${focus.documentFocused})`,
        );
        break;
      }
      if (!focus.inside && focus.body && !focus.documentFocused)
        browserChromeStops++;
    }
    notes.push(
      `${route}: ${label}: ${browserChromeStops} measured BODY stops with document.hasFocus() false`,
    );
  } finally {
    for (let i = 0; i < 3 && (await evaluate("!!__ia.dialog()")); i++)
      await press("Escape");
  }
  if (await evaluate("!!__ia.dialog()"))
    fail(route, "dialog", `${label}: Escape does not close the dialog`);
  else if ((await evaluate("__ia.id(document.activeElement)")) !== expectBack)
    fail(
      route,
      "dialog",
      `${label}: focus does not return to the exact opener`,
    );
  return true;
}
async function chooseMenuItem(route, item) {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const active = await evaluate("__ia.id(document.activeElement)");
    if (active === item.id) return true;
    if (seen.has(active)) break;
    seen.add(active);
    await press("ArrowDown");
  }
  fail(route, "menu", `${item.label} cannot be reached with arrow keys`);
  return false;
}
async function dialogs(route, scope = "page") {
  let opened = 0;
  const buttons =
    await evaluate(`[...__ia.element(${JSON.stringify(scope)}).querySelectorAll('button,[role=button]')]
    .filter((b) => !(b.type === 'submit' && b.form) && !b.hasAttribute('aria-pressed') && !b.hasAttribute('aria-haspopup') && !b.disabled && !__ia.hidden(b))
    .map((b) => ({ id: __ia.id(b), name: __ia.name(b), label: b.getAttribute('aria-label') || b.innerText || '' }))`);
  for (const b of buttons.filter((b) => pressable(b.label))) {
    if (!(await reachable(route, b))) continue;
    const at = await evaluate("location.href");
    await press("Enter");
    if ((await evaluate("location.href")) !== at)
      throw new Error(`${b.name} navigated away; remaining checks aborted`);
    if (await checkDialog(route, b.name, b.id)) opened++;
  }
  for (const trigger of await menuTriggers(scope)) {
    if (!(await openMenu(route, trigger))) continue;
    const labels = await evaluate(
      `[...__ia.menu().querySelectorAll('[role=menuitem]')].filter((m) => m.getAttribute('aria-disabled') !== 'true').map((m, i) => ({ index: i, label: m.innerText.trim() }))`,
    );
    await closeMenu(route, trigger);
    for (const wanted of labels.filter((m) => pressable(m.label))) {
      try {
        if (!(await openMenu(route, trigger))) continue;
        const item = await evaluate(
          `(() => { const m = [...__ia.menu().querySelectorAll('[role=menuitem]')].filter((m) => m.getAttribute('aria-disabled') !== 'true')[${wanted.index}]; return m && { id: __ia.id(m), label: m.innerText.trim() }; })()`,
        );
        if (!item || item.label !== wanted.label) {
          fail(route, "menu", "menu items changed while being checked");
          continue;
        }
        if (!(await chooseMenuItem(route, item))) continue;
        const at = await evaluate("location.href");
        await press("Enter");
        if ((await evaluate("location.href")) !== at)
          throw new Error(
            `${item.label} navigated away; remaining checks aborted`,
          );
        if (
          await checkDialog(
            route,
            `${trigger.name} › ${item.label}`,
            trigger.id,
          )
        )
          opened++;
      } finally {
        if (await evaluate("!!__ia.menu()")) await closeMenu(route, trigger);
      }
    }
  }
  notes.push(`${route}: ${opened} dialogs`);
}

/** Every element whose own style animates or transitions movement, or loops, as computed now */
const MOTION = `(() => {
  const moving = /transform|scale|translate|rotate/;
  const keyframes = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => { for (const r of list) { if (r instanceof CSSKeyframesRule) keyframes.set(r.name, r.cssText); else if (r.cssRules) walk(r.cssRules); } };
    walk(rules);
  }
  const ms = (v) => Math.max(...v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000)));
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (__ia.hidden(el)) continue;
    if (s.animationName !== 'none') {
      const names = s.animationName.split(',').map((n) => n.trim());
      const loops = s.animationIterationCount.includes('infinite') && ms(s.animationDuration) > 20;
      const moves = ms(s.animationDuration) > 20 && names.some((n) => moving.test(keyframes.get(n) ?? ''));
      if (loops || moves) out.push({ what: __ia.name(el) + ' animation ' + s.animationName, loops, moves });
    }
    const props = s.transitionProperty.split(',').map((x) => x.trim());
    const durations = s.transitionDuration.split(',').map((x) => ms(x));
    if (props.some((p, i) => moving.test(p) && (durations[i] ?? durations[0]) > 20))
      out.push({ what: __ia.name(el) + ' transition ' + s.transitionProperty, loops: false, moves: true });
  }
  return out;
})()`;

function reportMotion(route, where, list) {
  for (const a of list)
    fail(
      route,
      "motion",
      `${where}: ${a.what} ${a.loops ? "loops" : "moves"} under reduced motion`,
    );
}
async function motion(route, scope = "page") {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  try {
    reportMotion(route, "page", await evaluate(MOTION));
    for (const trigger of await menuTriggers(scope)) {
      try {
        if (await openMenu(route, trigger))
          reportMotion(route, "menu", await evaluate(MOTION));
      } finally {
        if (await evaluate("!!__ia.menu()")) await closeMenu(route, trigger);
      }
    }
    await dialogs(route, scope);
  } finally {
    await send("Emulation.setEmulatedMedia", { features: [] });
  }
}

async function touch(route, scope = "page") {
  if (
    !(await evaluate(
      "matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches",
    ))
  )
    fail(
      route,
      "touch",
      "the touch emulation does not report a coarse pointer without hover",
    );
  const result = await evaluate(`(() => {
    const target = ${effectiveTarget.toString()};
    const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [tabindex="0"]')];
    const out = { hoverOnly: [], small: [], under44: 0, total: 0 };
    const targets = [];
    for (const el of controls) {
      if (el.closest('[inert], [aria-hidden=true]') || el.tagName === 'NEXTJS-PORTAL') continue;
      if (el.checkVisibility && !el.checkVisibility()) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = target(el);
      if (r.width < 1 || r.height < 1) continue;
      let hidden = false;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden') { hidden = true; break; }
        if (+s.opacity < 0.05) { out.hoverOnly.push(__ia.name(el)); hidden = true; break; }
      }
      if (hidden) continue;
      // A link inside running text is exempt (WCAG 2.5.8): its line sets its size
      if (el.tagName === 'A' && /^inline(-block)?$/.test(getComputedStyle(el).display)) {
        let block = el.parentElement;
        while (block && /^inline/.test(getComputedStyle(block).display)) block = block.parentElement;
        if (block && block.innerText.trim().length > el.innerText.trim().length + 8) continue;
      }
      // A control inside another control is one target
      if (controls.some((c) => c !== el && c.contains(el) && targets.some((t) => t.el === c))) continue;
      targets.push({ el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2, small: r.width < 23.5 || r.height < 23.5 });
    }
    // WCAG 2.5.8 spacing: an undersized target passes when a 24px circle on its
    // center touches no other target and no other undersized target's circle
    const toRect = (t, x, y) => Math.hypot(Math.max(t.r.left - x, 0, x - t.r.right), Math.max(t.r.top - y, 0, y - t.r.bottom));
    for (const t of targets) {
      if (!__ia.within(t.el, ${JSON.stringify(scope)})) continue;
      out.total++;
      if (!t.small) {
        if (t.r.width < 43.5 || t.r.height < 43.5) out.under44++;
        continue;
      }
      const crowded = targets.some((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) &&
        (toRect(o, t.cx, t.cy) < 11.5 || (o.small && Math.hypot(o.cx - t.cx, o.cy - t.cy) < 23.5)));
      if (crowded) out.small.push(__ia.name(t.el) + ' ' + Math.round(t.r.width) + '×' + Math.round(t.r.height));
      else out.under44++;
    }
    return out;
  })()`);
  for (const h of result.hoverOnly)
    fail(route, "touch", `${h} only shows on hover`);
  for (const s of result.small)
    fail(route, "touch", `${s} is under 24px and too close to another control`);
  notes.push(
    `${route}: ${result.total} touch controls, ${result.under44} between 24 and 44px`,
  );
}

async function detailRoutes() {
  const out = [];
  for (const kind of ["perfumes", "films", "paintings"]) {
    await go(`/${kind}`);
    const href = await evaluate(
      `[...document.querySelectorAll('main a[href^="/${kind}/"]')].map((a) => a.getAttribute('href')).find((h) => !/\\/(new)(\\?|$)/.test(h) && !h.includes('?'))`,
    );
    if (href) out.push(href);
    else notes.push(`/${kind}: no record, so no detail page checked`);
  }
  return out;
}

for (const browser of browsers) {
  try {
    driver = await createDriver(browser);
    await setViewport(1440, false);
    const expanded = [];
    for (const r of routes)
      expanded.push(...(r === "@details" ? await detailRoutes() : [r]));
    for (const route of expanded) {
      const labelled = `${browser} ${route}`;
      for (const [check, run] of [
        ["keyboard", keyboard],
        ["menus", menus],
        ["dialogs", dialogs],
        ["motion", motion],
        ["touch", touch],
      ]) {
        try {
          await setViewport(check === "touch" ? 390 : 1440, check === "touch");
          await go(route);
          await withDisclosures(
            {
              evaluate,
              press,
              waitFor,
              fail: (what) => fail(labelled, "details", what),
              note: (what) => notes.push(`${labelled}: ${what}`),
            },
            (scope) => run(labelled, scope),
          );
        } catch (error) {
          fail(
            labelled,
            check,
            `the check stopped: ${error.message.split("\n")[0]}`,
          );
        }
      }
      console.log(`checked ${labelled}`);
    }
  } catch (error) {
    fail(browser, "browser", error.message.split("\n")[0]);
  } finally {
    await driver
      ?.close()
      .catch((error) => fail(browser, "cleanup", error.message));
    driver = null;
  }
}
for (const n of notes) console.log(`  ${n}`);
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(
  failures.length ? `\n${failures.length} failures` : `\nNo failures`,
);
process.exit(failures.length ? 1 : 0);
