// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute("open", ""); };
});
let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const field = createElement("input", { "aria-label": "Name" });
function render(description?: string) {
  act(() => root.render(createElement(Dialog, { open: true, title: "Create collection", description, onClose: () => {}, children: field })));
  return host.querySelector("dialog")!;
}

describe("dialog names and optional guidance", () => {
  it.each([undefined, "", "Choose an edition.", "A long record name ".repeat(30)])("keeps a valid name with %s", (description) => {
    const dialog = render(description);
    const titleId = dialog.getAttribute("aria-labelledby")!;
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId)?.textContent).toBe("Create collection");
    expect(document.activeElement).toBe(host.querySelector("input"));
    const descriptionId = dialog.getAttribute("aria-describedby");
    if (description) {
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)?.textContent).toBe(description);
    } else {
      expect(descriptionId).toBeNull();
      expect(host.querySelector("h2")?.parentElement?.querySelector("p")).toBeNull();
    }
  });

  it("removes the description reference and node when guidance disappears", () => {
    const dialog = render("Choose an edition.");
    const titleId = dialog.getAttribute("aria-labelledby");
    render();
    expect(dialog.getAttribute("aria-labelledby")).toBe(titleId);
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
    expect(dialog.querySelector("p")).toBeNull();
  });

  it("gives simultaneously mounted dialogs distinct names", () => {
    act(() => root.render(createElement("div", null, ...["Create collection", "Edit collection"].map((title) =>
      createElement(Dialog, { key: title, open: true, title, description: title, onClose: () => {}, children: field }),
    ))));
    const dialogs = [...host.querySelectorAll("dialog")];
    expect(dialogs).toHaveLength(2);
    const ids = dialogs.flatMap((dialog) => [dialog.getAttribute("aria-labelledby"), dialog.getAttribute("aria-describedby")]);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(document.getElementById(id!)).not.toBeNull();
  });
});
