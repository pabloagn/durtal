// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast as sonner } from "sonner";
import { AppToaster } from "@/components/layout/app-toaster";
import { TOAST_DURATION, toast } from "@/lib/notifications/toast";

// The toast lifecycle (SLN-732): a long operation's pending toast turns into
// its outcome in place, toasts that arrive together are each said once, a
// repeat stays one toast, and a toast dismissed from the keyboard hands the
// focus on.

let root: Root;
let host: HTMLElement;
let navigate: (page: string) => void;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const toasts = () => [...document.querySelectorAll<HTMLElement>("[data-sonner-toast]:not([data-removed='true'])")];
const titles = () => toasts().map((t) => t.querySelector("[data-title]")?.textContent);
const said = (region: "polite" | "assertive") =>
  [...document.querySelectorAll(`[data-toast-announcer="${region}"] p`)].map((p) => p.textContent);
const duration = (id: string | number) =>
  (sonner.getHistory().find((t) => t.id === id && "type" in t) as { duration?: number } | undefined)?.duration;

/** A layout that keeps its toaster while its page changes */
function Layout() {
  const [page, setPage] = useState("Library");
  navigate = setPage;
  const children: ReactNode = createElement("main", null, createElement("button", { id: "trigger" }, page));
  return createElement("div", null, children, createElement(AppToaster));
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Layout)));
});
afterEach(async () => {
  act(() => void sonner.dismiss());
  await wait(450);
  act(() => root.unmount());
  host.remove();
});

describe("the toast lifecycle", () => {
  it("turns a pending toast into its success in the same place", async () => {
    const progress = toast.pending("Exporting books");
    await wait(50);
    expect(titles()).toEqual(["Exporting books"]);
    expect(toasts()[0].dataset.type).toBe("loading");
    act(() => void progress.success("Exported 12 books as CSV"));
    await wait(50);
    expect(titles()).toEqual(["Exported 12 books as CSV"]);
    expect(toasts()[0].dataset.type).toBe("success");
    expect(said("polite")).toEqual(["Exporting books", "Exported 12 books as CSV"]);
    expect(said("assertive")).toEqual([]);
  });

  it("turns a pending toast into its failure, which stays until it is dismissed", async () => {
    const progress = toast.pending("Updating 3 works");
    await wait(50);
    act(() => void progress.error("Updated 1 of 3 works before error"));
    await wait(50);
    expect(titles()).toEqual(["Updated 1 of 3 works before error"]);
    expect(toasts()[0].dataset.type).toBe("error");
    expect(duration(progress.id)).toBe(Infinity);
    expect(said("assertive")).toEqual(["Updated 1 of 3 works before error"]);
  });

  it("gives each kind its own time, and leaves an action's toast as it asks", async () => {
    let ids: (string | number)[] = [];
    act(() => {
      ids = [
        toast.success("Saved"),
        toast.info("No new matches"),
        toast.warning("Collection deleted; some artwork still needs cleanup."),
        toast.error("Could not save"),
        toast.success("Now tracking this book", { duration: 10_000, action: { label: "Undo", onClick: () => {} } }),
        toast.error("Could not move it", { action: { label: "Retry", onClick: () => {} } }),
      ];
    });
    expect(ids.map(duration)).toEqual([
      TOAST_DURATION.success, TOAST_DURATION.info, TOAST_DURATION.warning, Infinity, 10_000, undefined,
    ]);
  });

  it("says three toasts that arrive together once each, in order, and the error at once", async () => {
    act(() => {
      toast.success("Added to Favourites");
      toast.error("Could not reach the server");
      toast.info("2 more rows matched a book");
    });
    await wait(50);
    expect(titles().sort()).toEqual(["2 more rows matched a book", "Added to Favourites", "Could not reach the server"]);
    expect(said("polite")).toEqual(["Added to Favourites", "2 more rows matched a book"]);
    expect(said("assertive")).toEqual(["Could not reach the server"]);
    // Sonner's own list no longer speaks
    expect(document.querySelector("section[aria-live]")?.getAttribute("aria-live")).toBe("off");
    // The regions travel with the toasts, into an open modal dialog, where
    // they are not inert
    for (const region of document.querySelectorAll("[data-toast-announcer]"))
      expect(region.closest("[data-toast-holder]")).not.toBeNull();
  });

  it("keeps a repeat to one toast that is said once", async () => {
    let first: string | number = 0, again: string | number = 0;
    act(() => {
      first = toast.error("Could not reach the server");
      again = toast.error("Could not reach the server");
    });
    await wait(50);
    act(() => void toast.error("Could not reach the server"));
    await wait(50);
    expect(again).toBe(first);
    expect(titles()).toEqual(["Could not reach the server"]);
    expect(said("assertive")).toEqual(["Could not reach the server"]);
    // The same words as another kind are another toast
    act(() => void toast.success("Could not reach the server"));
    await wait(50);
    expect(titles()).toHaveLength(2);
  });

  it("hands the focus to the next toast when the middle one is dismissed from the keyboard", async () => {
    act(() => {
      toast.success("First");
      toast.success("Second");
      toast.success("Third");
    });
    await wait(50);
    const middle = toasts()[1];
    const cross = middle.querySelector<HTMLButtonElement>("[data-close-button]")!;
    act(() => cross.focus());
    // Enter on a button clicks it with no pointer position
    act(() => void cross.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    await wait(450);
    expect(titles()).toEqual(["Third", "First"]);
    const focused = document.activeElement?.closest("[data-sonner-toast]");
    expect(focused?.querySelector("[data-title]")?.textContent).toBe("First");
    expect(document.activeElement?.matches("[data-close-button]")).toBe(true);
  });

  it("keeps a toast that arrives while the page changes", async () => {
    act(() => {
      navigate("Collections");
      toast.success("Collection created");
    });
    await wait(50);
    act(() => navigate("Collection"));
    await wait(50);
    expect(document.getElementById("trigger")?.textContent).toBe("Collection");
    expect(titles()).toEqual(["Collection created"]);
    expect(said("polite")).toEqual(["Collection created"]);
  });
});


describe("save failure feedback", () => {
  it.each(["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"])("normalizes %s", async (message) => {
    act(() => void toast.error(message));
    await wait(50);
    expect(titles()).toEqual(["Not saved: Durtal could not be reached. Check the connection and try again."]);
  });
  it("removes only the successful action's previous failure", async () => {
    const person = toast.forAction("person:one"), other = toast.forAction("person:two");
    act(() => { person.error("Failed to fetch"); other.error("Another record still needs attention"); });
    await wait(50);
    act(() => void person.success("Person updated"));
    await wait(450);
    expect(titles().sort()).toEqual(["Another record still needs attention", "Person updated"]);
  });
});
