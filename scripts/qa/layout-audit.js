/**
 * Layout audit (SLN-695): paste into the browser console (or run with a
 * browser automation tool) on any page, after it has painted. It looks for
 * what the overflow, alignment, design and touch audits pass but a reader
 * still sees:
 *
 * - squeezed: the page title (the h1 in main) wraps while it is narrower than
 *   60% of its row, because controls share that row; or it runs to more than
 *   2 lines on a phone (a screen 400px wide or less).
 * - plainCommands: a button or link that looks like text at rest. It has no
 *   box, border, underline or icon, and it is in a text colour (fg-heading,
 *   fg-primary, fg-secondary or fg-muted) or within 1.25:1 of the text beside
 *   it (or of its row's text when alone), so only hover would tell it apart. A link inside a sentence of running text, tabs
 *   and menu items, cover and card links (an image or a heading inside, or a
 *   title that is a link) and a button beside a boxed button (a dialog's
 *   Cancel beside Save) are skipped.
 * - drift: in a card, a block whose ink (its first line's text or icon, or
 *   the box of a boxed element such as a badge or field) starts between 0.5
 *   and 12px off the left edge of the column holding it. A wrapping row of
 *   controls is checked on every line. Mark an intended inset with
 *   `data-inset` on the block or any element around it.
 * - firstContent: where the first card starts. On a list page seen on a
 *   phone it should start in the top 60% of the first screen (506px on a
 *   390 x 844 screen): `late` is true when it does not. Only a runner knows
 *   which pages are lists; a detail page's cards come later by design.
 *
 * Every entry names the element and the numbers that failed.
 * scripts/qa/phone-audit.mjs runs it on every route it checks, and lists the
 * findings in scripts/qa/layout-audit-known.json as known, with their ticket.
 */
(() => {
  const DRIFT_MIN = 0.5;
  const DRIFT_MAX = 12;
  const main = document.querySelector("main") ?? document.body;
  const css = (el) => getComputedStyle(el);
  const round = (n) => Math.round(n * 10) / 10;
  const text = (el) => (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const visible = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  function name(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = [...el.classList].filter((c) => !c.includes(":") && !c.includes("[")).slice(0, 2).map((c) => `.${c}`).join("");
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }
  function rgba(color) {
    const probe = document.createElement("canvas").getContext("2d");
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  }
  const luminance = ({ r, g, b }) => {
    const ch = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [luminance(rgba(a)), luminance(rgba(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const transparent = (color) => rgba(color).a < 0.05;
  /** A box the eye sees: a fill or a border */
  function boxed(el) {
    const s = css(el);
    if (!transparent(s.backgroundColor) || s.backgroundImage !== "none") return true;
    return ["Top", "Right", "Bottom", "Left"].some(
      (side) => parseFloat(s[`border${side}Width`]) > 0 && !transparent(s[`border${side}Color`]) && s[`border${side}Style`] !== "none",
    );
  }

  // ── Squeezed title ──────────────────────────────────────────────────────
  const squeezed = [];
  const h1 = [...main.querySelectorAll("h1")].find(visible);
  if (h1) {
    const t = h1.getBoundingClientRect();
    const lineHeight = parseFloat(css(h1).lineHeight) || parseFloat(css(h1).fontSize) * 1.2;
    const lines = Math.round(t.height / lineHeight);
    // The row: the nearest wider ancestor with a control beside the title
    let row = null;
    let controls = [];
    for (let el = h1.parentElement; el && el !== main.parentElement; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width <= t.width + 4) continue;
      controls = [...el.querySelectorAll("a[href], button, [role=button]")].filter((c) => {
        if (h1.contains(c) || !visible(c)) return false;
        const b = c.getBoundingClientRect();
        return b.top < t.bottom && b.bottom > t.top && (b.left >= t.right || b.right <= t.left);
      });
      if (controls.length) row = el;
      break;
    }
    if (row) {
      const r = row.getBoundingClientRect();
      const s = css(row);
      const width = r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const share = t.width / width;
      if (share < 0.6 && lines > 1)
        squeezed.push({ title: text(h1), why: `${Math.round(share * 100)}% of its row`, controls: controls.length });
    }
    if (innerWidth <= 400 && lines > 2) squeezed.push({ title: text(h1), why: `${lines} lines at ${innerWidth}px` });
  }

  // ── Commands that look like text ────────────────────────────────────────
  const plainCommands = [];
  // The text colours (fg-heading, fg-primary, fg-secondary, fg-muted): a command in one reads as text
  const TEXT_COLOURS = new Set(["d8dcd8", "c5cacb", "9ba4ad", "727b83"]);
  const SKIP_ROLES = new Set(["tab", "menuitem", "menuitemradio", "menuitemcheckbox", "option", "combobox", "switch", "checkbox", "radio"]);
  for (const el of main.querySelectorAll("a[href], button, [role=button]")) {
    if (!visible(el) || !text(el) || el.closest("[inert], [aria-hidden=true], dialog, [popover]")) continue;
    if (SKIP_ROLES.has(el.getAttribute("role"))) continue;
    // An icon, a cover or a heading inside, or a title that is a link: its role shows
    if (el.querySelector("svg, img, picture, video, canvas, h1, h2, h3, h4, [data-decorative]") || el.closest("h1, h2, h3, h4, h5, h6")) continue;
    const s = css(el);
    if (boxed(el) || s.textDecorationLine.includes("underline") || s.borderBottomStyle !== "none" && parseFloat(s.borderBottomWidth) > 0) continue;
    if ([...el.querySelectorAll("*")].some((c) => boxed(c) || css(c).textDecorationLine.includes("underline"))) continue;
    const parent = el.parentElement;
    // A button beside a boxed button: a dialog's or form's Cancel beside Save
    if ([...parent.children].some((c) => c !== el && c.matches("button, a[href]") && boxed(c))) continue;
    // A link inside a sentence of running text: its line is the cue (and WCAG's)
    let block = parent;
    while (block && /^inline/.test(css(block).display)) block = block.parentElement;
    const own = text(el).length;
    const inSentence = el.tagName === "A" && /^inline/.test(s.display) && block && text(block).length > own + 24 && /[.,;:]/.test(text(block));
    if (inSentence && !el.matches("[data-command]")) continue;
    // The text beside it: a text node or element in its row, else the row's colour
    let around = null;
    for (const sib of parent.childNodes) {
      if (sib === el) continue;
      if (sib.nodeType === Node.TEXT_NODE && sib.textContent.trim()) { around = css(parent).color; break; }
      if (sib.nodeType === Node.ELEMENT_NODE && visible(sib) && text(sib) && !sib.matches("a[href], button")) { around = css(sib).color; break; }
    }
    around ??= css(parent).color;
    const r = ratio(s.color, around);
    const c = rgba(s.color);
    const textColour = TEXT_COLOURS.has([c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join(""));
    if (textColour || r < 1.25) plainCommands.push({ element: name(el), text: text(el), color: s.color, around, ratio: round(r) });
  }

  // ── Drifting edges inside cards ─────────────────────────────────────────
  const drift = [];
  const cards = new Set([...main.querySelectorAll("*")].filter((el) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 48 || !text(el)) return false;
    const s = css(el);
    const bordered = ["Top", "Right", "Bottom", "Left"].every((side) => parseFloat(s[`border${side}Width`]) > 0 && !transparent(s[`border${side}Color`]));
    return bordered && !transparent(s.backgroundColor) && !el.matches("a, button, input, select, textarea, dialog, [popover]");
  }));
  const inCard = (el, card) => {
    for (let e = el; e && e !== card; e = e.parentElement) if (cards.has(e)) return false;
    return true;
  };
  /** Where a block's first line of ink starts: text, an icon or a boxed element */
  function inkLeft(block) {
    if (boxed(block)) return block.getBoundingClientRect().left;
    const marks = [];
    const walk = (el) => {
      if (!visible(el) || ["absolute", "fixed"].includes(css(el).position)) return;
      if (el !== block && (boxed(el) || el.matches("svg, img, input, select, textarea, video, canvas, picture"))) {
        marks.push(el.getBoundingClientRect());
        return;
      }
      for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          const rect = [...range.getClientRects()].find((x) => x.width > 0);
          if (rect) marks.push(rect);
        } else if (n.nodeType === Node.ELEMENT_NODE) walk(n);
      }
    };
    walk(block);
    if (!marks.length) return null;
    // The first line: every mark that overlaps the topmost one vertically
    const topmost = marks.reduce((a, m) => (m.top < a.top ? m : a));
    const firstLine = marks.filter((m) => m.top < topmost.bottom - 1);
    return Math.min(...firstLine.map((m) => m.left));
  }
  const intended = (el, card) => {
    for (let e = el; e && e !== card.parentElement; e = e.parentElement) if (e.hasAttribute("data-inset")) return true;
    return false;
  };
  const seen = new Set();
  for (const card of cards) {
    for (const column of [card, ...card.querySelectorAll("*")]) {
      if (!inCard(column, card) || !visible(column) || column.matches("a, button, label, p, span, h1, h2, h3, h4, h5, h6, li, dt, dd, svg, svg *")) continue;
      const s = css(column);
      if (s.display === "inline" || s.display === "contents" || (s.display.includes("flex") && !s.flexDirection.startsWith("column")) || s.display.includes("grid") && s.gridTemplateColumns.split(" ").length > 1) continue;
      const kids = [...column.children].filter((c) => visible(c) && !["absolute", "fixed"].includes(css(c).position));
      if (kids.length < 2) continue;
      if (kids.some((c, i) => i && c.getBoundingClientRect().top < kids[i - 1].getBoundingClientRect().bottom - 1)) continue;
      const r = column.getBoundingClientRect();
      const left = r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
      for (const kid of kids) {
        if (cards.has(kid) || boxed(kid) || css(kid).textAlign === "center") continue;
        // A wrapping row of controls: the first control of every line
        const ks = css(kid);
        const lines = [];
        if (ks.display.includes("flex") && !ks.flexDirection.startsWith("column") && ks.flexWrap === "wrap") {
          let lastTop = -Infinity;
          for (const item of [...kid.children].filter(visible)) {
            const top = item.getBoundingClientRect().top;
            if (top > lastTop + 4) lines.push(item);
            lastTop = Math.max(lastTop, top);
          }
        } else lines.push(kid);
        for (const start of lines) {
          if (seen.has(start) || intended(start, card)) continue;
          const ink = inkLeft(start);
          if (ink === null) continue;
          const off = ink - left;
          if (Math.abs(off) > DRIFT_MIN && Math.abs(off) <= DRIFT_MAX) {
            seen.add(start);
            drift.push({ element: name(start), text: text(start), off: round(off), column: name(column), card: name(card) });
          }
        }
      }
    }
  }

  // ── Distance to the first card on a list page ───────────────────────────
  const first = [...main.querySelectorAll(".card-interactive, .catalogue-card, [data-card]")].find(visible);
  const firstContent = first
    ? { top: Math.round(first.getBoundingClientRect().top + scrollY), screen: innerHeight, late: first.getBoundingClientRect().top + scrollY > innerHeight * 0.6 }
    : null;

  return { page: location.pathname, width: innerWidth, squeezed, plainCommands, drift, firstContent };
})();
