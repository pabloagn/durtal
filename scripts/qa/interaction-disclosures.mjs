/** Browser-side identities and state, and transport-independent disclosure walks. */
import { dialogFocusState } from "./interaction-page.mjs";

export function installDisclosureHelpers() {
  const ia = window.__ia;
  const ids = new WeakMap();
  const elements = new Map();
  let serial = 0;
  ia.id = (el) => {
    if (!el) return null;
    if (!ids.has(el)) {
      ids.set(el, String(++serial));
      elements.set(ids.get(el), el);
    }
    return ids.get(el);
  };
  ia.element = (id) => (id === "page" ? document : elements.get(id));
  ia.within = (el, scope) =>
    scope === "page" || ia.element(scope)?.contains(el);
  ia.active = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL")
      return null;
    return {
      id: ia.id(el),
      name: ia.name(el),
      hidden: ia.hidden(el),
      shows: ia.focusShows(el),
    };
  };
  ia.controls = (scope = "page") =>
    [
      ...(ia
        .element(scope)
        ?.querySelectorAll(
          "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=switch],[tabindex]",
        ) ?? []),
    ]
      .filter(
        (el) =>
          !(
            ia.element(scope)?.tagName === "DETAILS" &&
            el ===
              [...ia.element(scope).children].find(
                (c) => c.tagName === "SUMMARY",
              )
          ),
      )
      .filter(
        (el) =>
          !ia.hidden(el) &&
          !el.disabled &&
          el.getAttribute("aria-disabled") !== "true" &&
          el.tabIndex >= 0,
      )
      .filter((el) => {
        // A native radio group has one Tab stop, with arrow-key navigation.
        if (el.tagName !== "INPUT" || el.type !== "radio" || !el.name)
          return true;
        const group = [
          ...document.querySelectorAll("input[type=radio]"),
        ].filter(
          (r) =>
            r.name === el.name &&
            r.form === el.form &&
            !r.disabled &&
            !ia.hidden(r),
        );
        return el === (group.find((r) => r.checked) || group[0]);
      })
      .map((el) => ({ id: ia.id(el), name: ia.name(el) }));
  ia.disclosures = (scope) =>
    [...(ia.element(scope)?.querySelectorAll("details") ?? [])]
      .filter((d) => {
        const parent = d.parentElement?.closest("details");
        return (
          !parent ||
          !ia.element(scope).contains(parent) ||
          parent === ia.element(scope)
        );
      })
      .map((d) => {
        const summary = [...d.children].find((el) => el.tagName === "SUMMARY");
        return {
          id: ia.id(d),
          summary: ia.id(summary),
          open: d.open,
          visible: summary && !ia.hidden(summary),
          name: summary ? ia.name(summary) : "details without a summary",
        };
      });
  ia.capture = () => ({
    details: new Map(
      [...document.querySelectorAll("details")].map((d) => [d, d.open]),
    ),
    focus: document.activeElement,
    scroll: [...document.querySelectorAll("*")]
      .filter((el) => el.scrollLeft || el.scrollTop)
      .map((el) => [el, el.scrollLeft, el.scrollTop]),
    x: window.scrollX,
    y: window.scrollY,
    surfaces: new Set(
      [
        ...document.querySelectorAll("dialog[open],[role=dialog],[role=menu]"),
      ].filter((el) => !ia.hidden(el)),
    ),
  });
  ia.remember = (state, id) => {
    const d = ia.element(id);
    if (!state.details.has(d)) state.details.set(d, d.open);
  };
  ia.restore = (state) => {
    // Cleanup restores attributes directly, including mutually exclusive
    // named groups; the measured opening itself always uses native keys.
    for (const [d] of state.details) if (d.isConnected) d.open = false;
    for (const [d, open] of state.details)
      if (d.isConnected && open) d.open = true;
    if (state.focus?.isConnected) state.focus.focus({ preventScroll: true });
    for (const [el, x, y] of state.scroll)
      if (el.isConnected) {
        el.scrollLeft = x;
        el.scrollTop = y;
      }
    window.scrollTo(state.x, state.y);
    return [...state.details].every(
      ([d, open]) => !d.isConnected || d.open === open,
    );
  };
  ia.newSurface = (state) =>
    [
      ...document.querySelectorAll("dialog[open],[role=dialog],[role=menu]"),
    ].some((el) => !state.surfaces.has(el) && !ia.hidden(el));
  ia.cleanupSurfaces = (state) => {
    for (const el of document.querySelectorAll(
      "dialog[open],[role=dialog],[role=menu]",
    )) {
      if (state.surfaces.has(el) || ia.hidden(el)) continue;
      if (el.tagName === "DIALOG") el.close();
      else if (el.matches(":popover-open")) el.hidePopover();
    }
    return !ia.newSurface(state);
  };
  ia.stateStack = [];
}

/** Reach the exact element through native Tab, never HTMLElement.focus(). */
export async function reachByTab(io, id, limit = 500) {
  // Headless Firefox can retain the last document stop on forward Tab.
  // A bounded native reverse walk proves reachability without forcing focus
  // or treating any background/document focus state as an exception.
  for (const shift of [false, true]) {
    const seen = new Set();
    for (let i = 0; i < limit; i++) {
      const active = await io.evaluate(
        "window.__ia.id(document.activeElement)",
      );
      if (active === id) return true;
      if (active && seen.has(active)) break;
      if (active) seen.add(active);
      await io.press("Tab", shift);
    }
  }
  return false;
}

/** Check visible content, then each disclosure's freshly revealed content.
 * Nested summaries are visited while their ancestors are still open.
 * Both normal completion and a thrown inspection restore original state.
 */
export async function withDisclosures(io, inspect, scope = "page") {
  await io.evaluate("__ia.stateStack.push(__ia.capture()); true");
  const state = `__ia.stateStack[${await io.evaluate("__ia.stateStack.length - 1")}]`;
  let opened = 0,
    revealed = 0;
  const visited = new Set();
  async function walk(parent) {
    // Re-enumerate after every expansion: toggle handlers can insert details.
    while (true) {
      const ds = await io.evaluate(
        `__ia.disclosures(${JSON.stringify(parent)})`,
      );
      const d = ds.find((d) => d.visible && !visited.has(d.id));
      if (!d) break;
      visited.add(d.id);
      await io.evaluate(
        `__ia.remember(${state}, ${JSON.stringify(d.id)}); true`,
      );
      if (!d.open) {
        if (!(await reachByTab(io, d.summary))) {
          io.fail(`${d.name} is not reachable with Tab`);
          continue;
        }
        await io.press("Enter");
        if (
          !(await io.waitFor(
            `__ia.element(${JSON.stringify(d.id)}).open`,
            2000,
          ))
        ) {
          io.fail(`Enter on ${d.name} does not open its details`);
          continue;
        }
        opened++;
        const controls = await io.evaluate(
          `__ia.controls(${JSON.stringify(d.id)}).length`,
        );
        revealed += controls;
        io.note(`${d.name}: ${controls} revealed controls`);
        await inspect(d.id);
      }
      await walk(d.id);
      if (!d.open) {
        if (!(await reachByTab(io, d.summary)))
          io.fail(`${d.name} is not reachable to close`);
        else {
          await io.press("Enter");
          if (
            !(await io.waitFor(
              `!__ia.element(${JSON.stringify(d.id)}).open`,
              2000,
            ))
          )
            io.fail(`${d.name} does not close with Enter`);
        }
      }
    }
  }
  try {
    await inspect(scope);
    await walk(scope);
  } finally {
    try {
      // Escape dismisses tooltips first, then menus, then unsaved dialogs.
      for (
        let i = 0;
        i < 6 && (await io.evaluate(`__ia.newSurface(${state})`));
        i++
      )
        await io.press("Escape");
      if (await io.evaluate(`__ia.newSurface(${state})`)) {
        io.fail("an opened menu/dialog was not restored by Escape");
        if (!(await io.evaluate(`__ia.cleanupSurfaces(${state})`)))
          io.fail("native surface cleanup could not restore original state");
      }
    } finally {
      if (!(await io.evaluate(`__ia.restore(${state})`)))
        io.fail("details did not return to their original states");
      await io.evaluate("__ia.stateStack.pop(); true");
      io.note(`${opened} closed details opened, ${revealed} revealed controls`);
    }
  }
}

/** Audit native keyboard stops against the visible, tabbable DOM inventory.
 * A focus handler which skips a control must fail even if remaining stops
 * all look correct. The injected transport is also used by pure regressions.
 */
export async function walkKeyboard(io, scope = "page", limit = 500) {
  const expected = await io.evaluate(`__ia.controls(${JSON.stringify(scope)})`);
  const modal = await io.evaluate(
    `__ia.id(__ia.element(${JSON.stringify(scope)})?.closest?.('dialog[open]'))`,
  );
  const seen = new Set();
  const failures = [];
  // On a page, start before the first native stop. In a modal, retain its
  // initial focus and let its own trap wrap; focusing body would break it.
  if (scope === "page")
    await io.evaluate(`(() => {
    const body = document.body, old = body.getAttribute('tabindex');
    body.tabIndex = -1; body.focus();
    if (old === null) body.removeAttribute('tabindex'); else body.setAttribute('tabindex', old);
    return true;
  })()`);
  let stops = 0;
  // A dialog starts in its first field, after its header controls. Firefox
  // can retain the final forward stop; native reverse Tab must also prove
  // the controls before that initial field, without forcing their focus.
  for (const shift of [false, true]) {
    if (shift && expected.every((el) => seen.has(el.id))) break;
    const direction = new Set();
    let bounded = true;
    for (let i = 0; i < limit; i++) {
      await io.press("Tab", shift);
      if (modal) {
        const focus = await io.evaluate(
          `(${dialogFocusState.toString()})(__ia.element(${JSON.stringify(modal)}))`,
        );
        if (!focus.valid)
          failures.push(
            `${shift ? "Shift+Tab" : "Tab"} leaves the dialog (body=${focus.body}, documentFocused=${focus.documentFocused})`,
          );
      }
      const stop = await io.evaluate("__ia.active()");
      if (!stop) continue; // browser chrome/body between complete cycles
      if (direction.has(stop.id)) {
        bounded = false;
        break;
      }
      direction.add(stop.id);
      if (seen.has(stop.id)) continue;
      seen.add(stop.id);
      const inside = await io.evaluate(
        `__ia.within(document.activeElement, ${JSON.stringify(scope)})`,
      );
      if (!inside) continue;
      stops++;
      if (stop.hidden)
        failures.push(`${stop.name} takes focus but cannot be seen`);
      else if (!stop.shows)
        failures.push(`${stop.name} shows no focus indicator`);
    }
    if (bounded)
      failures.push(`Tab walk exceeded ${limit} presses without wrapping`);
  }
  for (const el of expected)
    if (!seen.has(el.id)) failures.push(`${el.name} is not reachable with Tab`);
  if (scope === "page" && !stops)
    failures.push("no keyboard controls were checked");
  return { stops, expected: expected.length, failures };
}
