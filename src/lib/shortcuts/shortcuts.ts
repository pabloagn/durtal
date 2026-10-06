/**
 * Keyboard shortcuts: the list (one source for the handler, the help sheet
 * and the command palette hints) and the page rules that decide what Enter
 * and ⌘Enter press. Client module.
 *
 * Keys are written as tokens: "mod" (⌘ on a Mac, Ctrl elsewhere), "alt",
 * "shift", "enter", "esc", or the character itself.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";

export type Keys = string[];

/** G opens the "Go to" menu; then one of these keys */
export const GO_TO: { key: string; label: string; href: string }[] = [
  { key: "d", label: "Dashboard", href: "/" },
  // Each open collection's home: Books (B), and the others when they open
  ...getEnabledWorkKinds().map((kind) => ({
    key: WORK_DOMAINS[kind].keys.go,
    label: WORK_DOMAINS[kind].pluralLabel,
    href: WORK_DOMAINS[kind].basePath,
  })),
  { key: "a", label: "People", href: "/people" },
  { key: "p", label: "Publishers", href: "/publishers" },
  { key: "s", label: "Series", href: "/series" },
  { key: "c", label: "Collections", href: "/collections" },
  { key: "o", label: "Provenance", href: "/provenance" },
  { key: "m", label: "Places", href: "/places" },
  { key: "t", label: "Taxonomy", href: "/taxonomy" },
  { key: "h", label: "Harmonize", href: "/harmonize" },
  // Reading progress has R; the e-book reader gets its own key in its epic
  { key: "r", label: "Reading", href: "/reading" },
  { key: ",", label: "Settings", href: "/settings" },
];

/** Add dialogs that open on any page */
export type AddDialog = "author" | "recommender" | "series" | "collection" | "place";

/** A opens the "Add" menu; then one of these keys */
export const ADD: ({ key: string; label: string; section: string } & (
  | { href: string }
  | { dialog: AddDialog }
))[] = [
  ...getEnabledWorkKinds().map((kind) => ({
    key: WORK_DOMAINS[kind].keys.add,
    label: WORK_DOMAINS[kind].label,
    section: WORK_DOMAINS[kind].basePath,
    href: `${WORK_DOMAINS[kind].basePath}/new`,
  })),
  { key: "a", label: "Person", section: "/people", dialog: "author" },
  { key: "p", label: "Publisher", section: "/publishers", href: "/publishers/new" },
  { key: "r", label: "Recommender", section: "/recommenders", dialog: "recommender" },
  { key: "s", label: "Series", section: "/series", dialog: "series" },
  { key: "c", label: "Collection", section: "/collections", dialog: "collection" },
  { key: "l", label: "Place", section: "/places", dialog: "place" },
];

/**
 * Y opens the "Copy" menu: what the open page offers, plus its link. Pages
 * give their own entries (CopyShortcuts); these keys stay the same on every
 * page. "Name" is the page's name: a book's title and author, an author's
 * name, a publisher's name.
 */
export const COPY_KEYS = {
  name: "n",
  title: "t",
  isbn: "i",
  address: "d",
  link: "l",
} as const;

/** The R menu on a book page (SLN-447) */
export const READING_KEYS = {
  start: "s",
  progress: "p",
  pause: "u",
  finish: "f",
  abandon: "a",
  past: "l",
  history: "h",
  timer: "t",
  queue: "n",
  quote: "q",
} as const;

/**
 * E opens the "Edit" menu: the edit actions the open page offers (now the
 * book page). Pages give their own entries (useEditActions); on a page with
 * none, E does nothing.
 */
export const EDIT_KEYS = {
  work: "w",
  media: "m",
  taxonomy: "t",
} as const;

export const SHORTCUTS = {
  palette: ["mod", "k"],
  /** S: the palette from any page but the e-book reader (SLN-477) */
  openSearch: ["s"],
  search: ["/"],
  addMenu: ["a"],
  goMenu: ["g"],
  copyMenu: ["y"],
  editMenu: ["e"],
  readingMenu: ["r"],
  help: ["?"],
  pick: ["↑", "↓"],
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
    title: "Menus",
    items: [
      { keys: SHORTCUTS.addMenu, label: "Add: book, person, publisher..." },
      { keys: SHORTCUTS.goMenu, label: "Go to a section" },
      { keys: SHORTCUTS.copyMenu, label: "Copy from this page" },
      { keys: SHORTCUTS.editMenu, label: "Edit this page" },
      { keys: SHORTCUTS.readingMenu, label: "Reading (a book)" },
      { keys: SHORTCUTS.palette, label: "Search books, people, commands" },
      { keys: SHORTCUTS.openSearch, label: "Search, from any page" },
      { keys: SHORTCUTS.search, label: "Search this list" },
      { keys: SHORTCUTS.help, label: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Lists, forms and dialogs",
    items: [
      { keys: SHORTCUTS.pick, label: "Move in a list or menu" },
      { keys: SHORTCUTS.confirm, label: "Pick, confirm, next step, Fast Track" },
      { keys: SHORTCUTS.save, label: "Save, or Fast Track" },
      { keys: SHORTCUTS.fixField, label: "Fix title case or name order" },
      { keys: SHORTCUTS.close, label: "Close a search, a list, a menu or a dialog" },
    ],
  },
  {
    title: "Add",
    wide: true,
    items: ADD.map((a) => ({ keys: ["a", a.key], label: a.label, then: true })),
  },
  {
    title: "Copy",
    wide: true,
    items: [
      { keys: ["y", COPY_KEYS.name], label: "Name (a book: title and author)", then: true },
      { keys: ["y", COPY_KEYS.title], label: "Title (a book)", then: true },
      { keys: ["y", COPY_KEYS.isbn], label: "ISBN (a book)", then: true },
      { keys: ["y", COPY_KEYS.address], label: "Address (a place)", then: true },
      { keys: ["y", COPY_KEYS.link], label: "Link to the page", then: true },
    ],
  },
  {
    title: "Edit",
    wide: true,
    items: [
      { keys: ["e", EDIT_KEYS.work], label: "Work (a book)", then: true },
      { keys: ["e", EDIT_KEYS.media], label: "Media (a book)", then: true },
      { keys: ["e", EDIT_KEYS.taxonomy], label: "Taxonomy (a book)", then: true },
    ],
  },
  {
    title: "Reading",
    wide: true,
    items: [
      { keys: ["r", READING_KEYS.start], label: "Start reading, or re-read", then: true },
      { keys: ["r", READING_KEYS.progress], label: "Log progress", then: true },
      { keys: ["r", READING_KEYS.pause], label: "Pause or resume", then: true },
      { keys: ["r", READING_KEYS.finish], label: "Finish", then: true },
      { keys: ["r", READING_KEYS.abandon], label: "Abandon", then: true },
      { keys: ["r", READING_KEYS.past], label: "Log a past read", then: true },
      { keys: ["r", READING_KEYS.timer], label: "Start or stop the timer", then: true },
      { keys: ["r", READING_KEYS.queue], label: "Add to or remove from Up Next", then: true },
      { keys: ["r", READING_KEYS.quote], label: "Add a quote", then: true },
      { keys: ["r", READING_KEYS.history], label: "Go to the Reading section", then: true },
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
/**
 * A key that belongs to an input method composing text (Japanese, Chinese,
 * Korean): an Esc there ends the composition and must close nothing. Safari
 * sends the key that ends a composition with keyCode 229 and isComposing
 * false, so both count (SLN-477).
 */
export function isComposing(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  // A combobox takes letters itself (type to find an option)
  if (el.getAttribute("role") === "combobox") return true;
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
  return !isPickerField(el);
}

/** A field that searches or filters a list: Enter picks from the list */
export function isPickerField(el: HTMLInputElement): boolean {
  return (
    el.type === "search" ||
    el.hasAttribute("data-picker") ||
    /^\s*(search|filter|find)\b/i.test(el.placeholder)
  );
}

/** A list box: a menu or a scrolling list of choices */
function isList(el: Element): boolean {
  if (el.matches('[role="listbox"], [role="menu"]')) return true;
  const style = getComputedStyle(el);
  return (
    style.position === "absolute" ||
    style.position === "fixed" ||
    /auto|scroll/.test(style.overflowY)
  );
}

const OPTION = '[role="option"], [data-option], button, label';

/** A choice in a list: it has text, and a label holds a checkbox or radio */
function isChoice(el: HTMLElement): boolean {
  return (
    shown(el) &&
    !!el.textContent?.trim() &&
    !el.closest("[data-variant]") &&
    !el.matches(':disabled, [aria-disabled="true"]') &&
    (el.tagName !== "LABEL" ||
      !!el.querySelector('input[type="checkbox"], input[type="radio"]'))
  );
}

/**
 * The choices that a picker field shows (the author results under "Search
 * author by name...", the options under "Search genres..."): the list after
 * the field or one of its wrappers, or the choices that follow it directly.
 * The dialog's own buttons are never choices.
 */
export function pickerOptions(field: HTMLInputElement): HTMLElement[] {
  if (!isPickerField(field)) return [];
  let node: Element | null = field;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    if (node.matches("dialog, form, main, [data-shortcut-scope]")) break;
    const found: HTMLElement[] = [];
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
      if (!(next instanceof HTMLElement) || !shown(next)) continue;
      if (next.matches(OPTION)) {
        if (isChoice(next)) found.push(next);
        continue;
      }
      for (const list of [next, ...next.children].filter(isList))
        found.push(
          ...[...list.querySelectorAll<HTMLElement>(OPTION)].filter(isChoice),
        );
    }
    if (found.length) return found;
  }
  return [];
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

/** The list search box on this page ("Search people...") */
export function pageSearchField(): HTMLInputElement | null {
  return (
    [...document.querySelectorAll<HTMLInputElement>("[data-shortcut-search]")]
      .filter(shown)
      .pop() ?? null
  );
}
