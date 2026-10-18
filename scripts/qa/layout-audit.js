/**
 * Layout audit (SLN-695): paste into the browser console (or run with a
 * browser automation tool) on any page, after it has painted. It looks for
 * what the overflow, alignment, design and touch audits pass but a reader
 * still sees:
 *
 * - squeezed: the page title (the h1 in main) wraps while it is narrower than
 *   60% of its row, because controls share that row; or it runs to more than
 *   2 lines on a phone (a screen 400px wide or less), 4 for a long title the
 *   phone sets a size smaller (`data-title-length`).
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
 *   controls is checked on every line. The rows of a divided list
 *   (`divide-y`) are not boxes for their rule, and their ink is measured
 *   from the padding most of them carry. Mark an intended inset with
 *   `data-inset` on the block or any element around it. A label and value
 *   list laid out as a grid (a `dl`, such as a film's facts) is checked the
 *   same way, up to 16px: each term's and value's ink against its own cell.
 * - firstContent: where the first card starts. On a list page seen on a
 *   phone it should start in the top 60% of the first screen (487px on the
 *   phone audit's 812px tall screen): `late` is true when it does not. Only
 *   a runner knows which pages are lists; a detail page's cards come later
 *   by design.
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
  const ruled = (el, side) => {
    const s = css(el);
    return parseFloat(s[`border${side}Width`]) > 0 && !transparent(s[`border${side}Color`]) && s[`border${side}Style`] !== "none";
  };
  /** A box the eye sees: a fill or a border (`apart`: a divided list's rule) */
  function boxed(el, apart) {
    const s = css(el);
    if (!transparent(s.backgroundColor) || s.backgroundImage !== "none") return true;
    return ["Top", "Right", "Bottom", "Left"].some((side) => side !== apart && ruled(el, side));
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
    // A long title steps down the type scale on a phone (DetailTitleRow's
    // data-title-length) and may take four lines; any other, two
    const allowed = ["long", "longer"].includes(h1.getAttribute("data-title-length")) ? 4 : 2;
    if (innerWidth <= 400 && lines > allowed) squeezed.push({ title: text(h1), why: `${lines} lines at ${innerWidth}px` });
  }

  // ── Commands that look like text ────────────────────────────────────────
  const plainCommands = [];
  // The text colours (fg-heading, fg-primary, fg-secondary, fg-muted): a command in one reads as text
  const TEXT_COLOURS = new Set(["d8dcd8", "c5cacb", "9ba4ad", "7d868e"]);
  const SKIP_ROLES = new Set(["tab", "menuitem", "menuitemradio", "menuitemcheckbox", "option", "combobox", "switch", "checkbox", "radio"]);
  for (const el of main.querySelectorAll("a[href], button, [role=button]")) {
    if (!visible(el) || !text(el) || el.closest("[inert], [aria-hidden=true], dialog, [popover]")) continue;
    if (SKIP_ROLES.has(el.getAttribute("role"))) continue;
    // The page or step in view reads as a state, not a command
    if (["page", "step", "location"].includes(el.getAttribute("aria-current"))) continue;
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
    // The sentence is the block's own words: other links and buttons beside it are not prose
    let prose = block ? text(block) : "";
    if (block) for (const c of block.querySelectorAll("a[href], button, [role=button]")) prose = prose.replace(text(c), " ");
    prose = prose.replace(/\s+/g, " ").trim();
    const inSentence = el.tagName === "A" && /^inline/.test(s.display) && prose.length > 24 && /[.,;:]/.test(prose);
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
  /** `layered`: count absolutely placed ink too (a star drawn in layers); `apart` as in `boxed` */
  function inkLeft(block, layered = false, apart) {
    if (boxed(block, apart)) return block.getBoundingClientRect().left;
    const marks = [];
    const walk = (el) => {
      if (!visible(el) || (!layered && ["absolute", "fixed"].includes(css(el).position))) return;
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
      let left = r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
      // A divided list (`divide-y`): its rule doesn't make a row a box. The
      // list pads its rows rather than itself, so the rules run to the box's
      // edges: ink is measured from the padding most rows carry, so a row
      // padded differently is the one reported (SLN-893)
      const divider = kids.slice(1).every((k) => ruled(k, "Top")) ? "Top" : kids.slice(0, -1).every((k) => ruled(k, "Bottom")) ? "Bottom" : null;
      const pads = kids.map((k) => parseFloat(css(k).paddingLeft));
      const count = (p) => pads.filter((q) => q === p).length;
      const common = pads.reduce((best, p) => (count(p) > count(best) ? p : best), pads[0]);
      if (divider && common > 0 && kids.every((k) => Math.abs(k.getBoundingClientRect().left - left) < 0.5)) left += common;
      for (const kid of kids) {
        if (cards.has(kid) || boxed(kid, divider) || css(kid).textAlign === "center") continue;
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
          const ink = inkLeft(start, false, start === kid ? divider : undefined);
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

  // ── Drifting edges in label and value grids ─────────────────────────────
  // A value that spans the grid (a control too wide for its column) is held
  // to the cell's edge too, which is the labels' edge
  const LIST_DRIFT_MAX = 16;
  for (const list of main.querySelectorAll("dl")) {
    if (!visible(list) || !css(list).display.includes("grid")) continue;
    for (const cell of list.children) {
      if (!cell.matches("dt, dd") || !visible(cell) || seen.has(cell) || intended(cell, list) || boxed(cell)) continue;
      const s = css(cell);
      if (s.textAlign === "center" || s.textAlign === "right" || s.textAlign === "end") continue;
      const ink = inkLeft(cell, true);
      if (ink === null) continue;
      const r = cell.getBoundingClientRect();
      const off = ink - (r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft));
      if (Math.abs(off) > DRIFT_MIN && Math.abs(off) <= LIST_DRIFT_MAX) {
        seen.add(cell);
        drift.push({ element: name(cell), text: text(cell), off: round(off), column: name(cell), card: name(list) });
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
