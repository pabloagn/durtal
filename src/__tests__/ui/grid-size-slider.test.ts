// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  GridSizeSlider,
  mobileGridPreference,
} from "@/components/books/grid-size-slider";
import {
  ViewModeSwitcher,
  type ViewMode,
} from "@/components/books/view-mode-switcher";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import { PreferencesProvider, usePreference } from "@/lib/hooks/use-preference";
import { readCookie } from "@/lib/utils/preference-cookies";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLElement, root: Root | undefined;
beforeEach(() => {
  document.cookie = "durtal-grid-columns=; Max-Age=0; Path=/";
  host = document.createElement("main");
  document.body.append(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
});
function Fixture() {
  const [value, setValue] = usePreference("durtal-grid-columns", 6);
  const [view, setView] = useState<ViewMode>("grid");
  return createElement(
    "section",
    null,
    createElement(
      "div",
      { className: "flex" },
      createElement(ViewModeSwitcher, {
        value: view,
        onChange: setView,
        availableModes: ["grid", "mosaic"],
      }),
      createElement(GridSizeSlider, { value, onChange: setValue }),
    ),
    view === "grid"
      ? createElement(
          "div",
          {
            "data-catalogue-grid": "",
            "data-grid-density": value,
            className: COL_CLASSES[value],
            style: { gridTemplateColumns: "160px 160px" },
          },
          createElement("article", null, "A complete long fixture title"),
          createElement("article", null, "Short"),
        )
      : createElement("div", {
          className: "mosaic",
          style: { "--mosaic-per-row": String(value + 2) } as never,
        }),
  );
}
function render() {
  root = createRoot(host);
  act(() => root!.render(createElement(Fixture)));
}
function slide(label: string, value: number) {
  const range = host.querySelector(
    `input[aria-label="${label}"]`,
  ) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(range, String(value));
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const desktopLabel = "Grid size: cards per row",
  mobileLabel = "Card size: Large or Compact";

describe("phone size projection and saved preference", () => {
  it("changes the saved preference only after input and preserves a higher compact preference", () => {
    document.cookie = "durtal-grid-columns=8; Path=/";
    render();
    expect(
      (
        host.querySelector(
          `input[aria-label="${mobileLabel}"]`,
        ) as HTMLInputElement
      ).value,
    ).toBe("1");
    slide(mobileLabel, 1);
    expect(readCookie("durtal-grid-columns")).toBe("8");
    slide(mobileLabel, 0);
    expect(readCookie("durtal-grid-columns")).toBe("2");
    slide(mobileLabel, 1);
    expect(readCookie("durtal-grid-columns")).toBe("3");
    expect(
      host
        .querySelector("[data-catalogue-grid]")!
        .getAttribute("data-grid-density"),
    ).toBe("3");
  });

  it("does not rewrite a desktop density when layout resizes", () => {
    document.cookie = "durtal-grid-columns=7; Path=/";
    render();
    act(() => window.dispatchEvent(new Event("resize")));
    expect(readCookie("durtal-grid-columns")).toBe("7");
    expect(
      (
        host.querySelector(
          `input[aria-label="${desktopLabel}"]`,
        ) as HTMLInputElement
      ).value,
    ).toBe("7");
  });

  it("keeps the full 2–8 range and unchanged mosaic preference", () => {
    render();
    act(() =>
      (
        host.querySelector('button[aria-label="Mosaic"]') as HTMLButtonElement
      ).click(),
    );
    slide(desktopLabel, 8);
    expect(readCookie("durtal-grid-columns")).toBe("8");
    expect(
      (host.querySelector(".mosaic") as HTMLElement).style.getPropertyValue(
        "--mosaic-per-row",
      ),
    ).toBe("10");
    expect(
      host
        .querySelector("[data-catalogue-view]")!
        .getAttribute("data-catalogue-view"),
    ).toBe("mosaic");
  });

  it("reports measured columns and narrow fallback without changing the preference", async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-catalogue-grid")
          ? ({ ...original.call(this), width: 300 } as DOMRect)
          : original.call(this);
      },
    );
    document.cookie = "durtal-grid-columns=8; Path=/";
    render();
    const grid = host.querySelector("[data-catalogue-grid]") as HTMLElement;
    grid.style.gridTemplateColumns = "300px";
    await act(async () => {
      grid.setAttribute("data-grid-density", "8");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("output")!.textContent).toBe(
      "1 per row · narrow space",
    );
    expect(readCookie("durtal-grid-columns")).toBe("8");
  });

  it("emits the same native controls on server render and first hydration", async () => {
    const props = { value: 8, onChange: () => {} };
    const node = createElement(PreferencesProvider, {
      initial: { "durtal-grid-columns": "8" },
      children: createElement(GridSizeSlider, props),
    });
    host.innerHTML = renderToString(node);
    const before = [...host.querySelectorAll("input")].map((input) => ({
      min: input.min,
      max: input.max,
      value: input.value,
    }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(host, node);
      await Promise.resolve();
    });
    expect(
      [...host.querySelectorAll("input")].map((input) => ({
        min: input.min,
        max: input.max,
        value: input.value,
      })),
    ).toEqual(before);
    expect(errors).not.toHaveBeenCalled();
    expect(before).toEqual([
      { min: "2", max: "8", value: "8" },
      { min: "0", max: "1", value: "1" },
    ]);
  });
});

describe("projection boundaries", () => {
  it("keeps existing compact values, maps Large to 2 and first Compact to 3", () => {
    for (const current of [3, 4, 5, 6, 7, 8])
      expect(mobileGridPreference(current, true)).toBe(current);
    expect(mobileGridPreference(2, true)).toBe(3);
    expect(mobileGridPreference(8, false)).toBe(2);
  });
});
