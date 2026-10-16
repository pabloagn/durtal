// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";

// A busy button keeps its label and its width (contract section 8, SLN-699):
// a leading icon turns into a spinner of the same size, a button without one
// gains none, and the button says it is busy and ignores presses. It is
// aria-disabled, not disabled, so it keeps the focus (focus survey, cause 2).
function render(props: Record<string, unknown>, ...children: unknown[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Button, props, ...(children as never[])));
  return host.querySelector("button")!;
}

describe("Button busy", () => {
  it("keeps the label and swaps the icon for a spinner of its size", () => {
    const icon = createElement(Save, { className: "h-3.5 w-3.5", strokeWidth: 1.5 });
    const rest = render({}, icon, "Save changes");
    const busy = render({ busy: true }, icon, "Save changes");
    expect(busy.textContent).toBe(rest.textContent);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.disabled).toBe(false);
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    const svgs = busy.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute("class")).toContain("animate-spin");
    expect(svgs[0].getAttribute("class")).toContain("h-3.5 w-3.5");
    expect(svgs[0].getAttribute("aria-hidden")).toBe("true");
    // The button's own classes do not change: no padding or size swap
    expect(busy.className).toBe(rest.className);
  });

  it("adds no spinner to a button without an icon", () => {
    const busy = render({ busy: true, variant: "primary" }, "Save");
    expect(busy.textContent).toBe("Save");
    expect(busy.querySelector("svg")).toBeNull();
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
  });

  it("is neither busy nor disabled at rest", () => {
    const rest = render({}, "Save");
    expect(rest.hasAttribute("aria-busy")).toBe(false);
    expect(rest.disabled).toBe(false);
    expect(rest.hasAttribute("aria-disabled")).toBe(false);
  });

  it("stays disabled after the action when its own condition says so", () => {
    expect(render({ busy: false, disabled: true }, "Save").disabled).toBe(true);
  });
});

describe("a busy button that has the focus (focus survey, cause 2)", () => {
  it("keeps the focus, and a press neither runs its action again nor submits", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    const form = (busy: boolean) =>
      createElement("form", { onSubmit }, createElement(Button, { type: "submit", busy, onClick }, "Save"));
    act(() => root.render(form(false)));
    const button = host.querySelector("button")!;
    button.focus();
    act(() => root.render(form(true)));
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => root.render(form(false)));
    act(() => button.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
    act(() => root.unmount());
    host.remove();
  });
});

describe("a Button in a server component", () => {
  it("adds no click handler of its own: a server component cannot pass one", () => {
    const render = (Button as unknown as { render: (props: object, ref: null) => { props: { onClick?: unknown } } }).render;
    expect(render({ children: "Delete" }, null).props.onClick).toBeUndefined();
    expect(typeof render({ busy: true, children: "Delete" }, null).props.onClick).toBe("function");
  });
});

describe("busy labels", () => {
  it("are written with the ellipsis character, never three dots", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../..");
    const files = readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("__tests__"));
    const dots = files.flatMap((f) =>
      [...readFileSync(path.join(root, "src", f), "utf8").matchAll(/\b(Saving|Loading|Creating|Deleting|Merging|Searching|Importing|Updating|Adding|Linking)\b[^"\n<]*\.\.\./g)]
        .map((m) => `${f}: ${m[0]}`),
    );
    expect(dots).toEqual([]);
  });

  // SLN-713: a busy button keeps its words and width (contract section 8).
  // A busy word in place of the label, a spinner in place of it, or a
  // spinner added beside it all move the buttons around it. The reader keeps
  // its own controls.
  it("never replace a button's label or add a spinner beside it", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../..");
    const files = readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx") && !f.startsWith("__tests__") && !f.includes("components/reader/"));
    // Each rule ends at the button's closing tag, so status lines and
    // spinners in search fields are not counted
    const rules = [
      /\? "(Saving|Creating|Confirming|Undoing|Unlinking|Applying|Merging|Working|Deleting|Preparing|Checking|Reading the)\b[^"]*"[^<]*<\/[Bb]utton>/g,
      /\{\s*\w+ \? \(\s*<(Loader2|LoaderCircle|Spinner)\b[^>]*\/>\s*\) : \(\s*"[^<]*<\/[Bb]utton>/g,
      /\{\s*\w+ && \(?\s*<(Loader2|LoaderCircle)\b[^>]*\/>\s*\)?\}(?:[^<{]|\{[^}]*\})*<\/[Bb]utton>/g,
    ];
    const found = files.flatMap((f) => {
      const source = readFileSync(path.join(root, "src", f), "utf8");
      return rules.flatMap((rule) => [...source.matchAll(rule)].map((m) => `${f}: ${m[0].replace(/\s+/g, " ")}`));
    });
    expect(found).toEqual([]);
  });
});
