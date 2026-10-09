/** Shared browser helpers; imported by the CLI and synthetic DOM regressions. */
export const HELPERS = `window.__ia = {
  name(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.getAttribute('placeholder');
    const text = (label || el.innerText || el.value || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 50);
    return el.tagName.toLowerCase() + ' "' + text + '"';
  },
  hidden(el) {
    // What a closed <details> folds away has a box but is not rendered: it
    // cannot be focused or pressed until the reader opens it (SLN-544)
    if (!el || el.closest('[inert], [aria-hidden=true]')) return true;
    if (el.checkVisibility && !el.checkVisibility()) return true;
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) {
      const summary = [...d.children].find((c) => c.tagName === 'SUMMARY');
      if (!summary?.contains(el)) return true;
    }
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) return true;
    }
    const r = el.getBoundingClientRect();
    return r.width < 1 || r.height < 1;
  },
  ring(el) {
    const s = getComputedStyle(el);
    return [s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? s.outlineStyle + s.outlineWidth + s.outlineColor : '',
      s.boxShadow, s.backgroundColor, s.borderColor, s.color, s.textDecorationLine].join('|');
  },
  /** Whether focus shows: the focused look differs from the same element without focus */
  focusShows(el) {
    // Transitions would still show the focused look right after the blur
    const still = document.createElement('style');
    still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(still);
    const own = (e) => {
      const look = [this.ring(e)];
      for (const c of e.querySelectorAll('*')) look.push(this.ring(c));
      return look.join('/');
    };
    const focused = own(el);
    const parentFocused = el.parentElement ? this.ring(el.parentElement) : '';
    el.blur();
    const plain = own(el);
    const parentPlain = el.parentElement ? this.ring(el.parentElement) : '';
    el.focus({ focusVisible: true });
    still.remove();
    return focused !== plain || parentFocused !== parentPlain;
  },
  dialog() { return [...document.querySelectorAll('dialog[open], [role=dialog]')].filter((d) => !this.hidden(d)).pop() ?? null; },
  menu() { return [...document.querySelectorAll('[role=menu]')].filter((m) => !this.hidden(m)).pop() ?? null; },
};`;
