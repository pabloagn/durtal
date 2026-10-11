/** Native regression; uses the installed browser/runtime paths from the audit.
 * PLAYWRIGHT_CORE=... node --test scripts/qa/interaction-animation.native.test.mjs
 * Browser drivers run serially; no application, database or saved preferences.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDriver } from "./interaction-driver.mjs";
import { HELPERS } from "./interaction-page.mjs";
import {
  installDisclosureHelpers,
  walkKeyboard,
} from "./interaction-disclosures.mjs";

const css = readFileSync(
  new URL("../../src/styles/globals.css", import.meta.url),
  "utf8",
);
const entrance = css.match(/\.dialog-enter\s*\{[^}]*\}/)[0];
const start = css.indexOf("@keyframes dialog-scale-in");
let end = css.indexOf("{", start),
  depth = 1;
while (depth && ++end < css.length) {
  if (css[end] === "{") depth++;
  else if (css[end] === "}") depth--;
}
assert(start >= 0 && depth === 0);
const animation = css.slice(start, end + 1);
const html = `<style>${entrance}${animation}
  button { padding:12px; border:1px solid #999; }
  button:focus-visible { outline:2px solid #39f; }
  .ringless:focus,.ringless:focus-visible { outline:none; box-shadow:none; }
  </style><button id="outside">Before</button>
  <dialog class="dialog-enter"><button id="probe">Probe</button><button id="other">Other</button></dialog>`;
const oldHelpers = HELPERS.replace(
  "transition: none !important; }",
  "transition: none !important; animation: none !important; }",
);
assert.notEqual(oldHelpers, HELPERS);

for (const browser of ["chromium", "firefox", "webkit"]) {
  test(`${browser}: focus probing preserves the actual dialog animation and detects a missing ring`, async () => {
    const driver = await createDriver(browser);
    const evaluate = async (expression) => {
      const result = await driver.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.result.result.value;
    };
    const press = async (key, shift = false) => {
      const params = { key, code: key, modifiers: shift ? 8 : 0 };
      await driver.send("Input.dispatchKeyEvent", {
        ...params,
        type: "rawKeyDown",
      });
      await driver.send("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
      await new Promise((resolve) => setTimeout(resolve, 120));
    };
    try {
      for (const [mode, helpers] of [
        ["historical", oldHelpers],
        ["corrected", HELPERS],
      ]) {
        await driver.send("Page.navigate", {
          url: "data:text/html," + encodeURIComponent(html),
        });
        await evaluate(helpers);
        await evaluate(`(${installDisclosureHelpers.toString()})()`);
        await evaluate(`(() => {
          window.starts = 0;
          const dialog = document.querySelector('dialog');
          dialog.addEventListener('animationstart', e => {
            if (e.target === dialog && e.animationName === 'dialog-scale-in') starts++;
          });
          dialog.showModal();
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await press("Tab");
        await press("Tab", true);
        const before =
          await evaluate(`({starts, focus: document.activeElement.id,
          styles: [...document.head.querySelectorAll('style')].map(s => s.outerHTML),
          opacity: getComputedStyle(document.querySelector('dialog')).opacity})`);
        assert.equal(before.focus, "probe");
        assert.equal(before.starts, 1);
        assert.equal(before.opacity, "1");
        const probes = [];
        for (let i = 0; i < 3; i++) {
          const state = await evaluate(`(async () => {
            const button = document.getElementById('probe'), dialog = document.querySelector('dialog');
            const shows = __ia.focusShows(button);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return {shows, starts, focus: document.activeElement.id, hidden: __ia.hidden(button),
              opacity: getComputedStyle(dialog).opacity, styles: [...document.head.querySelectorAll('style')].map(s => s.outerHTML)};
          })()`);
          assert.equal(state.shows, true);
          assert.equal(state.focus, before.focus);
          assert.deepEqual(state.styles, before.styles);
          if (mode === "corrected") {
            assert.equal(
              state.starts,
              before.starts,
              "probing must not restart the entrance animation",
            );
            assert.equal(state.hidden, false);
            assert.equal(state.opacity, "1");
          }
          probes.push(state);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (mode === "historical")
          assert(
            probes.some((p) => p.starts > before.starts && +p.opacity < 1),
            "historical probe must reproduce the restart",
          );
        else {
          const scope = await evaluate(
            "__ia.id(document.querySelector('dialog'))",
          );
          assert.deepEqual(
            (await walkKeyboard({ evaluate, press }, scope, 30)).failures,
            [],
          );
          await evaluate(
            "document.getElementById('other').classList.add('ringless')",
          );
          const broken = await walkKeyboard({ evaluate, press }, scope, 30);
          assert(
            broken.failures.some((f) =>
              /Other.*shows no focus indicator/.test(f),
            ),
          );
        }
        console.log(JSON.stringify({ browser, mode, before, probes }));
        await press("Escape");
        assert.equal(
          await evaluate("document.querySelector('dialog').open"),
          false,
        );
      }
    } finally {
      await driver.close();
    }
  });
}
