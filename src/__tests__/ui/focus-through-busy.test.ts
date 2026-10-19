// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "fs";
import path from "path";
import { useFocusThroughBusy } from "@/hooks/use-focus-through-busy";

// Review of #337: after a pasted cover URL was added, the focus was on the
// page body until Tab, because the field and its Add are disabled while the
// add runs. Edition cover, Collections and Manage media share the pattern.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Row({ busy, empty = false }: { busy: boolean; empty?: boolean }) {
  const field = useRef<HTMLInputElement>(null);
  useFocusThroughBusy(busy, field);
  return createElement(
    "dialog",
    { open: true },
    createElement("input", { id: "field", ref: field, disabled: busy }),
    createElement("button", { id: "add", disabled: busy || empty }, "Add"),
    createElement("button", { id: "other" }, "Other"),
  );
}

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

const byId = (id: string) => document.getElementById(id) as HTMLElement;
// A browser drops the focus onto the page once a focused control is disabled
function dropFocus() {
  const away = document.createElement("button");
  document.body.append(away);
  away.focus();
  away.remove();
}

describe("useFocusThroughBusy", () => {
  it("puts the focus back in the field after a busy add from the field", () => {
    act(() => root.render(createElement(Row, { busy: false })));
    byId("field").focus();
    act(() => root.render(createElement(Row, { busy: true })));
    dropFocus();
    expect(document.activeElement).toBe(document.body);
    act(() => root.render(createElement(Row, { busy: false })));
    expect(document.activeElement).toBe(byId("field"));
  });

  it("goes back to the control that had the focus", () => {
    act(() => root.render(createElement(Row, { busy: false })));
    byId("add").focus();
    act(() => root.render(createElement(Row, { busy: true })));
    dropFocus();
    act(() => root.render(createElement(Row, { busy: false })));
    expect(document.activeElement).toBe(byId("add"));
  });

  it("goes to the field when that control stays disabled (an emptied field's Add)", () => {
    act(() => root.render(createElement(Row, { busy: false })));
    byId("add").focus();
    act(() => root.render(createElement(Row, { busy: true })));
    dropFocus();
    act(() => root.render(createElement(Row, { busy: false, empty: true })));
    expect(document.activeElement).toBe(byId("field"));
  });

  it("goes to the field when WebKit leaves the focus on the disabled Add past the busy end (SLN-1058)", () => {
    act(() => root.render(createElement(Row, { busy: false })));
    byId("add").focus();
    act(() => root.render(createElement(Row, { busy: true })));
    // No drop yet: the focus stays on the disabled Add until after busy ends
    act(() => root.render(createElement(Row, { busy: false, empty: true })));
    expect(document.activeElement).toBe(byId("field"));
  });

  it("goes to the field, not the dialog, when the dialog had the focus (Safari's click on Add)", () => {
    act(() => root.render(createElement(Row, { busy: false })));
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    dialog.tabIndex = -1;
    dialog.focus();
    act(() => root.render(createElement(Row, { busy: true })));
    act(() => root.render(createElement(Row, { busy: false })));
    expect(document.activeElement).toBe(byId("field"));
  });

  it("leaves the focus where the reader put it while the add ran", () => {
    act(() => root.render(createElement(Row, { busy: false })));
    byId("field").focus();
    act(() => root.render(createElement(Row, { busy: true })));
    byId("other").focus();
    act(() => root.render(createElement(Row, { busy: false })));
    expect(document.activeElement).toBe(byId("other"));
  });
});

it("keeps the focus through a busy add in Edition cover, Collections and Manage media", () => {
  for (const file of [
    "app/(catalogue)/library/[slug]/edition-cover-dialog.tsx",
    "components/books/add-to-collection-dialog.tsx",
    "components/media/media-manager-dialog.tsx",
  ]) {
    const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    const call = source.match(/useFocusThroughBusy\((\w+), (\w+)\)/);
    expect(call, file).not.toBeNull();
    expect(source, file).toContain(`ref={${call![2]}}`);
    expect(source, file).toContain(`disabled={${call![1]}}`);
  }
});
