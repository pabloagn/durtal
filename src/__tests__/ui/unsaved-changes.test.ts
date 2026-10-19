// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { draftState } from "@/lib/ui/draft-tracker";
import { hasOpenSurface } from "@/lib/ui/surface-state";

// Esc cancels; unsaved work asks Save, Discard or Keep editing first (SLN-631).

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  // Laid out: the save button is found among the buttons shown
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
function escape(target: Element = document.activeElement ?? document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
/** What a person does to a field: a key, then the new value */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;
const prompt = () =>
  [...document.querySelectorAll("dialog[open]")].find((d) => d.textContent?.includes("Unsaved changes")) ?? null;
const answer = (name: string) =>
  [...(prompt()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === name)!;

function EditDialog({ onClose, onSave, saveDisabled = false }: { onClose: () => void; onSave: () => void; saveDisabled?: boolean }) {
  const [name, setName] = useState("Strange tales");
  const [notes, setNotes] = useState("");
  return createElement(
    Dialog,
    { open: true, onClose, title: "Edit collection", draft: true, children: null },
    createElement("input", { id: "name", value: name, onChange: (e: { target: HTMLInputElement }) => setName(e.target.value) }),
    createElement("textarea", { id: "notes", value: notes, onChange: (e: { target: HTMLTextAreaElement }) => setNotes(e.target.value) }),
    createElement("input", { id: "find", placeholder: "Search books...", defaultValue: "" }),
    createElement("button", { type: "button", "data-dismiss": "", onClick: onClose }, "Cancel"),
    createElement("button", { type: "button", "data-variant": "primary", disabled: saveDisabled, onClick: onSave }, "Save"),
  );
}

function renderEdit(props: { saveDisabled?: boolean } = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  act(() => root.render(createElement(EditDialog, { onClose, onSave, ...props })));
  return {
    onClose,
    onSave,
    name: document.getElementById("name") as HTMLInputElement,
    notes: document.getElementById("notes") as HTMLTextAreaElement,
    find: document.getElementById("find") as HTMLInputElement,
  };
}

describe("a dialog with a draft", () => {
  it("closes at once on Esc when nothing changed", () => {
    const { onClose, name } = renderEdit();
    act(() => name.focus());
    expect(escape(name).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(prompt()).toBeNull();
  });

  it("closes at once when a change was put back", () => {
    const { onClose, name } = renderEdit();
    type(name, "Strange tale");
    type(name, "Strange tales");
    escape(name);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not count a search typed in a picker as unsaved work", () => {
    const { onClose, find } = renderEdit();
    type(find, "borges");
    escape(find);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before Esc closes unsaved work, and Esc on the question keeps editing", async () => {
    const { onClose, notes } = renderEdit();
    act(() => notes.focus());
    type(notes, "Bought in Lisbon");
    escape(notes);
    expect(onClose).not.toHaveBeenCalled();
    expect(prompt()).not.toBeNull();
    expect(prompt()!.textContent).toContain("Save your changes before closing?");
    // A draft-loss prompt starts on the safe choice.
    expect(document.activeElement?.textContent).toBe("Keep editing");

    // Esc on the question is that layer's own: the dialog stays, with its draft
    escape();
    await wait();
    expect(prompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(notes.value).toBe("Bought in Lisbon");
    expect(document.activeElement).toBe(notes);
  });

  it("Discard closes without saving", () => {
    const { onClose, onSave, notes } = renderEdit();
    type(notes, "Bought in Lisbon");
    escape(notes);
    click(answer("Discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Save runs the dialog's own save, which closes it when it succeeds", async () => {
    const { onClose, onSave, notes } = renderEdit();
    type(notes, "Bought in Lisbon");
    escape(notes);
    click(answer("Save"));
    await wait();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(prompt()).toBeNull();
  });

  it("offers only Discard while the form cannot save", () => {
    const { notes } = renderEdit({ saveDisabled: true });
    type(notes, "Bought in Lisbon");
    escape(notes);
    expect(prompt()!.textContent).toContain("Discard them?");
    const saves = [...prompt()!.querySelectorAll("button")].filter((b) => b.textContent === "Save");
    expect(saves).toHaveLength(0);
    expect(document.activeElement?.textContent).toBe("Keep editing");
  });

  it("asks the same way from Cancel, Close and the backdrop", () => {
    const { onClose, notes } = renderEdit();
    type(notes, "Bought in Lisbon");
    click(button("Cancel")!);
    expect(onClose).not.toHaveBeenCalled();
    expect(prompt()).not.toBeNull();
    // Discard presses Cancel for real
    click(answer("Discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks from the Close button", () => {
    const { onClose, notes } = renderEdit();
    type(notes, "Bought in Lisbon");
    click(document.querySelector('[aria-label="Close Edit collection"]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(prompt()).not.toBeNull();
    click(answer("Keep editing"));
    expect(prompt()).toBeNull();
  });

  it("closes an open list inside it before asking anything", () => {
    const { onClose, notes } = renderEdit();
    type(notes, "Bought in Lisbon");
    const event = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true });
    event.preventDefault(); // what an open list or menu does with its Esc
    act(() => {
      notes.dispatchEvent(event);
    });
    expect(prompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks when only a date was picked", () => {
    const onClose = vi.fn();
    function EditionDialog() {
      const [day, setDay] = useState("");
      return createElement(
        Dialog,
        { open: true, onClose, title: "Edit edition", draft: true, children: null },
        createElement(DatePicker, { label: "Publication date", id: "published", value: day, onChange: setDay }),
        // What the calendar does with a day
        createElement("button", { type: "button", id: "day", onClick: () => setDay("2026-10-07") }, "7"),
      );
    }
    act(() => root.render(createElement(EditionDialog)));
    const day = document.getElementById("day")!;
    act(() => {
      day.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    click(day);
    escape(document.getElementById("published")!);
    expect(onClose).not.toHaveBeenCalled();
    expect(prompt()).not.toBeNull();
  });

  it("leaves an Esc that ends an input method's composition alone", () => {
    const { onClose, notes } = renderEdit();
    type(notes, "かな");
    escape(notes, { isComposing: true } as KeyboardEventInit);
    expect(prompt()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a dialog without a draft", () => {
  it("closes on Esc as before, whatever its fields hold", () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        createElement(Dialog, { open: true, onClose, title: "Search", children: null }, createElement("input", { id: "q" })),
      ),
    );
    const q = document.getElementById("q") as HTMLInputElement;
    type(q, "anything");
    escape(q);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(prompt()).toBeNull();
  });
});

describe("where a dialog starts", () => {
  it("starts in its first field, or in the field marked data-dialog-focus (SLN-1102)", () => {
    const fields = (mark: boolean) => [createElement("input", { id: "a", key: "a" }), createElement("input", { id: "b", key: "b", "data-dialog-focus": mark ? "" : undefined })];
    act(() => root.render(createElement(Dialog, { open: true, onClose: () => {}, title: "Edit", children: null }, ...fields(false))));
    expect(document.activeElement?.id).toBe("a");
    act(() => root.render(createElement("div")));
    act(() => root.render(createElement(Dialog, { open: true, onClose: () => {}, title: "Edit", children: null }, ...fields(true))));
    expect(document.activeElement?.id).toBe("b");
  });
});

function FormPage({ cancel, inner }: { cancel: () => void; inner?: () => void }) {
  const form = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const page = useEscapeToCancel({ root: form, cancel, track: true });
  useEscapeToCancel({ cancel: () => { setConfirming(false); inner?.(); }, enabled: confirming });
  return createElement(
    "div",
    null,
    page,
    createElement(
      "div",
      { ref: form },
      createElement("input", { id: "title" }),
      createElement("input", { id: "search", placeholder: "Search by ISBN, title or author" }),
      createElement("button", { type: "button", id: "ask", onClick: () => setConfirming(true) }, "Delete"),
      createElement("button", { type: "button", "data-shortcut": "save", "data-variant": "primary" }, "Add film"),
    ),
  );
}

describe("a form page", () => {
  it("Esc cancels it like Cancel when nothing is typed", () => {
    const cancel = vi.fn();
    act(() => root.render(createElement(FormPage, { cancel })));
    escape(document.body);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("asks first when something is typed", () => {
    const cancel = vi.fn();
    act(() => root.render(createElement(FormPage, { cancel })));
    type(document.getElementById("title") as HTMLInputElement, "The Thing");
    escape(document.getElementById("title")!);
    expect(cancel).not.toHaveBeenCalled();
    expect(prompt()).not.toBeNull();
    click(answer("Discard"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves the first Esc in a search field to the field", () => {
    const cancel = vi.fn();
    act(() => root.render(createElement(FormPage, { cancel })));
    escape(document.getElementById("search")!);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("closes a confirmation opened on the page before the page", () => {
    const cancel = vi.fn();
    const inner = vi.fn();
    act(() => root.render(createElement(FormPage, { cancel, inner })));
    click(document.getElementById("ask")!);
    escape(document.body);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    escape(document.body);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("lets a dialog over the page take Esc", () => {
    const cancel = vi.fn();
    const close = vi.fn();
    act(() =>
      root.render(
        createElement("div", null,
          createElement(FormPage, { cancel }),
          createElement(Dialog, { open: true, onClose: close, title: "Add person", children: null }),
        ),
      ),
    );
    expect(hasOpenSurface()).toBe(true);
    escape(document.body);
    expect(close).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("draftState", () => {
  it("reads values, switches, chips and a select's shown choice, not searches or open lists", () => {
    const div = document.createElement("div");
    div.innerHTML = `
      <input value="a"><textarea>b</textarea>
      <input type="checkbox" checked>
      <button role="switch" aria-checked="true"></button>
      <button aria-label="Remove Borges"></button>
      <div role="combobox">Spanish</div>
      <button data-draft-value="2026-10-07">2026-10-07</button>
      <input type="search" value="ignored">
      <div role="listbox"><input value="ignored"></div>
      <input data-draft-ignore value="ignored">`;
    expect(draftState(div).split("\u0000")).toEqual([
      "input:a", "TEXTAREA:b", "checkbox:true", "switch:true", "chip:Remove Borges", "choice:Spanish",
      "value:2026-10-07",
    ]);
  });
});
