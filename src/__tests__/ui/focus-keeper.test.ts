// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FocusKeeper } from "@/components/shared/focus-keeper";

// Focus survey, cause 4: removing a row (a location, a copy, a collection's
// book, a dictionary source) left the focus on the page body. It now goes to
// the same control of the next row, else the row before, else the list's Add.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

function Page({ names, dialog = false, read = [] }: { names: string[]; dialog?: boolean; read?: string[] }) {
  return h(
    "main",
    null,
    h(FocusKeeper),
    h("h1", null, "Locations"),
    h("button", { "data-focus-empty": "places" }, "Add location"),
    names.length > 0 &&
      h(
        "ul",
        { "data-focus-list": "places" },
        names.map((name) =>
          h(
            "li",
            { key: name, "data-focus-row": "" },
            h("button", null, `Edit ${name}`),
            read.includes(name) && h("button", null, `Read ${name}`),
            h("button", null, `Delete ${name}`),
          ),
        ),
      ),
    dialog && h("dialog", { open: true }, h("button", null, "Delete")),
  );
}
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;

describe("FocusKeeper", () => {
  it("moves the focus to the next row's same control when a row goes", async () => {
    act(() => root.render(h(Page, { names: ["Attic", "Study", "Cellar"] })));
    button("Delete Study").focus();
    act(() => root.render(h(Page, { names: ["Attic", "Cellar"] })));
    await frame();
    expect(document.activeElement).toBe(button("Delete Cellar"));
  });

  it("finds the same control when the next row holds fewer controls", async () => {
    act(() => root.render(h(Page, { names: ["Attic", "Study"], read: ["Attic"] })));
    button("Delete Attic").focus();
    act(() => root.render(h(Page, { names: ["Study"], read: ["Attic"] })));
    await frame();
    expect(document.activeElement).toBe(button("Delete Study"));
  });

  it("goes to the row before when the last row goes, then to Add when none is left", async () => {
    act(() => root.render(h(Page, { names: ["Attic", "Study"] })));
    button("Edit Study").focus();
    act(() => root.render(h(Page, { names: ["Attic"] })));
    await frame();
    expect(document.activeElement).toBe(button("Edit Attic"));
    act(() => root.render(h(Page, { names: [] })));
    await frame();
    expect(document.activeElement).toBe(button("Add location"));
  });

  it("keeps the row's place through the confirmation dialog it opened", async () => {
    act(() => root.render(h(Page, { names: ["Attic", "Study"] })));
    button("Delete Attic").focus();
    act(() => root.render(h(Page, { names: ["Attic", "Study"], dialog: true })));
    button("Delete").focus();
    // The row goes while the dialog is up; nothing moves until it closes
    act(() => root.render(h(Page, { names: ["Study"], dialog: true })));
    await frame();
    expect(document.activeElement).toBe(button("Delete"));
    act(() => root.render(h(Page, { names: ["Study"] })));
    await frame();
    expect(document.activeElement).toBe(button("Delete Study"));
  });

  it("stays in its own list when the page holds two of one name (SLN-1028)", async () => {
    // Two grids of books on one page, as on a person's page
    const Grids = ({ second }: { second: string[] }) =>
      h(
        "main",
        null,
        h(FocusKeeper),
        ...[["Written", ["Attic"]], ["Translated", second]].map(([title, names]) =>
          h(
            "div",
            { key: title as string, "data-focus-list": "books" },
            (names as string[]).map((name) => h("div", { key: name, "data-focus-row": "" }, h("button", null, `Actions ${name}`))),
          ),
        ),
      );
    act(() => root.render(h(Grids, { second: ["Study", "Cellar"] })));
    button("Actions Study").focus();
    act(() => root.render(h(Grids, { second: ["Cellar"] })));
    await frame();
    expect(document.activeElement).toBe(button("Actions Cellar"));
  });

  it("counts a row's own card as part of the row, not a row of its own (SLN-1029)", async () => {
    // A linked work: its book card marks itself a row, inside the link's row
    const Links = ({ names }: { names: string[] }) =>
      h(
        "main",
        null,
        h(FocusKeeper),
        h(
          "ul",
          { "data-focus-list": "relations" },
          names.map((name) =>
            h(
              "li",
              { key: name, "data-focus-row": "" },
              h("div", { "data-focus-row": "" }, h("a", { href: `#${name}` }, name)),
              h("button", null, `Remove link to ${name}`),
            ),
          ),
        ),
      );
    act(() => root.render(h(Links, { names: ["Attic", "Study", "Cellar"] })));
    button("Remove link to Study").focus();
    act(() => root.render(h(Links, { names: ["Attic", "Cellar"] })));
    await frame();
    expect(document.activeElement).toBe(button("Remove link to Cellar"));
    // The last one goes to the one before: counted by the cards it would
    // land on the card's own link
    act(() => root.render(h(Links, { names: ["Attic"] })));
    await frame();
    expect(document.activeElement).toBe(button("Remove link to Attic"));
  });

  it("leaves the focus alone when it is somewhere else", async () => {
    act(() => root.render(h(Page, { names: ["Attic", "Study"] })));
    button("Delete Attic").focus();
    button("Add location").focus();
    act(() => root.render(h(Page, { names: ["Study"] })));
    await frame();
    expect(document.activeElement).toBe(button("Add location"));
  });
});
