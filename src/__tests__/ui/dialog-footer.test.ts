// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useId } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import path from "path";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

// Pass 5, item 1 (SLN-847): an edit dialog's Cancel and Save sit under its
// scrolling body, always in view, and nothing else in the dialog scrolls.

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

function Form({ onSubmit }: { onSubmit: () => void }) {
  const id = useId();
  return h(
    "form",
    { id, onSubmit: (event: Event) => { event.preventDefault(); onSubmit(); } },
    h("input", { "aria-label": "Title" }),
    h(DialogFooter, null, h("button", { type: "submit", form: id }, "Save changes")),
  );
}

const save = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Save changes")!;

describe("a dialog's footer", () => {
  it("sits outside the scrolling body, in the dialog", () => {
    act(() => root.render(h(Dialog, { open: true, onClose: () => {}, title: "Edit work", children: h(Form, { onSubmit: () => {} }) })));
    const dialog = document.querySelector("dialog")!;
    const body = dialog.querySelector(".overflow-y-auto")!;
    expect(dialog.contains(save())).toBe(true);
    expect(body.contains(save())).toBe(false);
    expect(body.contains(dialog.querySelector('input[aria-label="Title"]'))).toBe(true);
    // The body's own padding gives way to the footer's rule
    expect(body.className).toContain("pb-4");
  });

  it("still submits its form", () => {
    const submit = vi.fn();
    act(() => root.render(h(Dialog, { open: true, onClose: () => {}, title: "Edit edition", children: h(Form, { onSubmit: submit }) })));
    act(() => save().click());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("follows the fields on a page", () => {
    act(() => root.render(h(Form, { onSubmit: () => {} })));
    const form = host.querySelector("form")!;
    expect(form.contains(save())).toBe(true);
  });

  it("leaves a dialog without one as it was", () => {
    act(() => root.render(h(Dialog, { open: true, onClose: () => {}, title: "Notes", children: h("p", null, "Text") })));
    const dialog = document.querySelector("dialog")!;
    expect(dialog.querySelector(".overflow-y-auto")!.className).toContain("pb-6");
    expect(dialog.lastElementChild!.childElementCount).toBe(0);
  });
});

// With Save always in view, a form's reason for not saving goes over it:
// at the end of the scrolling body it would be out of view whenever the
// fields are scrolled to the top
describe("a form's save error", () => {
  const footers = (file: string) =>
    readFileSync(path.resolve(__dirname, "../..", file), "utf8").match(/<DialogFooter[\s\S]*?<\/DialogFooter>/g) ?? [];
  it.each([
    "components/organizations/organization-dialog.tsx",
    "components/films/film-form.tsx",
    "components/paintings/painting-form.tsx",
    "components/perfumes/perfume-form.tsx",
    "app/(catalogue)/library/[slug]/instance-add-dialog.tsx",
    "app/(catalogue)/library/[slug]/instance-edit-dialog.tsx",
  ])("sits in the footer, over Cancel and Save: %s", (file) => {
    expect(footers(file).some((footer) => footer.includes('role="alert"'))).toBe(true);
  });
});
