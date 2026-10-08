// @vitest-environment happy-dom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog } from "@/components/ui/dialog";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLDivElement;
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
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const key = (target: Element, name: string) =>
  act(() =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
const trigger = () =>
  host.querySelector('button[aria-haspopup="menu"]')! as HTMLButtonElement;
const items = () =>
  [...host.querySelectorAll('[role="menuitem"]')] as HTMLElement[];

function Menu({ run }: { run: () => void }) {
  return h(DropdownMenu, {
    label: "Actions",
    trigger: h("button", null, "Actions") as Parameters<
      typeof DropdownMenu
    >[0]["trigger"],
    children: [
      h(DropdownMenuItem, {
        key: "disabled",
        disabled: true,
        children: "Unavailable",
      }),
      h(DropdownMenuItem, {
        key: "edit",
        icon: h("svg"),
        shortcut: "E W",
        onClick: run,
        children: "Edit Taxonomy",
      }),
      h(DropdownMenuItem, {
        key: "long",
        children: "A long command without an icon or shortcut",
      }),
    ],
  });
}

describe("shared dropdown keyboard and focus", () => {
  it("skips disabled actions, wraps arrow navigation, and returns focus on Escape", async () => {
    const run = vi.fn();
    act(() => root.render(h(Menu, { run })));
    act(() => trigger().click());
    await settle();
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1], "End");
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2], "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1], "ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2], "Escape");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(run).not.toHaveBeenCalled();
  });
  it("activates a command once with the keyboard while keeping shortcut text separate", async () => {
    const run = vi.fn();
    act(() => root.render(h(Menu, { run })));
    act(() => trigger().click());
    await settle();
    expect(items()[1].querySelector(".dropdown-label")?.textContent).toBe(
      "Edit Taxonomy",
    );
    expect(items()[1].querySelector(".dropdown-shortcut")?.textContent).toBe(
      "E W",
    );
    key(items()[1], "Enter");
    expect(run).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it("retains the floated menu's trigger ancestry for dialog focus restoration", async () => {
    function Probe() {
      const [open, setOpen] = useState(false);
      return h(
        "div",
        null,
        h(Menu, { run: () => setOpen(true) }),
        h(Dialog, {
          open,
          onClose: () => setOpen(false),
          title: "Edit",
          children: h("input", { "aria-label": "Title" }),
        }),
      );
    }
    act(() => root.render(h(Probe)));
    act(() => trigger().click());
    await settle();
    expect(
      host
        .querySelector('[role="menu"]')
        ?.parentElement?.querySelector("button"),
    ).toBe(trigger());
    key(items()[1], "Enter");
    await settle();
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    act(() =>
      (
        host.querySelector(
          'dialog button[aria-label="Close Edit"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await settle();
    expect(document.activeElement).toBe(trigger());
  });
});
