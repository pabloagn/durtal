// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Play } from "lucide-react";

// SLN-477: S opens the search (the command palette) from any page, and Esc
// closes every search surface, one layer per press.

const nav = vi.hoisted(() => ({ pathname: "/library", push: vi.fn() }));
const places = vi.hoisted(() => ({
  searchPlaces: vi.fn(async () => [{ id: "p1", name: "Paris", fullName: "Paris, France" }]),
  createPlace: vi.fn(),
  createPlaceFromGeocode: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn(), prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("@/lib/actions/places", () => places);
// The Add dialogs and the sheet are not under test
vi.mock("@/app/people/author-create-dialog", () => ({ AuthorCreateDialog: () => null }));
vi.mock("@/app/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({ CreateCollectionDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));

import { ShortcutsProvider, useReadingActions } from "@/components/shortcuts/shortcuts-provider";
import { PlacePicker } from "@/components/shared/place-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FilterDropdown } from "@/components/shared/filter-dropdown";
import { Select } from "@/components/ui/select";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  nav.pathname = "/library";
  nav.push.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("dialog").forEach((d) => d.remove());
});

/** A keydown as the browser sends it; returns the event, to read defaultPrevented */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const startReading = vi.fn();
function ReadingPage() {
  useReadingActions([{ key: "s", label: "Start reading", icon: Play, run: startReading }]);
  return null;
}

/** The provider around a page with a search field, a plain field and a book's reading actions */
function App({ onPalette }: { onPalette: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return createElement(ShortcutsProvider, {
    paletteOpen: open,
    onPaletteOpenChange: (next: boolean) => {
      onPalette(next);
      setOpen(next);
    },
    children: createElement(
      Fragment,
      null,
      createElement("input", { "data-shortcut-search": "", "aria-label": "Search works", defaultValue: "" }),
      createElement("input", { "aria-label": "Notes", defaultValue: "" }),
      createElement(ReadingPage),
      open && createElement("div", { "data-testid": "palette" }),
    ),
  });
}

function renderApp() {
  const onPalette = vi.fn();
  act(() => root.render(createElement(App, { onPalette })));
  return onPalette;
}
const field = (label: string) => document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

describe("S opens the search", () => {
  it("opens the palette from the page, and the key is not typed", () => {
    const onPalette = renderApp();
    const event = press("s");
    expect(onPalette).toHaveBeenCalledWith(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-testid="palette"]')).not.toBeNull();
  });

  it("does nothing while typing", () => {
    const onPalette = renderApp();
    field("Notes").focus();
    press("s");
    field("Search works").focus();
    press("s");
    expect(onPalette).not.toHaveBeenCalled();
  });

  it("does nothing with a modifier or Shift held", () => {
    const onPalette = renderApp();
    for (const init of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }])
      press(init.shiftKey ? "S" : "s", init);
    expect(onPalette).not.toHaveBeenCalled();
  });

  it("does nothing while a dialog is open", () => {
    const onPalette = renderApp();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    press("s");
    expect(onPalette).not.toHaveBeenCalled();
  });

  it("leaves S to the e-book reader, which opens its settings with it", () => {
    nav.pathname = "/reader/42";
    const onPalette = renderApp();
    const event = press("s");
    expect(onPalette).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps G S (Series) and R S (start reading): an open menu takes the key", () => {
    const onPalette = renderApp();
    press("g");
    press("s");
    expect(nav.push).toHaveBeenCalledWith("/series");
    press("r");
    press("s");
    expect(startReading).toHaveBeenCalledTimes(1);
    expect(onPalette).not.toHaveBeenCalled();
  });
});

describe("Esc", () => {
  it("closes the palette", () => {
    const onPalette = renderApp();
    press("s");
    const event = press("Escape");
    expect(onPalette).toHaveBeenLastCalledWith(false);
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-testid="palette"]')).toBeNull();
  });

  it("leaves a search field on the page and keeps its text", () => {
    renderApp();
    const input = field("Search works");
    input.value = "vathek";
    input.focus();
    const event = press("Escape");
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe("vathek");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a search field in a dialog to the dialog: its default action closes it", () => {
    renderApp();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const input = document.createElement("input");
    input.placeholder = "Search books";
    dialog.append(input);
    document.body.append(dialog);
    input.focus();
    const event = press("Escape");
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("Esc closes one layer per press", () => {
  // A popover or list takes the first Esc and prevents its default action,
  // which keeps the dialog around it open; the next Esc reaches the dialog

  it("closes a list under a search field (the place picker), then lets the dialog close", async () => {
    act(() => root.render(createElement(PlacePicker, { label: "City", value: null, onChange: () => {} })));
    const input = document.querySelector('input[placeholder="Search a city"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "par");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(document.body.textContent).toContain("Paris, France");
    input.focus();
    const first = press("Escape", {}, input);
    expect(first.defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("Paris, France");
    expect(press("Escape", {}, input).defaultPrevented).toBe(false);
  });

  it("closes a popover (the date picker), then lets the dialog close", () => {
    act(() => root.render(createElement(DatePicker, { label: "Date", value: "", onChange: () => {}, id: "d" })));
    const trigger = document.getElementById("d") as HTMLButtonElement;
    act(() => trigger.click());
    expect(host.querySelector(".glass")).not.toBeNull();
    expect(press("Escape", {}, trigger).defaultPrevented).toBe(true);
    expect(host.querySelector(".glass")).toBeNull();
    expect(press("Escape", {}, trigger).defaultPrevented).toBe(false);
  });

  it("closes a menu (the dropdown menu) and gives focus back to its trigger", () => {
    act(() =>
      root.render(
        createElement(DropdownMenu, {
          trigger: createElement("button", { type: "button" }, "More") as ComponentProps<typeof DropdownMenu>["trigger"],
          label: "More",
          children: createElement(DropdownMenuItem, { onClick: () => {}, children: "Edit" }),
        }),
      ),
    );
    const trigger = host.querySelector('button[aria-label="More"]') as HTMLButtonElement;
    act(() => trigger.click());
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the filter panel and gives focus back to the Filter button", () => {
    act(() =>
      root.render(
        createElement(FilterDropdown, { groups: [], activeFilters: {}, onFilterChange: () => {}, onClearAll: () => {} }),
      ),
    );
    const trigger = host.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(press("Escape", {}, document.body).defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes a select's list, then lets the dialog close", () => {
    act(() =>
      root.render(
        createElement(Select, {
          id: "s",
          label: "Status",
          value: "a",
          onChange: () => {},
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ],
        }),
      ),
    );
    const trigger = document.getElementById("s") as HTMLButtonElement;
    trigger.focus();
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(press("Escape", {}, trigger).defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(press("Escape", {}, trigger).defaultPrevented).toBe(false);
  });

  it("closes a select's list when its trigger has no focus (Safari does not focus a clicked button)", () => {
    act(() =>
      root.render(
        createElement(Select, {
          id: "t",
          label: "Status",
          value: "a",
          onChange: () => {},
          options: [{ value: "a", label: "Alpha" }],
        }),
      ),
    );
    const trigger = document.getElementById("t") as HTMLButtonElement;
    act(() => trigger.click());
    trigger.blur();
    expect(press("Escape", {}, document.body).defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
