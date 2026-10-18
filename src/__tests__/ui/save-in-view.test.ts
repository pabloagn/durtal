// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useId } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import path from "path";
import { Dialog } from "@/components/ui/dialog";
import { DialogFooter as ReadingFooter } from "@/components/reading/dialogs/fields";

// The forms survey (finding 2) and the adding survey (item 7): Save started
// out of view on a phone in eight dialogs, and on the add page forms at any
// size. Their Cancel and Save now sit under the dialog's scrolling body, or
// in a bar pinned to the bottom of the page (SLN-943).

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
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

function ReadingForm({ onSubmit, notice }: { onSubmit: () => void; notice?: string }) {
  const id = useId();
  return h(
    "form",
    { id, onSubmit: (event: Event) => { event.preventDefault(); onSubmit(); } },
    h("input", { "aria-label": "Page" }),
    h(ReadingFooter, {
      form: id, onCancel: () => {}, saving: false, saveLabel: "Log",
      notice: notice ? h("p", { role: "alert" }, notice) : undefined,
    }),
  );
}
const button = (name: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === name)!;

describe("the reading dialogs' footer", () => {
  it("sits under the scrolling body and still submits the form", () => {
    const submit = vi.fn();
    act(() => root.render(h(Dialog, { open: true, onClose: () => {}, title: "Log progress", children: h(ReadingForm, { onSubmit: submit }) })));
    const body = document.querySelector("dialog .overflow-y-auto")!;
    expect(body.contains(button("Log"))).toBe(false);
    expect(body.contains(button("Cancel"))).toBe(false);
    expect(document.querySelector("dialog")!.contains(button("Log"))).toBe(true);
    act(() => button("Log").click());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("shows what Save turned up over the buttons, in view", () => {
    act(() => root.render(h(Dialog, { open: true, onClose: () => {}, title: "Log a past read", children: h(ReadingForm, { onSubmit: () => {}, notice: "Already logged" }) })));
    const alert = document.querySelector('[role="alert"]')!;
    expect(document.querySelector("dialog .overflow-y-auto")!.contains(alert)).toBe(false);
    expect(alert.parentElement).toBe(button("Log").parentElement);
  });
});

const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
// A self-closing footer (the reading dialogs'), or one with its buttons inside
const footers = (file: string) => source(file).match(/<DialogFooter\b[^>]*\/>|<DialogFooter\b[\s\S]*?<\/DialogFooter>/g) ?? [];

describe("the dialogs the survey measured", () => {
  it.each([
    "components/reading/dialogs/note-dialog.tsx",
    "components/reading/dialogs/edit-reading-dialog.tsx",
    "components/reading/dialogs/session-dialog.tsx",
  ])("name their form from the footer: %s", (file) => {
    expect(source(file)).toContain("<form id={formId}");
    expect(footers(file).some((footer) => footer.includes("form={formId}"))).toBe(true);
  });

  it.each([
    "components/paintings/art-object-dialog.tsx",
    "components/paintings/whereabouts-dialog.tsx",
    "components/perfumes/formulation-dialog.tsx",
    "components/films/version-dialog.tsx",
    "components/taxonomy/create-family-dialog.tsx",
  ])("keep Cancel, Save and the save error in the footer: %s", (file) => {
    const [footer] = footers(file);
    expect(footer).toContain('role="alert"');
    expect(footer).toContain("Cancel");
    expect(footer).toMatch(/data-shortcut="save"|type="submit"/);
  });
});

describe("the add page forms", () => {
  it.each([
    "components/films/film-form.tsx",
    "components/perfumes/perfume-form.tsx",
    "components/paintings/painting-form.tsx",
    "components/publishers/publisher-editor.tsx",
  ])("pin Cancel and Save to the bottom of the page: %s", (file) => {
    const [footer] = footers(file);
    expect(footer).toContain("outside={PINNED_PAGE_FOOTER}");
    expect(footer).toContain("Cancel");
  });

  it("name the publisher's button for what it does", () => {
    expect(source("components/publishers/publisher-editor.tsx")).toContain('{publisher ? "Save publisher" : "Add publisher"}');
  });
});
