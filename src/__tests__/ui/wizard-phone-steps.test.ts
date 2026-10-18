// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StepProgress } from "@/app/(catalogue)/library/new/step-progress";

// Add book on a phone: six step bars at most, so each done step's bar can be
// a 44px target across a 320px screen; the existing-book check shows as
// part of the step it was run from.

let root: Root; let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const phone = () => host.querySelector(".sm\\:hidden") as HTMLElement;
const bars = () => [...phone().querySelectorAll("button")];
const render = (props: Parameters<typeof StepProgress>[0]) => act(() => root.render(createElement(StepProgress, props)));

describe("the wizard's phone step bars", () => {
  it("keeps six bars on the existing-book check after Details", () => {
    render({ step: "duplicate", duplicateAfter: "details", disabled: false, onStep: () => {} });
    expect(bars()).toHaveLength(6);
    expect(phone().querySelector("p")?.textContent).toBe("Step 2 of 6 — Existing book");
    expect(bars().map((b) => b.disabled)).toEqual([false, true, true, true, true, true]);
  });

  it("keeps six bars on the existing-book check after Search", () => {
    render({ step: "duplicate", duplicateAfter: "search", disabled: false, onStep: () => {} });
    expect(bars()).toHaveLength(6);
    expect(phone().querySelector("p")?.textContent).toBe("Step 1 of 6 — Existing book");
  });

  it("counts the steps as before elsewhere", () => {
    render({ step: "edition", duplicateAfter: null, disabled: false, onStep: () => {} });
    expect(phone().querySelector("p")?.textContent).toBe("Step 3 of 6 — Edition");
    expect(bars().filter((b) => !b.disabled)).toHaveLength(2);
  });

  it("puts the gap between bars inside each target", () => {
    render({ step: "confirm", disabled: false, onStep: () => {} });
    expect(phone().querySelector("div")?.className).not.toMatch(/\bgap-/);
    expect(bars().every((b) => b.className.includes("px-[3px]"))).toBe(true);
  });
});
