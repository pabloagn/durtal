#!/usr/bin/env node
/**
 * Interaction audit: keyboard, focus, reduced motion and touch, with real key
 * presses and touch emulation in headless Chrome. For each route:
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
 *   node scripts/qa/interaction-audit.mjs --disposable [--base http://127.0.0.1:3410] [route...]
 *
 * It presses buttons and menu items, so it runs against a disposable database
 * only (scripts/qa/preview-local.py): it refuses to start without
 * --disposable, on any host but this computer, and on port 3100 (the live
 * app). Even there it presses only controls whose label says they open
 * something (Edit, Add, Images, Note ...; `OPENER`) and never one that
 * writes (`WRITES`: delete, save, archive, move, checked, favourite ...);
 * dialogs it opens close with Escape, unsaved. Chrome comes from $CHROME,
 * else Playwright's chrome-headless-shell cache. Exits 1 on any failure.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const disposable = args.includes("--disposable");
if (disposable) args.splice(args.indexOf("--disposable"), 1);
const baseAt = args.indexOf("--base");
const base = (baseAt >= 0 ? args.splice(baseAt, 2)[1] : "http://127.0.0.1:3410").replace(/\/$/, "");
const target = URL.parse(base);
const refusal = !target
  ? `${base} is not a URL`
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
const routes = args.length ? args : ["/perfumes", "/films", "/paintings", "/perfumes/new", "/films/new", "/paintings/new", "@details"];
/** Controls the audit presses: their label says they open a dialog, a panel or a form */
const OPENER = /^(edit|add|new|note|write|rename|change|choose|manage|images|details|adjust|link|attach|view|open)\b/i;
/** Controls it never presses, whatever else the label says: they change data or state */
const WRITES = /delete|remove|save|submit|favourite|archive|unarchive|move|checked|mark|restore|duplicate|set as|make |primary|verify|sync|import|refresh|clear|reset|apply|undo|confirm|download|export|upload|merge|accept|reject|dismiss|sign out|rate /i;
const pressable = (label) => OPENER.test(label) && !WRITES.test(label);

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
  throw new Error("No Chrome found: set CHROME, or install Playwright's chrome-headless-shell");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "interaction-audit-"));
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
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

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "Page script failed");
  return r.result?.result?.value;
}
async function waitFor(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(`(() => { try { return !!(${predicate}); } catch { return false; } })()`)) return true;
    await sleep(100);
  }
  return false;
}
async function go(path) {
  await send("Page.navigate", { url: base + path });
  await waitFor("document.readyState === 'complete' && !document.getElementById('S:0') && document.querySelector('main')");
  await sleep(600);
}
const KEYS = {
  Tab: { code: "Tab", keyCode: 9 },
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
};
async function press(key, shift = false) {
  const k = KEYS[key];
  const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: shift ? 8 : 0 };
  await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(120);
}

/** Page helpers, defined once per page load */
const HELPERS = `window.__ia = {
  name(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('placeholder');
    const text = (label || el.innerText || el.value || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 50);
    return el.tagName.toLowerCase() + ' "' + text + '"';
  },
  hidden(el) {
    // What a closed <details> folds away has a box but is not rendered: it
    // cannot be focused or pressed until the reader opens it (SLN-544)
    if (el.checkVisibility && !el.checkVisibility()) return true;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) return true;
    }
    const r = el.getBoundingClientRect();
    return r.width < 1 || r.height < 1;
  },
  ring(el) {
    const s = getComputedStyle(el);
    return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? s.outlineStyle + s.outlineWidth + s.outlineColor : '',
      s.boxShadow, s.backgroundColor, s.borderColor, s.color, s.textDecorationLine].join('|');
  },
  /** Whether focus shows: the focused look differs from the same element without focus */
  focusShows(el) {
    // Transitions would still show the focused look right after the blur
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(still);
    const own = (e) => {
      const look = [this.ring(e)];
      for (const c of e.querySelectorAll('*')) look.push(this.ring(c));
      return look.join('/');
    };
    const focused = own(el);
    const parentFocused = el.parentElement ? this.ring(el.parentElement) : '';
    el.blur();
    const plain = own(el);
    const parentPlain = el.parentElement ? this.ring(el.parentElement) : '';
    el.focus({ focusVisible: true });
    still.remove();
    return focused !== plain || parentFocused !== parentPlain;
  },
  dialog() { return [...document.querySelectorAll('dialog[open], [role=dialog]')].filter((d) => !this.hidden(d)).pop() ?? null; },
  menu() { return [...document.querySelectorAll('[role=menu]')].filter((m) => !this.hidden(m)).pop() ?? null; },
};`;

const failures = [];
const notes = [];
const fail = (route, check, what) => failures.push(`${route}  ${check}: ${what}`);

async function setViewport(width, touch) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: touch ? 844 : 900, deviceScaleFactor: 1, mobile: touch });
  await send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
}

async function keyboard(route) {
  await evaluate(HELPERS);
  await evaluate("document.activeElement?.blur(); window.scrollTo(0, 0); true");
  const positive = await evaluate("[...document.querySelectorAll('[tabindex]')].filter((e) => +e.getAttribute('tabindex') > 0).map((e) => __ia.name(e))");
  for (const p of positive) fail(route, "keyboard", `${p} has a positive tabindex`);
  const seen = new Set();
  let stops = 0;
  for (let i = 0; i < 250; i++) {
    await press("Tab");
    const stop = await evaluate(`(() => {
      const el = document.activeElement;
      // Next.js's development overlay is not part of the app
      if (!el || el === document.body || el.tagName === 'NEXTJS-PORTAL') return el?.tagName === 'NEXTJS-PORTAL' ? { skip: true } : null;
      el.dataset.iaStop ??= String(${i});
      return { id: el.dataset.iaStop, name: __ia.name(el), hidden: __ia.hidden(el), shows: __ia.focusShows(el) };
    })()`);
    if (stop?.skip) continue;
    if (!stop || seen.has(stop.id)) break;
    seen.add(stop.id);
    stops++;
    if (stop.hidden) fail(route, "keyboard", `${stop.name} takes focus but cannot be seen`);
    else if (!stop.shows) fail(route, "keyboard", `${stop.name} shows no focus indicator`);
  }
  notes.push(`${route}: ${stops} tab stops`);
}

async function menus(route) {
  await evaluate(HELPERS);
  const count = await evaluate("document.querySelectorAll('[aria-haspopup=menu]').length");
  for (let i = 0; i < count; i++) {
    await go(route);
    await evaluate(HELPERS);
    const name = await evaluate(`(() => { const b = document.querySelectorAll('[aria-haspopup=menu]')[${i}]; if (!b || __ia.hidden(b)) return null; b.focus({ focusVisible: true }); return __ia.name(b); })()`);
    if (!name) continue;
    await press("Enter");
    if (!(await waitFor("__ia.menu()", 3000))) {
      fail(route, "menu", `Enter on ${name} opens no menu`);
      continue;
    }
    if (!(await evaluate("__ia.menu().contains(document.activeElement)"))) fail(route, "menu", `${name}: focus does not move into the menu`);
    const first = await evaluate("document.activeElement?.innerText");
    await press("ArrowDown");
    const second = await evaluate("document.activeElement?.innerText");
    const items = await evaluate("__ia.menu().querySelectorAll('[role=menuitem]').length");
    if (items > 1 && first === second) fail(route, "menu", `${name}: ArrowDown does not move between items`);
    await press("Escape");
    await sleep(200);
    if (await evaluate("!!__ia.menu()")) fail(route, "menu", `${name}: Escape does not close the menu`);
    else if (!(await evaluate(`__ia.name(document.activeElement) === ${JSON.stringify(name)}`)))
      fail(route, "menu", `${name}: Escape leaves focus on ${await evaluate("__ia.name(document.activeElement)")}`);
  }
}

/** Opens a dialog with `open` (focus already set on the opener), then checks focus in, trap, Escape and return */
async function checkDialog(route, label, expectBack) {
  if (!(await waitFor("__ia.dialog()", 2500))) return false;
  await sleep(400);
  const inside = await evaluate("__ia.dialog().contains(document.activeElement)");
  if (!inside) fail(route, "dialog", `${label}: focus does not move into the dialog`);
  let escaped = 0;
  for (let i = 0; i < 25; i++) {
    await press("Tab");
    if (await evaluate("document.activeElement !== document.body && !__ia.dialog()?.contains(document.activeElement)")) escaped++;
  }
  if (escaped) fail(route, "dialog", `${label}: Tab leaves the dialog`);
  // A keyboard tooltip on the focused control takes the first Escape (WCAG 1.4.13)
  if (await evaluate("!!document.querySelector('[role=tooltip]:popover-open')")) {
    await press("Escape");
    if (await evaluate("!!document.querySelector('[role=tooltip]:popover-open')")) fail(route, "dialog", `${label}: Escape does not hide the tooltip`);
  }
  await press("Escape");
  if (!(await waitFor("!__ia.dialog()", 2000))) {
    fail(route, "dialog", `${label}: Escape does not close the dialog`);
    return true;
  }
  await sleep(300);
  const now = await evaluate("__ia.name(document.activeElement)");
  if (now !== expectBack) fail(route, "dialog", `${label}: focus goes back to ${now}, not ${expectBack}`);
  return true;
}

async function dialogs(route) {
  await evaluate(HELPERS);
  let opened = 0;
  // Buttons on the page
  const buttons = await evaluate(`[...document.querySelectorAll('main button, main [role=button]')]
    .map((b, i) => ({ i, name: __ia.name(b), skip: (b.type === 'submit' && !!b.form) || b.hasAttribute('aria-pressed') || b.getAttribute('aria-haspopup') === 'menu' || b.getAttribute('aria-haspopup') === 'listbox' || b.disabled || __ia.hidden(b) }))
    .filter((b) => !b.skip)`);
  for (const b of buttons) {
    // b.name is 'button "Label"': the label decides
    if (!pressable(b.name.replace(/^\S+ "|"$/g, ""))) continue;
    await go(route);
    await evaluate(HELPERS);
    const name = await evaluate(`(() => { const b = document.querySelectorAll('main button, main [role=button]')[${b.i}]; if (!b) return null; b.focus({ focusVisible: true }); return __ia.name(b); })()`);
    if (name !== b.name) continue;
    const at = await evaluate("location.href");
    await press("Enter");
    if (await evaluate(`location.href !== ${JSON.stringify(at)}`)) continue;
    if (await checkDialog(route, name, name)) opened++;
  }
  // Menu items that open dialogs
  const triggers = await evaluate("document.querySelectorAll('[aria-haspopup=menu]').length");
  for (let t = 0; t < triggers; t++) {
    await go(route);
    await evaluate(HELPERS);
    const trigger = await evaluate(`(() => { const b = document.querySelectorAll('[aria-haspopup=menu]')[${t}]; if (!b || __ia.hidden(b)) return null; b.focus({ focusVisible: true }); return __ia.name(b); })()`);
    if (!trigger) continue;
    await press("Enter");
    if (!(await waitFor("__ia.menu()", 2000))) continue;
    const items = await evaluate(`[...__ia.menu().querySelectorAll('[role=menuitem]')].map((m) => m.innerText.trim()).filter(Boolean)`);
    for (const item of items.filter(pressable)) {
      await go(route);
      await evaluate(HELPERS);
      await evaluate(`document.querySelectorAll('[aria-haspopup=menu]')[${t}].focus({ focusVisible: true })`);
      await press("Enter");
      if (!(await waitFor("__ia.menu()", 2000))) continue;
      const focused = await evaluate(`(() => { const m = [...__ia.menu().querySelectorAll('[role=menuitem]')].find((x) => x.innerText.trim() === ${JSON.stringify(item)}); m?.focus(); return !!m; })()`);
      if (!focused) continue;
      const at = await evaluate("location.href");
      await press("Enter");
      if (await evaluate(`location.href !== ${JSON.stringify(at)}`)) continue;
      if (await checkDialog(route, `${trigger} › ${item}`, trigger)) opened++;
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
    if (s.display === 'none') continue;
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

async function motion(route) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await go(route);
  await evaluate(HELPERS);
  const report = (where, list) => {
    for (const a of list) fail(route, "motion", `${where}: ${a.what} ${a.loops ? "loops" : "moves"} under reduced motion`);
  };
  report("page", await evaluate(MOTION));
  const hasMenu = await evaluate("(() => { const b = [...document.querySelectorAll('[aria-haspopup=menu]')].find((x) => !__ia.hidden(x)); b?.focus({ focusVisible: true }); return !!b; })()");
  if (hasMenu) {
    await press("Enter");
    if (await waitFor("__ia.menu()", 2000)) report("menu", await evaluate(MOTION));
    await press("Escape");
  }
  const item = await evaluate(`(() => { const b = document.querySelector('[aria-haspopup=menu]'); return !!b; })()`);
  if (item) {
    await evaluate("document.querySelector('[aria-haspopup=menu]').focus({ focusVisible: true })");
    await press("Enter");
    if (await waitFor("__ia.menu()", 2000)) {
      const edit = await evaluate("(() => { const m = [...__ia.menu().querySelectorAll('[role=menuitem]')].find((x) => /^edit/i.test(x.innerText.trim())); m?.focus(); return !!m; })()");
      if (edit) {
        await press("Enter");
        if (await waitFor("__ia.dialog()", 2500)) report("dialog", await evaluate(MOTION));
        await press("Escape");
      }
    }
  }
  await send("Emulation.setEmulatedMedia", { features: [] });
}

async function touch(route) {
  await setViewport(390, true);
  await go(route);
  await evaluate(HELPERS);
  if (!(await evaluate("matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches")))
    fail(route, "touch", "the touch emulation does not report a coarse pointer without hover");
  const result = await evaluate(`(() => {
    const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [tabindex="0"]')];
    const out = { hoverOnly: [], small: [], under44: 0, total: 0 };
    const targets = [];
    for (const el of controls) {
      if (el.closest('[inert], [aria-hidden=true]') || el.tagName === 'NEXTJS-PORTAL') continue;
      if (el.checkVisibility && !el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
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
  for (const h of result.hoverOnly) fail(route, "touch", `${h} only shows on hover`);
  for (const s of result.small) fail(route, "touch", `${s} is under 24px and too close to another control`);
  notes.push(`${route}: ${result.total} touch controls, ${result.under44} between 24 and 44px`);
  await setViewport(1440, false);
}

async function detailRoutes() {
  const out = [];
  for (const kind of ["perfumes", "films", "paintings"]) {
    await go(`/${kind}`);
    const href = await evaluate(`[...document.querySelectorAll('main a[href^="/${kind}/"]')].map((a) => a.getAttribute('href')).find((h) => !/\\/(new)(\\?|$)/.test(h) && !h.includes('?'))`);
    if (href) out.push(href);
    else notes.push(`/${kind}: no record, so no detail page checked`);
  }
  return out;
}

await setViewport(1440, false);
const expanded = [];
for (const r of routes) expanded.push(...(r === "@details" ? await detailRoutes() : [r]));
for (const route of expanded) {
  for (const [check, run] of [["keyboard", keyboard], ["menus", menus], ["dialogs", dialogs], ["motion", motion], ["touch", touch]]) {
    try {
      await setViewport(1440, false);
      await go(route);
      await run(route);
    } catch (error) {
      fail(route, check, `the check stopped: ${error.message.split("\n")[0]}`);
    }
  }
  console.log(`checked ${route}`);
}
ws.close();
const exited = new Promise((r) => chrome.once("exit", r));
chrome.kill();
// Chrome may still be writing its profile as it exits: wait for it, retry the
// removal, and never lose the report to a temporary folder left behind
await Promise.race([exited, sleep(10_000)]);
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
} catch (error) {
  notes.push(`the temporary browser profile ${profile} was not removed: ${error.code ?? error.message}`);
}
for (const n of notes) console.log(`  ${n}`);
console.log("");
for (const f of failures) console.log(`FAIL  ${f}`);
console.log(failures.length ? `\n${failures.length} failures on ${expanded.length} routes` : `\nNo failures on ${expanded.length} routes`);
process.exit(failures.length ? 1 : 0);
