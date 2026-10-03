/**
 * Design audit: paste into the browser console (or run with a browser
 * automation tool) on any page, after it has painted. Measures what the eye
 * cannot judge reliably:
 *
 * - lowContrast: visible text under 4.5:1 against its background (3:1 for
 *   text of 24px or more). Disabled text is skipped; text over an image or
 *   gradient is skipped because its background cannot be computed.
 * - unnamed: links, buttons and fields with no accessible name.
 * - nested: interactive elements inside other interactive elements.
 * - fontSizes, offTokenColors, radii, iconSizes, iconStrokes: what the page
 *   really renders, to compare against docs/03_DESIGN_LANGUAGE.md.
 *
 * Keyboard focus rings need a real Tab key and are not checked here.
 */
(() => {
  const TOKENS = {
    "030507": "bg-primary",
    "0a0d10": "bg-secondary",
    "14171c": "bg-tertiary",
    c1c6c4: "fg-primary",
    "7d8380": "fg-secondary",
    "4a4f4d": "fg-muted",
    "7d3d52": "accent-rose",
    "20131e": "accent-plum",
    c0a36e: "accent-gold",
    "76946a": "accent-sage",
    bb3e41: "accent-red",
    648493: "accent-blue",
    "586e75": "accent-slate",
    "8e4057": "gothic-crimson",
    462941: "gothic-mulberry",
  };
  const PAGE_BG = { r: 3, g: 5, b: 7, a: 1 };
  const INTERACTIVE =
    "a[href], button, [role=button], input:not([type=hidden]), select, textarea";

  function parse(color) {
    const m = color.match(
      /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/,
    );
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  function hex({ r, g, b }) {
    return [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("");
  }
  function name(c) {
    return TOKENS[hex(c)] || `#${hex(c)}${c.a < 1 ? `/${c.a}` : ""}`;
  }
  function luminance({ r, g, b }) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  function blend(top, under) {
    const mix = (k) => top[k] * top.a + under[k] * (1 - top.a);
    return { r: mix("r"), g: mix("g"), b: mix("b"), a: 1 };
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return (
      cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05
    );
  }
  function label(el) {
    const text = el.innerText || el.getAttribute("aria-label") || el.tagName;
    return text.trim().replace(/\s+/g, " ").slice(0, 32);
  }

  /** Opaque background behind an element, or null over an image or gradient */
  function background(el) {
    const layers = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none") return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    return layers.reduceRight((under, top) => blend(top, under), PAGE_BG);
  }

  function hasName(el) {
    return (
      (el.innerText || "").trim() ||
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby") ||
      el.getAttribute("title") ||
      el.labels?.length ||
      el.getAttribute("placeholder") ||
      el.querySelector("img[alt]:not([alt=''])")
    );
  }

  const count = (map, key) => (map[key] = (map[key] || 0) + 1);
  const ranked = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]);

  const elements = [...document.querySelectorAll("body *")].filter(
    (el) => !el.closest("svg, nextjs-portal") && visible(el),
  );
  const textElements = elements.filter((el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
  );

  const lowContrast = [];
  const fontSizes = {};
  for (const el of textElements) {
    const cs = getComputedStyle(el);
    count(fontSizes, cs.fontSize);
    if (el.closest("[disabled], [aria-disabled=true]")) continue;
    const fg = parse(cs.color);
    const bg = background(el);
    if (!fg || !bg) continue;
    const ratio = contrast(fg.a < 1 ? blend(fg, bg) : fg, bg);
    const min = parseFloat(cs.fontSize) >= 24 ? 3 : 4.5;
    if (ratio < min)
      lowContrast.push({
        ratio: +ratio.toFixed(2),
        color: name(fg),
        size: cs.fontSize,
        text: label(el),
      });
  }

  const offTokenColors = {};
  const radii = {};
  for (const el of elements) {
    const cs = getComputedStyle(el);
    const props = { color: cs.color, background: cs.backgroundColor };
    if (parseFloat(cs.borderTopWidth) > 0) props.border = cs.borderTopColor;
    for (const [prop, value] of Object.entries(props)) {
      const c = parse(value);
      if (c && c.a > 0 && !TOKENS[hex(c)])
        count(offTokenColors, `${prop} ${name(c)}`);
    }
    if (cs.borderTopLeftRadius !== "0px") count(radii, cs.borderTopLeftRadius);
  }

  const iconSizes = {};
  const iconStrokes = {};
  for (const svg of document.querySelectorAll("svg[class*='lucide']")) {
    if (!visible(svg)) continue;
    count(iconSizes, `${Math.round(svg.getBoundingClientRect().width)}px`);
    count(iconStrokes, svg.getAttribute("stroke-width"));
  }

  const controls = [...document.querySelectorAll(INTERACTIVE)].filter(visible);
  const unnamed = controls
    .filter((el) => !hasName(el))
    .map((el) => el.outerHTML.slice(0, 100));
  const nested = controls
    .filter((el) => el.parentElement?.closest(INTERACTIVE))
    .map(
      (el) => `${label(el.parentElement.closest(INTERACTIVE))} > ${label(el)}`,
    );

  const byColor = {};
  for (const x of lowContrast) count(byColor, `${x.color} ${x.ratio}:1`);

  return {
    page: location.pathname + location.search,
    textElements: textElements.length,
    lowContrast: lowContrast.length,
    lowContrastByColor: ranked(byColor),
    lowContrastSample: lowContrast.slice(0, 10),
    unnamed: unnamed.length,
    unnamedSample: unnamed.slice(0, 10),
    nested: nested.length,
    nestedSample: nested.slice(0, 10),
    fontSizes: ranked(fontSizes),
    offTokenColors: ranked(offTokenColors),
    radii: ranked(radii),
    iconSizes: ranked(iconSizes),
    iconStrokes: ranked(iconStrokes),
  };
})();
