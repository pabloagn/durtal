// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";

// A busy button keeps its label and its width (contract section 8, SLN-699):
// a leading icon turns into a spinner of the same size, a button without one
// gains none, and the button is disabled and says it is busy.
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
    expect(busy.disabled).toBe(true);
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
    expect(busy.disabled).toBe(true);
  });

  it("is neither busy nor disabled at rest", () => {
    const rest = render({}, "Save");
    expect(rest.hasAttribute("aria-busy")).toBe(false);
    expect(rest.disabled).toBe(false);
  });

  it("stays disabled after the action when its own condition says so", () => {
    expect(render({ busy: false, disabled: true }, "Save").disabled).toBe(true);
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
});
