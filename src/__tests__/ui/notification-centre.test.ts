// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { toast as houseToast } from "@/lib/notifications/toast";
import { AppToaster } from "@/components/layout/app-toaster";
import { NotificationCentre } from "@/components/layout/notification-centre";
import { getEntries, record, resetForTests } from "@/lib/notifications/history";

// The notification centre (SLN-567): every page's errors and warnings, read
// once seen, removable one by one or all at once.

let root: Root;
let host: HTMLElement;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const bell = () => document.querySelector<HTMLButtonElement>("[data-notification-centre]")!;
const popover = () => document.querySelector<HTMLElement>("[data-notification-popover]")!;
const items = () => [...popover().querySelectorAll<HTMLElement>("[data-notification]")];

function toggle(state: "open" | "closed") {
  act(() => {
    if (state === "open") popover().setAttribute("data-open", "");
    else popover().removeAttribute("data-open");
    popover().dispatchEvent(Object.assign(new Event("toggle"), { newState: state }));
  });
}

// Rows whose place in the list is below this are out of view
let rowsInView = Infinity;
class RowsInViewObserver {
  constructor(private readonly report: (records: { target: Element; isIntersecting: boolean }[]) => void) {}
  observe(row: Element) {
    this.report([{ target: row, isIntersecting: [...row.parentElement!.children].indexOf(row) < rowsInView }]);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IntersectionObserver = RowsInViewObserver as unknown as typeof IntersectionObserver;
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ":focus-visible") return this === document.activeElement;
    if (selector === ":popover-open") return this.hasAttribute("data-open");
    return matches.call(this, selector);
  };
});
beforeEach(() => {
  rowsInView = Infinity;
  localStorage.clear();
  resetForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement("div", null, createElement(NotificationCentre, { className: "" }), createElement(AppToaster)),
    ),
  );
});
afterEach(() => {
  act(() => toast.dismiss());
  act(() => root.unmount());
  host.remove();
});

describe("the notification centre", () => {
  it("keeps errors and warnings, not routine confirmations", async () => {
    act(() => {
      toast.success("Cover saved");
      toast.error("Could not update this collection", { description: "Nothing was changed." });
      toast.warning("Cover skipped");
      toast("Added to Favourites");
    });
    await wait(50);
    expect(getEntries().map((e) => [e.kind, e.title, e.description])).toEqual([
      ["warning", "Cover skipped", null],
      ["error", "Could not update this collection", "Nothing was changed."],
    ]);
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread");
  });

  it("keeps a pending toast once it fails, as one entry, and not when it succeeds", async () => {
    let id: string | number = 0;
    act(() => {
      id = toast.loading("Uploading cover");
    });
    await wait(50);
    expect(getEntries()).toEqual([]);
    act(() => {
      toast.error("Upload failed", { id });
    });
    await wait(50);
    act(() => {
      toast.error("Upload failed", { id, description: "The file is not an image." });
    });
    await wait(50);
    expect(getEntries().map((e) => [e.title, e.description])).toEqual([["Upload failed", "The file is not an image."]]);
    act(() => {
      const ok = toast.loading("Saving");
      toast.success("Saved", { id: ok });
    });
    await wait(50);
    expect(getEntries()).toHaveLength(1);
  });

  it("dismissing a toast marks nothing read; closing the centre marks what it showed", async () => {
    act(() => {
      toast.error("First");
    });
    await wait(50);
    act(() => toast.dismiss());
    await wait(50);
    expect(getEntries().map((e) => e.read)).toEqual([false]);

    toggle("open");
    expect(items().map((li) => li.dataset.notification)).toEqual(["unread"]);
    expect(items()[0].textContent).toContain("First (unread)");
    // One that arrives while it is open is seen too
    act(() => {
      toast.warning("Second");
    });
    await wait(50);
    toggle("closed");
    expect(getEntries().map((e) => [e.title, e.read])).toEqual([["Second", true], ["First", true]]);
    expect(bell().getAttribute("aria-label")).toBe("Notifications");
  });

  // SLN-1460: a repeated failure under the same toast id was lost, and closing
  // the panel marked every entry read, seen or not
  it("counts the same failure shown again under its id, even after the centre was opened", async () => {
    const fail = async () => { act(() => { toast.error("Could not update the favourite", { id: "favourite" }); }); await wait(50); };
    await fail();
    act(() => { toast.warning("Cover skipped"); });
    await wait(50);
    await fail();
    toggle("open");
    toggle("closed");
    await fail();
    const favourite = getEntries().find((e) => e.title === "Could not update the favourite");
    expect(getEntries()).toHaveLength(2);
    expect(favourite).toMatchObject({ count: 3, read: false });
    expect(getEntries()[0]).toBe(favourite);
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
  });

  // The favourite's case: the house toast folds a repeat into the error still
  // on screen, and the history still counts it
  it("counts a repeat the house toast folds into the error on screen", async () => {
    const fail = async () => { act(() => { houseToast.error("Could not update the favourite. Try again."); }); await wait(50); };
    await fail();
    await fail();
    toggle("open");
    toggle("closed");
    await fail();
    expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(1);
    const favourite = getEntries().find((e) => e.title === "Could not update the favourite. Try again.");
    expect(getEntries()).toHaveLength(1);
    expect(favourite).toMatchObject({ count: 3, read: false });
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
  });

  it("closing marks read only the entries that were in view", async () => {
    act(() => { for (let i = 0; i < 50; i++) record({ id: `p:${i}`, kind: "error", title: `Error ${i}` }, Date.now() + i); });
    rowsInView = 8;
    toggle("open");
    toggle("closed");
    expect(getEntries().filter((e) => e.read).map((e) => e.title)).toEqual(["Error 49", "Error 48", "Error 47", "Error 46", "Error 45", "Error 44", "Error 43", "Error 42"]);
    expect(getEntries().filter((e) => !e.read)).toHaveLength(42);
  });

  it("removes one entry, then all of them", async () => {
    act(() => {
      toast.error("One");
      toast.error("Two");
      toast.error("Three");
    });
    await wait(50);
    toggle("open");
    const remove = [...popover().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === 'Remove "Two"')!;
    act(() => remove.click());
    expect(getEntries().map((e) => e.title)).toEqual(["Three", "One"]);
    const clear = [...popover().querySelectorAll("button")].find((b) => b.textContent === "Clear all")!;
    act(() => clear.click());
    expect(getEntries()).toEqual([]);
    expect(popover().textContent).toContain("No notifications.");
  });

  it("keeps an entry's hidden text inside the list that scrolls, not the panel", async () => {
    act(() => {
      toast.error("Unseen");
    });
    await wait(50);
    toggle("open");
    // The sr-only "(unread)" is placed by its nearest positioned ancestor
    let box = popover().querySelector(".sr-only")!.parentElement;
    while (box && !/\b(relative|absolute|fixed|sticky)\b/.test(box.className)) box = box.parentElement;
    expect(box?.tagName).toBe("UL");
    expect(box?.className).toContain("overflow-y-auto");
  });
});
