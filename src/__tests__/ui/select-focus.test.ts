// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Select } from "@/components/ui/select";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it.each([false, true])("returns focus to the trigger after choosing an option (compact: %s)", compact => {
  const onChange = vi.fn();
  act(() => root.render(createElement(Select, {
    ariaLabel: "Format", compact, value: "print", onChange,
    options: [{ value: "print", label: "Print" }, { value: "ebook", label: "eBook" }],
  })));
  const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  act(() => trigger.click());
  // Pointer selection need not focus the trigger (notably in WebKit).
  const elsewhere = document.createElement("button");
  host.append(elsewhere);
  elsewhere.focus();
  expect(document.activeElement).toBe(elsewhere);
  const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.startsWith("eBook"))!;
  act(() => option.click());
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].target.value).toBe("ebook");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("does not choose a disabled option or close its list", () => {
  const onChange = vi.fn();
  act(() => root.render(createElement(Select, {
    ariaLabel: "Format", value: "print", onChange,
    options: [{ value: "print", label: "Print" }, { value: "ebook", label: "eBook", disabled: true }],
  })));
  const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  act(() => trigger.click());
  act(() => host.querySelector<HTMLElement>('[aria-disabled="true"]')!.click());
  expect(onChange).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});
