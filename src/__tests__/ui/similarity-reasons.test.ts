// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SimilarityReasons } from "@/components/books/similarity-reasons";
import type { SimilarityReason } from "@/lib/actions/similar-works";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
});
let host: HTMLElement;
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
const reasons: SimilarityReason[] = [
  { kind: "series", id: "s", name: "The series" },
  { kind: "subject", id: "u", name: "A subject" },
  { kind: "translator", id: "t", name: "A translator" },
];
function render(values = reasons) {
  act(() =>
    root.render(
      createElement(SimilarityReasons, {
        title: "A complete title",
        reasons: values,
      }),
    ),
  );
}

describe("similarity evidence", () => {
  it("shows the strongest two reasons without hover and names its full-evidence control", () => {
    render();
    expect(
      [...host.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["Series: The series", "Subject: A subject"]);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe(
      "All similarity reasons for A complete title",
    );
    expect(button.textContent).toBe("All reasons (3)");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("keeps long and unbroken names complete in the dialog, closes and returns keyboard focus", async () => {
    const name = "Long name ".repeat(500) + "x".repeat(500);
    render([{ kind: "collection", id: "c", name }, ...reasons]);
    const button = host.querySelector<HTMLButtonElement>("button")!;
    act(() => {
      button.focus();
      button.click();
    });
    const dialog = host.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    const close = dialog.querySelector<HTMLButtonElement>("button")!;
    const area = dialog.querySelector<HTMLElement>("[tabindex='0']")!;
    for (const [from, shiftKey, expected] of [
      [close, true, area],
      [area, false, close],
      [close, false, area],
      [area, true, close],
    ] as const) {
      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        from.focus();
        from.dispatchEvent(tab);
      });
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(expected);
    }
    expect(dialog.querySelectorAll("li")).toHaveLength(4);
    expect(dialog.querySelector("li")!.textContent).toBe(`Collection: ${name}`);
    act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("keeps the trigger as focus origin even when a touch click did not focus it", async () => {
    render();
    const button = host.querySelector<HTMLButtonElement>("button")!;
    act(() => button.click());
    const dialog = host.querySelector("dialog")!;
    act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(button);
  });

  it("renders a short single reason and omits absent evidence", () => {
    render([reasons[0]]);
    expect(host.querySelectorAll("li")).toHaveLength(1);
    expect(host.querySelector("button")!.textContent).toBe("All reasons");
    render([]);
    expect(host.textContent).toBe("");
    expect(host.querySelector("button")).toBeNull();
  });

  it("names every source kind for sighted readers", () => {
    const kinds: SimilarityReason["kind"][] = [
      "collection",
      "subject",
      "theme",
      "movement",
      "series",
      "recommender",
      "author",
      "translator",
      "publisher",
    ];
    const labels = [
      "Collection",
      "Subject",
      "Theme",
      "Movement",
      "Series",
      "Recommended by",
      "Author",
      "Translator",
      "Publisher",
    ];
    kinds.forEach((kind, i) => {
      render([{ kind, id: kind, name: "Evidence" }]);
      expect(host.querySelector("li")!.textContent).toBe(
        `${labels[i]}: Evidence`,
      );
    });
  });
});
