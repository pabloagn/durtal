// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipLayer } from "@/components/ui/tooltip";
import { Select } from "@/components/ui/select";

// Escape must reach a dialog when nothing else has a reason to take it.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom knows neither :focus-visible nor the popover API: every focus
  // here comes from the keyboard, and the popover is a flag.
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ":focus-visible") return this === document.activeElement;
    if (selector === ":popover-open") return this.hasAttribute("data-open");
    return matches.call(this, selector);
  };
  HTMLElement.prototype.showPopover = function () {
    this.setAttribute("data-open", "");
  };
  HTMLElement.prototype.hidePopover = function () {
    this.removeAttribute("data-open");
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

const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const escape = (target: Element) => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};
const tooltipText = () => document.getElementById("app-tooltip")?.textContent ?? "";
/** Tab went down: the focus that follows is the reader's own */
const tab = () => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));

describe("keyboard tooltip", () => {
  function renderWithButton(inDialog = false) {
    const controls = [
      createElement("button", { key: "b", type: "button", "data-tooltip": "Expand", id: "first" }, "x"),
      createElement("input", { key: "i", id: "field" }),
    ];
    act(() =>
      root.render(
        createElement("div", null,
          createElement(TooltipLayer),
          inDialog ? createElement("dialog", { open: true }, controls) : controls,
        ),
      ),
    );
    return {
      button: document.getElementById("first") as HTMLButtonElement,
      field: document.getElementById("field") as HTMLInputElement,
    };
  }

  it("does not show when focus moves on before it appears, so Escape reaches the dialog", async () => {
    const { button, field } = renderWithButton();
    // What showModal and the dialog's first-field focus do, in one task
    act(() => {
      button.focus();
      field.focus();
    });
    await wait();
    expect(tooltipText()).toBe("");
    expect(escape(field).defaultPrevented).toBe(false);
  });

  it("still shows on keyboard focus, and Escape closes it first", async () => {
    const { button } = renderWithButton();
    tab();
    act(() => button.focus());
    await wait();
    expect(tooltipText()).toContain("Expand");
    expect(escape(button).defaultPrevented).toBe(true);
    expect(tooltipText()).toBe("");
  });

  it("does not show for focus the app moves itself, after the key that opened a dialog", async () => {
    const { button } = renderWithButton(true);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" })));
    act(() => button.focus());
    await wait();
    expect(tooltipText()).toBe("");
    expect(escape(button).defaultPrevented).toBe(false);
  });

  it("in a dialog, one Escape closes the tooltip and reaches the dialog", async () => {
    const { button } = renderWithButton(true);
    tab();
    act(() => button.focus());
    await wait();
    expect(tooltipText()).toContain("Expand");
    expect(escape(button).defaultPrevented).toBe(false);
    expect(tooltipText()).toBe("");
  });
});

describe("Select and Escape", () => {
  function renderSelect() {
    act(() =>
      root.render(
        createElement(Select, {
          ariaLabel: "Language",
          value: "es",
          options: [
            { value: "es", label: "Spanish" },
            { value: "en", label: "English" },
          ],
        }),
      ),
    );
    return host.querySelector<HTMLElement>('[role="combobox"]')!;
  }

  it("lets Escape through while its list is closed", () => {
    const trigger = renderSelect();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(escape(trigger).defaultPrevented).toBe(false);
  });

  it("closes an open list first and keeps Escape", () => {
    const trigger = renderSelect();
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(escape(trigger).defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
