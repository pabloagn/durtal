// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";

// A dialog focuses its first field on open. One that loads its fields after
// it opens (Edit person) starts in the first field once they arrive.

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

const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
const render = (loaded: boolean) =>
  act(() =>
    root.render(
      createElement(Dialog, {
        open: true,
        onClose: () => {},
        title: "Edit person",
        children: loaded ? createElement("input", { id: "name", "aria-label": "Name" }) : createElement("p", null, "Loading"),
      }),
    ),
  );
const dialog = () => document.querySelector("dialog") as HTMLDialogElement;
// Log a past read: lists at the top, the Review editor mounts after open
const renderWithLists = (editor: boolean) =>
  act(() =>
    root.render(
      createElement(Dialog, {
        open: true,
        onClose: () => {},
        title: "Log a past read",
        children: [
          createElement("select", { key: "status", "aria-label": "Status" }),
          editor ? createElement("div", { key: "review", id: "review", contentEditable: true, suppressContentEditableWarning: true }) : null,
        ],
      }),
    ),
  );

describe("Dialog focus with fields that load late", () => {
  it("starts in the first field once it arrives", async () => {
    render(false);
    expect(document.activeElement).toBe(dialog());
    render(true);
    await wait();
    expect(document.activeElement?.id).toBe("name");
  });

  it("leaves the focus where the person moved it before the fields arrived", async () => {
    render(false);
    const close = dialog().querySelector<HTMLButtonElement>('button[aria-label^="Close"]');
    expect(close).not.toBeNull();
    act(() => close!.focus());
    render(true);
    await wait();
    expect(document.activeElement).toBe(close);
  });

  it("stays at the top when the late field comes after other controls", async () => {
    renderWithLists(false);
    expect(document.activeElement).toBe(dialog());
    renderWithLists(true);
    await wait();
    expect(document.activeElement).toBe(dialog());
  });

  it("starts in a late field that comes after only text", async () => {
    render(false);
    act(() =>
      root.render(
        createElement(Dialog, {
          open: true,
          onClose: () => {},
          title: "Note",
          children: [
            createElement("p", { key: "hint" }, "A note on this read"),
            createElement("div", { key: "body", id: "body", contentEditable: true, suppressContentEditableWarning: true }),
          ],
        }),
      ),
    );
    await wait();
    expect(document.activeElement?.id).toBe("body");
  });
});
