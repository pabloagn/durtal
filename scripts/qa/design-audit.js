/**
 * Design audit: paste into the browser console (or run with a browser
 * automation tool) on any page, after it has painted. Measures what the eye
 * cannot judge reliably:
 *
 * - lowContrast: visible text under 4.5:1 against its background (3:1 for
 *   text of 24px or more). Disabled text and decoration hidden from screen
 *   readers (aria-hidden, such as a cover's placeholder letter) are skipped;
 *   text over an image or gradient is skipped because its background cannot
 *   be computed.
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

  /**
   * A computed color as sRGB 0-255 plus alpha. Browsers give rgb()/rgba(),
   * but a color mixed with transparency (Tailwind's `bg-x/60`, which compiles
   * to color-mix() in oklab) computes to oklab(); oklch() and color(srgb ...)
   * are read too. Null for anything else.
   */
  function parse(color) {
    const m = color.match(/^(rgba?|oklab|oklch|color)\((.*)\)$/);
    if (!m) return null;
    let [, fn, args] = m;
    if (fn === "color") {
      if (!args.startsWith("srgb ")) return null;
      args = args.slice(5);
    }
    const [channels, alpha] = args.split("/");
    const num = (v, percentOf = 1) =>
      v === "none" ? 0 : v.endsWith("%") ? (parseFloat(v) / 100) * percentOf : parseFloat(v);
    const parts = channels.trim().split(/[\s,]+/);
    let a = 1;
    if (alpha !== undefined) a = num(alpha.trim());
    else if (fn === "rgba" || (fn === "rgb" && parts.length === 4)) a = num(parts[3]);
    if (parts.length < 3 || parts.slice(0, 3).some((v) => Number.isNaN(num(v))))
      return null;
    if (fn === "rgb" || fn === "rgba") {
      const [r, g, b] = parts.map((v) => num(v, 255));
      return { r, g, b, a };
    }
    if (fn === "color") {
      const [r, g, b] = parts.map((v) => num(v) * 255);
      return clamp({ r, g, b, a });
    }
    let L = num(parts[0]);
    let A, B;
    if (fn === "oklab") {
      A = num(parts[1], 0.4);
      B = num(parts[2], 0.4);
    } else {
      const C = num(parts[1], 0.4);
      const h = (num(parts[2]) * Math.PI) / 180;
      A = C * Math.cos(h);
      B = C * Math.sin(h);
    }
    if (parts[0].endsWith("%")) L = parseFloat(parts[0]) / 100;
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const encode = (v) =>
      255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055);
    return clamp({
      r: encode(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
      g: encode(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
      b: encode(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
      a,
    });
  }
  function clamp({ r, g, b, a }) {
    const c = (v) => Math.min(255, Math.max(0, v));
    return { r: c(r), g: c(g), b: c(b), a };
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
    if (el.closest("[disabled], [aria-disabled=true], [aria-hidden=true]")) continue;
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
