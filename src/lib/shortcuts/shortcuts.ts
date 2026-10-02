/**
 * Keyboard shortcuts: the list (one source for the handler, the help sheet
 * and the command palette hints) and the page rules that decide what Enter
 * and ⌘Enter press. Client module.
 *
 * Keys are written as tokens: "mod" (⌘ on a Mac, Ctrl elsewhere), "alt",
 * "shift", "enter", "esc", or the character itself.
 */

export type Keys = string[];

/** G, then one of these keys */
export const GO_TO: { key: string; label: string; href: string }[] = [
  { key: "d", label: "Dashboard", href: "/" },
  { key: "l", label: "Library", href: "/library" },
  { key: "a", label: "Authors", href: "/authors" },
  { key: "p", label: "Publishers", href: "/publishers" },
  { key: "s", label: "Series", href: "/series" },
  { key: "c", label: "Collections", href: "/collections" },
  { key: "o", label: "Provenance", href: "/provenance" },
  { key: "m", label: "Places", href: "/places" },
  { key: "t", label: "Taxonomy", href: "/taxonomy" },
  { key: "h", label: "Harmonize", href: "/harmonize" },
  { key: "r", label: "Reader", href: "/reader" },
  { key: ",", label: "Settings", href: "/settings" },
];

export const SHORTCUTS = {
  palette: ["mod", "k"],
  search: ["/"],
  newBook: ["n"],
  newAuthor: ["a"],
  help: ["?"],
  confirm: ["enter"],
  save: ["mod", "enter"],
  fixField: ["alt", "f"],
  close: ["esc"],
} satisfies Record<string, Keys>;

export const SHORTCUT_GROUPS: {
  title: string;
  /** Spans the sheet's two columns, with its rows in two columns */
  wide?: boolean;
  items: { keys: Keys; label: string; then?: boolean }[];
}[] = [
  {
    title: "Find and add",
    items: [
      { keys: SHORTCUTS.palette, label: "Search books, authors, commands" },
      { keys: SHORTCUTS.search, label: "Search this list" },
      { keys: SHORTCUTS.newBook, label: "Add a book" },
      { keys: SHORTCUTS.newAuthor, label: "Add an author" },
      { keys: SHORTCUTS.help, label: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Forms and dialogs",
    items: [
      { keys: SHORTCUTS.confirm, label: "Confirm, or next step" },
      { keys: SHORTCUTS.save, label: "Save, or Fast Track" },
      { keys: SHORTCUTS.fixField, label: "Fix title case or name order" },
      { keys: SHORTCUTS.close, label: "Close" },
    ],
  },
  {
    title: "Go to",
    wide: true,
    items: GO_TO.map((g) => ({ keys: ["g", g.key], label: g.label, then: true })),
  },
];

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** How a key token is printed on a key cap */
export function keyLabel(token: string, mac: boolean): string {
  switch (token) {
    case "mod":
      return mac ? "⌘" : "Ctrl";
    case "alt":
      return mac ? "⌥" : "Alt";
    case "shift":
      return "⇧";
    case "enter":
      return "↵";
    case "esc":
      return "Esc";
    default:
      return token.toUpperCase();
  }
}

const NOT_TEXT = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image",
]);

/** The user types into this element: single-key shortcuts must not fire */
export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    return true;
  return el instanceof HTMLInputElement && !NOT_TEXT.has(el.type);
}

const CONFIRM_TYPES = new Set([
  "text", "email", "url", "tel", "number", "date", "month", "time",
]);

/**
 * A one-line field where Enter means "confirm". Not a search or suggestion
 * field (Enter picks a result there), and not inside a native form (the
 * browser submits that one itself).
 */
export function isConfirmField(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (!CONFIRM_TYPES.has(el.type) || el.readOnly || el.form) return false;
  if (
    el.hasAttribute("list") ||
    el.hasAttribute("aria-autocomplete") ||
    el.hasAttribute("aria-haspopup") ||
    el.hasAttribute("aria-expanded") ||
    el.closest('[data-enter="ignore"], [cmdk-root], [role="combobox"], [role="listbox"]')
  )
    return false;
  return !/^\s*search\b/i.test(el.placeholder);
}

function shown(el: Element): boolean {
  return (
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
  );
}

function usable(button: HTMLButtonElement | undefined) {
  return button && !button.disabled && button.getAttribute("aria-disabled") !== "true"
    ? button
    : null;
}

function lastShown(root: Element, selector: string) {
  return [...root.querySelectorAll<HTMLButtonElement>(selector)]
    .filter(shown)
    .pop();
}

/** The dialog on top, else the page part that takes Enter (the Add Book steps) */
function shortcutScope(from: Element | null): Element | null {
  const dialogs = document.querySelectorAll("dialog[open]");
  if (dialogs.length) return dialogs[dialogs.length - 1];
  return (
    from?.closest("[data-shortcut-scope]") ??
    document.querySelector("[data-shortcut-scope]")
  );
}

const MAIN_BUTTON = 'button[data-variant="primary"]';

/**
 * The button that Enter ("next") or ⌘Enter ("save") presses, or null.
 *
 * Enter presses the step's forward button (`data-shortcut="next"`), else the
 * main button of the nearest group around the field: in a dialog with an
 * "Add" row above "Save", Enter in that row presses "Add". ⌘Enter presses
 * the scope's save button (`data-shortcut="save"`), else its last main
 * button. A disabled button blocks: the key never skips to another button.
 */
export function shortcutButton(
  from: Element | null,
  mode: "next" | "save",
): HTMLButtonElement | null {
  const scope = shortcutScope(from);
  if (!scope) return null;
  const inside = from && scope.contains(from) ? from : null;
  if (!inside && from && from !== document.body) return null;

  if (mode === "save")
    return usable(
      lastShown(scope, 'button[data-shortcut="save"]') ?? lastShown(scope, MAIN_BUTTON),
    );

  const next = lastShown(scope, 'button[data-shortcut="next"]');
  if (next) return usable(next);
  for (let el = inside?.parentElement ?? null; el; el = el === scope ? null : el.parentElement) {
    const main = lastShown(el, MAIN_BUTTON);
    if (main) return usable(main);
  }
  return null;
}

/** The list search box on this page ("Search authors...") */
export function pageSearchField(): HTMLInputElement | null {
  return (
    [...document.querySelectorAll<HTMLInputElement>("[data-shortcut-search]")]
      .filter(shown)
      .pop() ?? null
  );
}
