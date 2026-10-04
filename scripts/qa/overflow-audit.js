/**
 * Overflow audit: paste into the browser console (or run with a browser
 * automation tool, see scripts/qa/phone-audit.mjs) on any page, at phone
 * width (375px). Returns how far the page scrolls sideways and the outermost
 * elements that reach past the right edge of the screen.
 *
 * Content inside a box that scrolls or clips on its own (a carousel, a table
 * wrapper with overflow-x: auto) is skipped: that box is the element to check.
 *
 * A page passes when `overflow` is 0 and `offenders` is empty.
 */
(() => {
  const TOLERANCE = 0.5;
  const screen = document.documentElement.clientWidth;

  function describe(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = [...el.classList].slice(0, 3).map((c) => `.${c}`).join("");
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  }

  /** True when an ancestor clips or scrolls inside the screen. */
  function contained(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== "visible" && p.getBoundingClientRect().right <= screen + TOLERANCE)
        return true;
    }
    return false;
  }

  const offenders = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || rect.right <= screen + TOLERANCE) continue;
    // Off-canvas panels (a closed drawer) sit fully outside the screen.
    if (rect.left >= screen) continue;
    if (contained(el)) continue;
    if (offenders.some((o) => o.el.contains(el))) continue;
    offenders.push({ el, right: Math.round(rect.right) });
  }

  return {
    screen,
    overflow: document.documentElement.scrollWidth - screen,
    offenders: offenders.map(({ el, right }) => ({
      element: describe(el),
      right,
      fixed: getComputedStyle(el).position === "fixed",
    })),
  };
})();
