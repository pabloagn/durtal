/**
 * Unsaved work in a dialog or a form page (SLN-631). The state the person
 * can see and change is read from the page: field values, switches, radios,
 * sliders, the shown value of a select and the chips with Remove. The first
 * time the person acts in the form (a press, a key, a paste or a drop) that
 * state is noted; the form has unsaved work while its state differs from the
 * note. Values the form loads by itself before then are not the person's
 * work, and a change put back is no change.
 */

const STATE = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="slider"]',
  "[aria-pressed]",
  '[role="combobox"]:not(input)',
  "[data-draft-value]",
  'button[aria-label^="Remove "]',
].join(", ");

/**
 * Not the person's work: a search or filter field (its text only finds
 * things), an open list or menu, a floating layer, and what a form marks so.
 */
const NOT_WORK =
  '[data-draft-ignore], [role="listbox"], [role="menu"], [popover], [cmdk-root]';

const NOT_VALUES = new Set(["button", "submit", "reset", "image", "search"]);

function searchField(el: HTMLInputElement) {
  return (
    el.hasAttribute("data-picker") ||
    el.hasAttribute("data-shortcut-search") ||
    /^\s*(search|filter|find)\b/i.test(el.placeholder)
  );
}

function stateOf(el: Element): string | null {
  if (el.closest(NOT_WORK)) return null;
  if (el instanceof HTMLInputElement) {
    if (NOT_VALUES.has(el.type) || searchField(el)) return null;
    if (el.type === "checkbox" || el.type === "radio") return `${el.type}:${el.checked}`;
    if (el.type === "file") return `file:${el.files?.length ?? 0}:${el.value}`;
    return `input:${el.value}`;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    return `${el.tagName}:${el.value}`;
  if (el instanceof HTMLElement) {
    if (el.isContentEditable && el.getAttribute("contenteditable") === "true") return `text:${el.innerHTML}`;
    if (el.hasAttribute("data-draft-value")) return `value:${el.getAttribute("data-draft-value")}`;
    const role = el.getAttribute("role");
    if (role === "slider") return `slider:${el.getAttribute("aria-valuenow")}`;
    if (role === "switch" || role === "radio" || role === "checkbox")
      return `${role}:${el.getAttribute("aria-checked")}`;
    if (el.hasAttribute("aria-pressed")) return `pressed:${el.getAttribute("aria-pressed")}`;
    if (role === "combobox") return `choice:${el.textContent?.trim() ?? ""}`;
    if (el.tagName === "BUTTON") return `chip:${el.getAttribute("aria-label")}`;
  }
  return null;
}

/** What the person sees and can change in `root`, as one string */
export function draftState(root: Element): string {
  const parts: string[] = [];
  for (const el of root.querySelectorAll(STATE)) {
    const state = stateOf(el);
    if (state !== null) parts.push(state);
  }
  return parts.join("\u0000");
}

export interface DraftTracker {
  /** The person changed something and has not put it back */
  dirty(): boolean;
  /** The work was saved: what is there now is the new starting point */
  reset(): void;
  stop(): void;
}

const FIRST_ACTS = ["pointerdown", "keydown", "beforeinput", "paste", "drop"] as const;

export function trackDraft(root: HTMLElement): DraftTracker {
  let before: string | null = null;
  const note = () => {
    before ??= draftState(root);
  };
  for (const type of FIRST_ACTS) root.addEventListener(type, note, true);
  return {
    dirty: () => before !== null && draftState(root) !== before,
    reset: () => {
      before = null;
    },
    stop: () => {
      for (const type of FIRST_ACTS) root.removeEventListener(type, note, true);
    },
  };
}
