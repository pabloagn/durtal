import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HELPERS, dialogFocusState } from "./interaction-page.mjs";
import {
  installDisclosureHelpers,
  withDisclosures,
  walkKeyboard,
  reachByTab,
} from "./interaction-disclosures.mjs";
import { effectiveTarget } from "./interaction-target.mjs";
import { optionTabEnabled, dispatchKeyEvent } from "./interaction-driver.mjs";
const { Window } = await import(
  process.env.HAPPY_DOM_PATH
    ? pathToFileURL(process.env.HAPPY_DOM_PATH).href
    : "happy-dom"
);

test("Option-Tab is explicit and macOS WebKit only, with native modifiers released in both directions", async () => {
  assert.equal(optionTabEnabled("webkit", "1", "darwin"), true);
  assert.equal(optionTabEnabled("webkit", "", "darwin"), false);
  assert.equal(optionTabEnabled("webkit", "", "linux"), false);
  for (const engine of ["cdp", "chromium", "firefox"])
    assert.equal(optionTabEnabled(engine, "1", "darwin"), false);
  assert.throws(
    () => optionTabEnabled("webkit", "1", "linux"),
    /requires macOS WebKit/,
  );
  for (const shift of [false, true]) {
    const events = [],
      held = new Set();
    const keyboard = {
      async down(key) {
        held.add(key);
        events.push(["down", key, held.has("Alt"), held.has("Shift")]);
      },
      async up(key) {
        held.delete(key);
        events.push(["up", key]);
      },
    };
    for (const type of ["keyDown", "keyUp"])
      await dispatchKeyEvent(
        keyboard,
        { type, key: "Tab", modifiers: shift ? 8 : 0 },
        true,
      );
    assert.deepEqual(
      events.find(([type, key]) => type === "down" && key === "Tab"),
      ["down", "Tab", true, shift],
    );
    assert.equal(held.size, 0);
    events.length = 0;
    for (const type of ["keyDown", "keyUp"])
      await dispatchKeyEvent(keyboard, { type, key: "Enter" }, true);
    assert.deepEqual(events, [
      ["down", "Enter", false, false],
      ["up", "Enter"],
    ]);
    events.length = 0;
    for (const type of ["keyDown", "keyUp"])
      await dispatchKeyEvent(keyboard, { type, key: "Tab" }, false);
    assert.deepEqual(events, [
      ["down", "Tab", false, false],
      ["up", "Tab"],
    ]);
  }
});

// Pure fixture transport: synthetic Tab order/toggle/escape, no browser launch.
// It tests discovery and failure reporting; real native focus is a separate gate.
function fixture(html, { skip = "", ringless = "", endStops = false } = {}) {
  const window = new Window({ url: "http://127.0.0.1:3462/test" });
  window.document.body.innerHTML = `<main>${html}</main>`;
  for (const el of window.document.querySelectorAll("*"))
    el.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 44,
      width: 100,
      height: 44,
    });
  window.eval(HELPERS);
  // happy-dom has no rendered disclosure layout or focus paint.
  window.__ia.hidden = (el) => {
    if (!el || el.closest("[hidden],[inert]")) return true;
    for (
      let d = el.closest("details:not([open])");
      d;
      d = d.parentElement?.closest("details:not([open])")
    ) {
      if (![...d.children].find((c) => c.tagName === "SUMMARY")?.contains(el))
        return true;
    }
    return false;
  };
  window.__ia.focusShows = (el) => !ringless || el.id !== ringless;
  window.eval(`(${installDisclosureHelpers.toString()})()`);
  const failures = [],
    notes = [],
    keys = [];
  const evaluate = async (expression) => {
    // happy-dom does not assign native summary tabIndex/focus behavior.
    for (const el of window.document.querySelectorAll("summary"))
      el.tabIndex = 0;
    return window.eval(expression);
  };
  const io = {
    evaluate,
    async press(key, shift = false) {
      keys.push(shift ? "Shift+Tab" : key);
      if (key === "Tab") {
        const controls = [
          ...window.document.querySelectorAll(
            "button,input,summary,a[href],textarea",
          ),
        ].filter(
          (el) =>
            !window.__ia.hidden(el) &&
            !el.disabled &&
            (!skip || el.id !== skip),
        );
        const index =
          controls.indexOf(window.document.activeElement) + (shift ? -1 : 1);
        const next =
          controls[
            endStops
              ? Math.max(0, Math.min(controls.length - 1, index))
              : (index + controls.length) % controls.length
          ];
        next?.focus();
      } else if (
        key === "Enter" &&
        window.document.activeElement.tagName === "SUMMARY"
      ) {
        const d = window.document.activeElement.parentElement;
        d.open = !d.open;
        d.dispatchEvent(new window.Event("toggle"));
      } else if (key === "Escape") {
        for (const el of window.document.querySelectorAll("dialog[open]"))
          el.close();
        for (const el of window.document.querySelectorAll("[role=menu]"))
          el.remove();
      }
    },
    async waitFor(expression) {
      return !!(await evaluate(expression));
    },
    fail: (what) => failures.push(what),
    note: (what) => notes.push(what),
  };
  return { window, io, failures, notes, keys };
}

test("closed and dynamically inserted nested controls are audited while ancestors are open", async () => {
  const f = fixture(
    '<button id="before">Before</button><details id="outer"><summary>History</summary><button id="row">Actions</button></details><details id="open" open><summary>Short</summary><input></details>',
  );
  const outer = f.window.document.getElementById("outer");
  outer.addEventListener("toggle", () => {
    if (!outer.open || outer.querySelector("#nested")) return;
    outer.insertAdjacentHTML(
      "beforeend",
      '<details id="nested"><summary>Nested long label with complete readable text</summary><button id="fresh" aria-label="Edit">Edit</button><input id="absent"></details>',
    );
  });
  const checked = [];
  await withDisclosures(f.io, async (scope) => {
    const controls = await f.io.evaluate(
      `__ia.controls(${JSON.stringify(scope)})`,
    );
    checked.push(...controls.map((c) => c.name));
    const r = await walkKeyboard(f.io, scope, 30);
    f.failures.push(...r.failures);
  });
  assert.deepEqual(f.failures, []);
  assert(checked.some((n) => n.includes("Actions")));
  assert(checked.some((n) => n.includes("Edit")));
  assert(f.notes.some((n) => /2 closed details opened, [1-9]/.test(n)));
  assert.equal(outer.open, false);
  assert.equal(f.window.document.getElementById("nested").open, false);
  assert.equal(f.window.document.getElementById("open").open, true);
  assert.equal(f.window.__ia.stateStack.length, 0);
});

test("a control skipped by a focus handler fails instead of giving a clean partial Tab walk", async () => {
  const f = fixture(
    '<details><summary>History</summary><button id="lost">Edit lost record</button><button id="next">Other</button></details>',
    { skip: "lost" },
  );
  await withDisclosures(f.io, async (scope) => {
    const r = await walkKeyboard(f.io, scope, 20);
    f.failures.push(...r.failures);
  });
  assert(
    f.failures.some((s) => /Edit lost record.*not reachable with Tab/.test(s)),
  );
  assert.equal(f.window.document.querySelector("details").open, false);
});

test("a dialog starting in its middle uses reverse Tab at native end stops and still detects skipped or ringless controls", async () => {
  for (const scenario of [{}, { skip: "close" }, { ringless: "close" }]) {
    const f = fixture(
      '<dialog><button>Expand</button><button id="close">Close</button><input id="initial" aria-label="Title"><button>Cancel</button><button>Save</button></dialog>',
      { endStops: true, ...scenario },
    );
    const dialog = f.window.document.querySelector("dialog");
    dialog.showModal();
    f.window.document.getElementById("initial").focus();
    const result = await walkKeyboard(f.io, f.window.__ia.id(dialog), 30);
    assert(f.keys.includes("Shift+Tab"));
    if (scenario.skip)
      assert(
        result.failures.some((s) => /Close.*not reachable with Tab/.test(s)),
      );
    else if (scenario.ringless)
      assert(
        result.failures.some((s) => /Close.*shows no focus indicator/.test(s)),
      );
    else {
      assert.deepEqual(result.failures, []);
      assert.equal(result.stops, 5);
      assert.equal(result.expected, 5);
    }
  }
});

test("a newly revealed stop without a focus indicator is reported", async () => {
  const f = fixture(
    '<details><summary>History</summary><button id="lost">Edit</button></details>',
    { ringless: "lost" },
  );
  await withDisclosures(f.io, async (scope) =>
    f.failures.push(...(await walkKeyboard(f.io, scope, 20)).failures),
  );
  assert(f.failures.some((s) => /Edit.*shows no focus indicator/.test(s)));
});

test("an unreachable summary fails and its contents are not claimed as checked", async () => {
  const f = fixture(
    '<button>Before</button><details><summary id="lost">History</summary><button>Edit</button></details>',
    { skip: "lost" },
  );
  let inspections = 0;
  await withDisclosures(f.io, async () => inspections++);
  assert.equal(inspections, 1);
  assert(f.failures.some((s) => /History.*not reachable with Tab/.test(s)));
  assert(f.notes.includes("0 closed details opened, 0 revealed controls"));
});

test("thrown inspection restores nested disclosure, dialog, focus and scroll state", async () => {
  const f = fixture(
    '<button id="start">Before</button><details id="outer"><summary>History</summary><details id="inner"><summary>Nested</summary><button>Edit</button></details></details><details id="kept" open><summary>Originally open</summary><button>Other</button></details>',
  );
  f.window.document.getElementById("start").focus();
  f.window.document.querySelector("main").scrollTop = 30;
  await assert.rejects(
    withDisclosures(f.io, async (scope) => {
      if (scope !== "page" && f.window.__ia.element(scope).id === "inner") {
        f.window.document.body.insertAdjacentHTML(
          "beforeend",
          "<dialog><button>Unsaved</button></dialog>",
        );
        f.window.document.querySelector("dialog").showModal();
        f.window.document.querySelector("main").scrollTop = 900;
        throw new Error("deliberate failure");
      }
    }),
    /deliberate failure/,
  );
  assert.equal(f.window.document.getElementById("outer").open, false);
  assert.equal(f.window.document.getElementById("inner").open, false);
  assert.equal(f.window.document.getElementById("kept").open, true);
  assert.equal(f.window.document.querySelector("dialog").open, false);
  assert.equal(f.window.document.activeElement.id, "start");
  assert.equal(f.window.document.querySelector("main").scrollTop, 30);
  assert.equal(f.window.__ia.stateStack.length, 0);
  assert.deepEqual(f.failures, []);
});

test("broken Escape is reported but newly opened native dialogs are still cleaned up", async () => {
  const f = fixture(
    "<button>Before</button><details><summary>History</summary><button>Edit</button></details>",
  );
  const originalPress = f.io.press;
  f.io.press = async (key) => {
    if (key !== "Escape") await originalPress(key);
  };
  await assert.rejects(
    withDisclosures(f.io, async (scope) => {
      if (scope === "page") return;
      f.window.document.body.insertAdjacentHTML(
        "beforeend",
        "<dialog><button>Unsaved</button></dialog>",
      );
      f.window.document.querySelector("dialog").showModal();
      throw new Error("deliberate failure");
    }),
    /deliberate failure/,
  );
  assert(f.failures.some((s) => /not restored by Escape/.test(s)));
  assert.equal(f.window.document.querySelector("dialog").open, false);
  assert.equal(f.window.document.querySelector("details").open, false);
});

test("dialog Tab allows BODY only when the measured document has no focus", async () => {
  const f = fixture(
    '<button id="background">Background</button><dialog><button id="inside">Inside</button></dialog>',
  );
  const dialog = f.window.document.querySelector("dialog");
  dialog.showModal();
  f.window.document.body.tabIndex = -1;
  f.window.document.body.focus();
  f.window.document.hasFocus = () => false;
  const focus = f.window.eval(
    `(${dialogFocusState.toString()})(document.querySelector('dialog'))`,
  );
  assert.deepEqual(
    { ...focus },
    { inside: false, body: true, documentFocused: false, valid: true },
  );
});

test("dialog Tab rejects BODY when the measured document still has focus", async () => {
  const f = fixture("<dialog><button>Inside</button></dialog>");
  f.window.document.querySelector("dialog").showModal();
  f.window.document.body.tabIndex = -1;
  f.window.document.body.focus();
  f.window.document.hasFocus = () => true;
  const focus = f.window.eval(
    `(${dialogFocusState.toString()})(document.querySelector('dialog'))`,
  );
  assert.deepEqual(
    { ...focus },
    { inside: false, body: true, documentFocused: true, valid: false },
  );
});

test("dialog Tab rejects a background control regardless of document focus", async () => {
  const f = fixture(
    '<button id="background">Background</button><dialog><button id="inside">Inside</button></dialog>',
  );
  f.window.document.querySelector("dialog").showModal();
  f.window.document.getElementById("background").focus();
  for (const documentFocused of [false, true]) {
    f.window.document.hasFocus = () => documentFocused;
    const focus = f.window.eval(
      `(${dialogFocusState.toString()})(document.querySelector('dialog'))`,
    );
    assert.deepEqual(
      { ...focus },
      { inside: false, body: false, documentFocused, valid: false },
    );
  }
  f.window.document.getElementById("inside").focus();
  assert.equal(
    f.window.eval(
      `(${dialogFocusState.toString()})(document.querySelector('dialog')).valid`,
    ),
    true,
  );
});

test("native reverse Tab can reach a summary when forward Tab retains the last stop", async () => {
  const f = fixture(
    '<button id="before">Before</button><details><summary id="target">History</summary><button>Edit</button></details><button id="last">Last</button>',
  );
  f.window.document.getElementById("last").focus();
  const originalPress = f.io.press;
  f.io.press = async (key, shift) => {
    if (shift) await originalPress(key, shift);
  };
  const target = await f.io.evaluate(
    '__ia.id(document.getElementById("target"))',
  );
  assert.equal(await reachByTab(f.io, target, 20), true);
  assert.equal(f.window.document.activeElement.id, "target");
});

test("CLI refuses unsafe targets before finding or starting any browser", () => {
  for (const args of [
    [],
    ["--disposable", "--base", "http://localhost:3100"],
    ["--disposable", "--base", "https://example.com"],
    ["--disposable", "--base", "file://localhost/test"],
    ["--disposable", "--browsers", "safari"],
  ]) {
    const r = spawnSync(
      process.execPath,
      ["scripts/qa/interaction-audit.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Refused:/);
  }
});

test("centered 44px hit areas count, decoration does not, and permanent clipping cuts them", () => {
  const body = {
    parentElement: null,
    clientWidth: 400,
    clientHeight: 400,
    scrollWidth: 400,
    scrollHeight: 400,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      width: 400,
      height: 400,
    }),
  };
  const el = {
    parentElement: body,
    getBoundingClientRect: () => ({
      left: 50,
      top: 50,
      right: 70,
      bottom: 70,
      width: 20,
      height: 20,
    }),
  };
  let clipped = false,
    decoration = false;
  const style = (node, pseudo) =>
    pseudo
      ? {
          content: '""',
          position: "absolute",
          pointerEvents: decoration ? "none" : "auto",
          display: "block",
          visibility: "visible",
          width: "44px",
          height: "44px",
          left: "50%",
          top: "50%",
          transform: "matrix(1, 0, 0, 1, -22, -22)",
        }
      : {
          position: "relative",
          overflowX: clipped ? "hidden" : "visible",
          overflowY: clipped ? "hidden" : "visible",
        };
  const target = new Function(
    "getComputedStyle",
    "document",
    `return (${effectiveTarget.toString()})`,
  )(style, { documentElement: null });
  assert.equal(target(el).width, 44);
  assert.equal(target(el).height, 44);
  decoration = true;
  assert.equal(target(el).width, 20);
  decoration = false;
  clipped = true;
  body.getBoundingClientRect = () => ({
    left: 50,
    top: 50,
    right: 70,
    bottom: 70,
    width: 20,
    height: 20,
  });
  assert.equal(target(el).width, 20);
  assert.equal(target(el).height, 20);
  clipped = false;
  body.clientWidth = 20;
  body.scrollWidth = 400;
  const scrollTarget = new Function(
    "getComputedStyle",
    "document",
    `return (${effectiveTarget.toString()})`,
  )(
    (node, pseudo) =>
      pseudo
        ? style(node, pseudo)
        : { ...style(node), overflowX: "auto", overflowY: "auto" },
    { documentElement: null },
  );
  assert.equal(scrollTarget(el).width, 20);
});
