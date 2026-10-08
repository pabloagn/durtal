/**
 * Touch target audit: paste into the browser console (or run with a browser
 * automation tool) on any page, on a touch screen or with a coarse pointer
 * emulated. Lists every control a finger can press whose target is smaller
 * than 44 x 44 CSS px: buttons, links, fields, selects, menu items, tabs,
 * chips, toggles and the labels of hidden checkboxes.
 *
 * The target is the control's box, grown by a `::before` or `::after` hit
 * area when it has one, and cut by any ancestor that clips its overflow (a
 * press outside the clip never reaches the control) up to the first one that
 * scrolls it: a scroller brings the control into view, so it counts whole, up
 * to what the scroller shows. Left out: links inside a sentence (their line is the
 * target, as WCAG allows), controls hidden or disabled, controls inside a
 * larger control, and the sr-only input of a label that is itself measured.
 *
 * Plain text links (inline, no box: a name in a detail list) are listed
 * apart in `textLinks`: they are text, not controls.
 *
 * Every front-end change must pass this with an empty result at 390 px with a
 * coarse pointer (see docs/03_DESIGN_LANGUAGE.md, Keyboard, touch and motion).
 */
(() => {
  const MIN = 44;
  const TOLERANCE = 0.5;
  const SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=option]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=radio]",
    "[role=combobox]",
    "[role=slider]",
    "label:has(> input.sr-only)",
    "label:has(> input[type=checkbox])",
    "label:has(> input[type=radio])",
  ].join(",");

  function visible(el) {
    if (el.closest("[hidden], [aria-hidden=true], [inert]")) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    // sr-only: a 1px clipped box
    if (r.width <= 1 && r.height <= 1) return false;
    return r.width > 0 && r.height > 0;
  }

  /**
   * A plain text link (a name in a detail list, a title): inline, no box of
   * its own. Out of this audit's scope (controls); counted apart.
   */
  function textLink(el) {
    if (el.tagName !== "A") return false;
    const s = getComputedStyle(el);
    return s.display === "inline" && parseFloat(s.borderTopWidth) === 0 && /rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor);
  }

  /** A link in running text: its paragraph has other text on its line */
  function inSentence(el) {
    if (el.tagName !== "A") return false;
    if (getComputedStyle(el).display !== "inline") return false;
    const block = el.parentElement;
    if (!block) return false;
    const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
    const own = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > own.length + 2;
  }

  /** Overflow on one axis: "clip" cuts the content, "scroll" can bring it into view, null does neither */
  function overflowOn(n, s, axis) {
    const value = axis === "x" ? s.overflowX : s.overflowY;
    if (/hidden|clip/.test(value)) return "clip";
    if (!/auto|scroll/.test(value)) return null;
    // A box that could scroll but has nothing more to show only clips
    const more = axis === "x" ? n.scrollWidth - n.clientWidth : n.scrollHeight - n.clientHeight;
    return more > 1 ? "scroll" : "clip";
  }

  /**
   * How much of a box a press can reach on each axis. Every ancestor that
   * clips its overflow cuts it, since a press outside the clip does not reach
   * the control, up to the first ancestor that scrolls on that axis: the
   * reader scrolls the control into view there, so it counts whole, up to
   * what that scroller itself shows. A control half-scrolled at a dialog
   * body's edge is not small; a small one is small wherever it scrolls.
   */
  function reach(from, rect) {
    let { left, right, top, bottom } = rect;
    let width = null;
    let height = null;
    for (let n = from.parentElement; n && n !== document.documentElement && (width === null || height === null); n = n.parentElement) {
      const s = getComputedStyle(n);
      const x = width === null ? overflowOn(n, s, "x") : null;
      const y = height === null ? overflowOn(n, s, "y") : null;
      if (!x && !y) continue;
      const c = n.getBoundingClientRect();
      const view = x === "scroll" || y === "scroll" ? reach(n, c) : null;
      if (x === "scroll") width = Math.min(Math.max(0, right - left), view.width, n.clientWidth);
      if (y === "scroll") height = Math.min(Math.max(0, bottom - top), view.height, n.clientHeight);
      if (x === "clip") ({ left, right } = { left: Math.max(left, c.left), right: Math.min(right, c.right) });
      if (y === "clip") ({ top, bottom } = { top: Math.max(top, c.top), bottom: Math.min(bottom, c.bottom) });
    }
    return { width: width ?? Math.max(0, right - left), height: height ?? Math.max(0, bottom - top) };
  }

  /**
   * The target: the element, grown by a positioned ::before/::after hit
   * area, then cut by the ancestors that clip it (a cap-box clips), as
   * `reach` says.
   */
  function target(el) {
    const r = el.getBoundingClientRect();
    let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (const pseudo of ["::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      if (s.content === "none" || s.position !== "absolute") continue;
      const w = parseFloat(s.width) || 0;
      const h = parseFloat(s.height) || 0;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      box = {
        left: Math.min(box.left, cx - w / 2),
        right: Math.max(box.right, cx + w / 2),
        top: Math.min(box.top, cy - h / 2),
        bottom: Math.max(box.bottom, cy + h / 2),
      };
    }
    return reach(el, box);
  }

  function label(el) {
    const name =
      el.getAttribute("aria-label") ||
      el.getAttribute("data-tooltip") ||
      (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      "";
    const path = [];
    for (let n = el; n && n !== document.body && path.length < 3; n = n.parentElement) {
      const cls = typeof n.className === "string" ? n.className.split(/\s+/).filter((c) => c && !c.includes(":"))[0] : "";
      path.unshift(n.tagName.toLowerCase() + (n.getAttribute("role") ? `[${n.getAttribute("role")}]` : "") + (cls ? `.${cls}` : ""));
    }
    return { name, where: path.join(" > ") };
  }

  const all = [...document.querySelectorAll(SELECTOR)];
  const issues = [];
  const textLinks = [];
  let checked = 0;
  for (const el of all) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (!visible(el)) continue;
    if (inSentence(el)) continue;
    // A control inside another measured control: the outer one is the target
    const outer = el.parentElement?.closest(SELECTOR);
    if (outer && outer !== el && visible(outer)) continue;
    const { width, height } = target(el);
    // Clipped away entirely (a slide out of view): nothing to press now
    if (width === 0 || height === 0) continue;
    checked++;
    if (width + TOLERANCE >= MIN && height + TOLERANCE >= MIN) continue;
    if (textLink(el)) {
      textLinks.push({ width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10, ...label(el) });
      continue;
    }
    issues.push({ width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10, ...label(el) });
  }
  return {
    page: location.pathname + location.search,
    coarse: matchMedia("(pointer: coarse)").matches,
    checked,
    issues,
    textLinks,
  };
})();
