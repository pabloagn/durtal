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
  { key: "r", label: "Reading", href: "/reading" },
  { key: "k", label: "eBooks", href: "/ebooks" },
  { key: ",", label: "Settings", href: "/settings" },
];

/** Add dialogs that open on any page */
export type AddDialog = "author" | "recommender" | "series" | "collection" | "place" | "organization";

/**
 * What can be added from any page (SLN-632): A then one of these keys adds it
 * at once, and N opens the "New" menu that lists them. A alone opens nothing.
 */
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
  // P is Perfume (the owner's A then P), so a publisher is A then U
  { key: "u", label: "Publisher", section: "/publishers", href: "/publishers/new" },
  { key: "o", label: "Organization", section: "/organizations", dialog: "organization" },
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
 * E opens the "Edit" menu: the edit actions the open page offers. Pages give
 * their own entries (useEditActions); on a page with none, E does nothing.
 * The letter is the first of what it edits: W the work (a book, film,
 * perfume or painting), M its media, T its taxonomy, and on the other pages
 * the item itself: C a collection, P a person, publisher or place, O an
 * organization, S a series, R a recommender (SLN-633).
 */
export const EDIT_KEYS = {
  work: "w",
  media: "m",
  taxonomy: "t",
  collection: "c",
  person: "p",
  publisher: "p",
  organization: "o",
  series: "s",
  place: "p",
  recommender: "r",
} as const;

/** How an action menu shows E then `key`: "E W" */
export function editHint(key: string) {
  return `E ${key.toUpperCase()}`;
}

/** How a tooltip shows E then `key` (`data-tooltip-keys`): "e then w" */
export function editTooltipKeys(key: string) {
  return `e then ${key}`;
}

/** Where a token's key has another name in aria-keyshortcuts */
const ARIA_KEY_NAMES: Record<string, string> = {
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  tab: "Tab",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "+": "Plus",
};

/**
 * A control's shortcut for assistive technology (`aria-keyshortcuts`), from
 * its tooltip's key tokens: "mod k" is "Meta+K" on a Mac and "Control+K"
 * elsewhere, "alt left" is "Alt+ArrowLeft". A sequence ("e then w") is
 * written as the app prints it, "E W" (SLN-964).
 */
export function ariaKeyShortcuts(keys: string, mac: boolean): string {
  return keys
    .trim()
    .split(/\s+then\s+/)
    .map((step) =>
      step
        .split(/\s+/)
        .map((token) => (token === "mod" ? (mac ? "Meta" : "Control") : (ARIA_KEY_NAMES[token] ?? token.toUpperCase())))
        .join("+"),
    )
    .join(" ");
}

/**
 * A control's shortcut, for its tooltip (`data-tooltip-keys`) and for
 * assistive technology (`aria-keyshortcuts`): spread it on the control.
 * A shortcut with "mod" passes `useIsMac()`.
 */
export function shortcutProps(keys: string | undefined, mac = true) {
  if (!keys) return {};
  return { "data-tooltip-keys": keys, "aria-keyshortcuts": ariaKeyShortcuts(keys, mac) };
}

/** What A then these keys do on an item's page, before the Add entry (SLN-571) */
export const ITEM_KEY_LABELS: Record<string, string> = {
  f: "favourite the page's item",
  c: "add the page's item to a collection",
};

export const SHORTCUTS = {
  palette: ["mod", "k"],
  /** S: the palette from any page but the e-book reader (SLN-477) */
  openSearch: ["s"],
  search: ["/"],
  newMenu: ["n"],
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
      { keys: SHORTCUTS.newMenu, label: "New: book, perfume, person..." },
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
      { keys: SHORTCUTS.close, label: "Close a search, a list, a menu or a dialog; cancel a form" },
    ],
  },
  {
    title: "Add",
    wide: true,
    // On an item's page A then F and A then C act on the item (SLN-571)
    items: ADD.map((a) => ({
      keys: ["a", a.key],
      label: a.key in ITEM_KEY_LABELS ? `${a.label}, or ${ITEM_KEY_LABELS[a.key]}` : a.label,
      then: true,
    })),
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
      { keys: ["e", EDIT_KEYS.work], label: "Work: a book, film, perfume or painting", then: true },
      { keys: ["e", EDIT_KEYS.media], label: "Media, images or artwork", then: true },
      { keys: ["e", EDIT_KEYS.taxonomy], label: "Taxonomy (a book)", then: true },
      { keys: ["e", EDIT_KEYS.collection], label: "Collection", then: true },
      { keys: ["e", EDIT_KEYS.person], label: "Person, publisher or place", then: true },
      { keys: ["e", EDIT_KEYS.organization], label: "Organization", then: true },
      { keys: ["e", EDIT_KEYS.series], label: "Series", then: true },
      { keys: ["e", EDIT_KEYS.recommender], label: "Recommender", then: true },
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
      { keys: ["r", READING_KEYS.queue], label: "Add to or remove from Up next", then: true },
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
    case "escape":
      return "Esc";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "space":
      return "Space";
    case "pageup":
      return "Page Up";
    case "pagedown":
      return "Page Down";
    case "home":
      return "Home";
    case "end":
      return "End";
    case "tab":
      return "Tab";
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

/**
 * A text box in a dialog: Enter saves there as in a one-line field, and
 * Shift+Enter starts a new line (SLN-631). On a page a text box keeps its
 * Enter, and `data-enter="ignore"` keeps it anywhere.
 */
export function isDialogTextBox(el: EventTarget | null): el is HTMLTextAreaElement {
  return (
    el instanceof HTMLTextAreaElement &&
    !el.readOnly &&
    !!el.closest("dialog") &&
    !el.closest('[data-enter="ignore"], [cmdk-root], [role="combobox"], [role="listbox"]')
  );
}

/** Elements with an Enter of their own: a button, a link, a field, a list */
const OWN_ENTER = [
  "a[href]", "button", "input", "select", "textarea", "summary", "[contenteditable]",
  "[cmdk-root]", '[data-enter="ignore"]',
  ...["button", "link", "menuitem", "option", "tab", "switch", "checkbox", "radio",
    "combobox", "slider", "listbox", "menu", "tree", "grid"].map((r) => `[role="${r}"]`),
].join(", ");

/**
 * Focus in a dialog on nothing with an Enter of its own: the dialog itself
 * (one with no field starts there, a confirmation) or a passage of text.
 * Enter presses the dialog's main button.
 */
export function isQuietInDialog(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && !!el.closest("dialog") && !el.closest(OWN_ENTER);
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

/** The dialog on top, else the page part that takes Enter (the Add book steps) */
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

  if (mode === "save") return saveButtonIn(scope);
  return usable(nextButton(scope, inside) ?? undefined);
}

/** The button Enter presses from `inside`, whether or not it is on */
function nextButton(scope: Element, inside: Element | null): HTMLButtonElement | null {
  const next = lastShown(scope, 'button[data-shortcut="next"]');
  if (next) return next;
  // From the field's group outward; from the dialog itself, the dialog
  let el = inside === scope ? scope : inside?.parentElement ?? null;
  for (; el; el = el === scope ? null : el.parentElement) {
    const main = lastShown(el, MAIN_BUTTON);
    if (main) return main;
  }
  return null;
}

/**
 * Enter from `from` has a button to press, but it is off (the form is not
 * valid yet, or it is saving). Enter then does nothing at all: in a dialog's
 * text box it starts no new line either.
 */
export function enterButtonOff(from: Element | null): boolean {
  const scope = shortcutScope(from);
  if (!scope || !from || !scope.contains(from)) return false;
  const button = nextButton(scope, from);
  return !!button && !usable(button);
}

/**
 * The button that saves `scope` (a dialog, a form page): its
 * `data-shortcut="save"` button, else its last main button. Null while that
 * button is off (the form is not valid yet, or it is saving).
 */
export function saveButtonIn(scope: Element): HTMLButtonElement | null {
  return usable(
    lastShown(scope, 'button[data-shortcut="save"]') ?? lastShown(scope, MAIN_BUTTON),
  );
}

/** The list search box on this page ("Search people...") */
export function pageSearchField(): HTMLInputElement | null {
  return (
    [...document.querySelectorAll<HTMLInputElement>("[data-shortcut-search]")]
      .filter(shown)
      .pop() ?? null
  );
}
