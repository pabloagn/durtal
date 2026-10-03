/**
 * Alignment audit: paste into the browser console (or run with a browser
 * automation tool) on any page. Returns every small icon that sits in a row
 * with text and whose center is more than TOLERANCE px away from the text's
 * cap-height center (the optical center of capitalized text, first line).
 *
 * An icon beside a stack of two or more text blocks (a number over a label)
 * is checked against the stack's center instead. Icons that do not share a
 * line with the text (a large placeholder above a title) are skipped.
 *
 * Every front-end change must pass this with an empty result on each page it
 * touches (see CLAUDE.md, "Pixel-perfect alignment").
 */
(() => {
  const TOLERANCE = 0.5;
  const MAX_ICON = 48;
  const ctx = document.createElement("canvas").getContext("2d");

  function firstText(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent.trim() && !n.parentElement.closest("svg")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    return walker.nextNode();
  }

  /**
   * Layout baseline of the line that holds character `index` of a text node,
   * in viewport px. A range's box is not a reliable base: for JetBrains Mono
   * at 14px it is 18.5px tall against an ascent + descent of 18px. Instead, a
   * zero-height inline-block goes right after the character: its bottom sits
   * on the baseline. The DOM is restored before returning.
   */
  function baseline(text, index) {
    // Text directly in a flex or grid box lays out in an anonymous item. A
    // wrapper stands in for that item, so the probe joins the text's line.
    let box = text.parentElement;
    while (getComputedStyle(box).display === "contents") box = box.parentElement;
    let wrap = null;
    if (/flex|grid|box/.test(getComputedStyle(box).display)) {
      const inRun = (n) =>
        n?.nodeType === Node.TEXT_NODE || n?.nodeType === Node.COMMENT_NODE;
      const run = [text];
      while (inRun(run[0].previousSibling)) run.unshift(run[0].previousSibling);
      while (inRun(run.at(-1).nextSibling)) run.push(run.at(-1).nextSibling);
      wrap = document.createElement("span");
      wrap.style.cssText = "all:unset";
      run[0].before(wrap);
      wrap.append(...run);
    }
    const probe = document.createElement("span");
    probe.style.cssText =
      "all:unset;display:inline-block;width:1px;height:0;margin-right:-1px;vertical-align:baseline";
    const rest = text.splitText(index + 1);
    rest.before(probe);
    const y = probe.getBoundingClientRect().bottom;
    probe.remove();
    text.appendData(rest.data);
    rest.remove();
    wrap?.replaceWith(...wrap.childNodes);
    return y;
  }

  /** First line of a text node: its box and cap-height center, in viewport px */
  function firstLine(text) {
    const range = document.createRange();
    const start = text.textContent.search(/\S/);
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    const rect = range.getClientRects()[0];
    // Next keeps a hidden copy of a page after client navigation: no size
    if (!rect?.width || !rect.height) return null;
    const cs = getComputedStyle(text.parentElement);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const metrics = ctx.measureText("H");
    return {
      rect,
      cap: baseline(text, start) - metrics.actualBoundingBoxAscent / 2,
    };
  }

  /** A column of two or more text blocks, e.g. a number over its label */
  function isStack(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const blocks = [...el.children].filter((c) => c.textContent.trim() && visible(c));
    return (
      blocks.length >= 2 &&
      blocks[1].getBoundingClientRect().top >= blocks[0].getBoundingClientRect().bottom - 1
    );
  }

  /** Box of the icon's own column in the row that holds the text */
  function outerBox(svg, holder) {
    let el = svg;
    while (el.parentElement && !el.parentElement.contains(holder)) el = el.parentElement;
    return el.getBoundingClientRect();
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.opacity !== "0";
  }

  function label(el) {
    const parts = [];
    for (let n = el; n && parts.length < 3 && n !== document.body; n = n.parentElement)
      parts.unshift(
        n.tagName.toLowerCase() +
          (n.getAttribute("aria-label") ? `[${n.getAttribute("aria-label")}]` : ""),
      );
    return parts.join(" > ");
  }

  const issues = [];
  let checked = 0;
  for (const svg of document.querySelectorAll("svg")) {
    if (svg.parentElement?.closest("svg") || !visible(svg)) continue;
    const box = svg.getBoundingClientRect();
    if (box.width > MAX_ICON || box.height > MAX_ICON) continue;

    // Nearest flex row (up to 4 levels) that holds text beside the icon
    let node = svg;
    let text = null;
    let holder = null;
    for (let depth = 0; depth < 4 && node.parentElement && !text; depth++) {
      const row = node.parentElement;
      const cs = getComputedStyle(row);
      const isRow =
        cs.display.includes("flex") && !cs.flexDirection.startsWith("column");
      if (isRow || cs.display.includes("inline")) {
        for (const child of row.childNodes) {
          if (child === node || child.contains?.(svg)) continue;
          if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            text = child;
            break;
          }
          if (child.nodeType === Node.ELEMENT_NODE && visible(child)) {
            const t = firstText(child);
            if (t) {
              text = t;
              holder = child;
              break;
            }
          }
        }
      }
      node = row;
    }
    if (!text) continue;
    const line = firstLine(text);
    if (!line) continue;
    const center = box.top + box.height / 2;
    let target = line.cap;
    // A compact stack (a number over a label) with an icon box of about its
    // height centers the icon on itself; otherwise the first line counts
    const stackBox = holder?.getBoundingClientRect();
    const iconBox = node === svg ? box : outerBox(svg, holder);
    // An icon inside a large tile (an image placeholder) is not beside the text
    if (iconBox.height > 3 * box.height) continue;
    if (isStack(holder) && iconBox.height >= 0.6 * stackBox.height) {
      target = stackBox.top + stackBox.height / 2;
    } else if (box.bottom <= line.rect.top || box.top >= line.rect.bottom) {
      continue; // not on the same line as the text
    }
    checked++;
    const off = +(center - target).toFixed(2);
    if (Math.abs(off) > TOLERANCE)
      issues.push({
        off,
        text: text.textContent.trim().slice(0, 32),
        font: getComputedStyle(text.parentElement).fontSize,
        where: label(svg),
      });
  }
  return { page: location.pathname, checked, issues };
})();
