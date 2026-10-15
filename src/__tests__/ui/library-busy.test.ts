// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Suspense, act, createElement, use, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LibraryFilters } from "@/app/(catalogue)/library/filters";
import { ListPendingProvider, ListPendingSwap } from "@/components/shared/list-pending";

// The books list shows its wait from the first key, as People and eBooks do (SLN-806)

const navigation = vi.hoisted(() => ({ query: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("@/lib/actions/library-filters", () => ({ getLibraryFilterOptions: vi.fn(async () => null) }));

let root: Root;
let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.useFakeTimers();
  navigation.query = "";
  navigation.push.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const render = () =>
  act(() =>
    root.render(
      createElement(ListPendingProvider, null,
        createElement(LibraryFilters),
        createElement(ListPendingSwap, null, createElement("p", { "data-books": "" }, "All books")),
      ),
    ),
  );
const spinner = () => host.querySelector('svg[role="status"]');
const books = () => host.querySelector("[data-books]")!;

describe("the books list's wait", () => {
  it("shows from the first key of a search, before the typing pause ends", () => {
    render();
    expect(spinner()).toBeNull();
    const input = host.querySelector<HTMLInputElement>("input[data-shortcut-search]")!;
    act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "b");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(spinner()).not.toBeNull();
    expect(books().parentElement!.className).toBe("hidden");
    expect(navigation.push).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(navigation.push).toHaveBeenCalledWith("/library?q=b");
  });

  it("shows for a sort, and clears once the navigation is done", () => {
    render();
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "Recent")!.click());
    expect(navigation.push).toHaveBeenCalledWith("/library?sort=recent&order=desc");
    // The mocked navigation finishes at once, so the books show again
    expect(spinner()).toBeNull();
    expect(books().parentElement!.className).toBe("contents");
  });

  it("removing a filter keeps the wait up until the new books arrive", async () => {
    // Books that wait on the server for each address, as the page's would
    const answers = new Map<string, { promise: Promise<string>; resolve: (v: string) => void }>();
    const answer = (href: string) => {
      if (!answers.has(href)) {
        let resolve!: (v: string) => void;
        answers.set(href, { promise: new Promise<string>((r) => (resolve = r)), resolve });
      }
      return answers.get(href)!;
    };
    answer("/library?holding=owned").resolve("Owned books");
    let show!: (href: string) => void;
    function Books() {
      const [href, setHref] = useState("/library?holding=owned");
      show = setHref;
      return createElement(Suspense, { fallback: null }, createElement(Answer, { href }));
    }
    function Answer({ href }: { href: string }) {
      return createElement("p", { "data-books": "" }, use(answer(href).promise));
    }
    navigation.query = "holding=owned";
    navigation.push.mockImplementation((href: string) => show(href));
    await act(async () =>
      root.render(
        createElement(ListPendingProvider, null,
          createElement(LibraryFilters),
          createElement(ListPendingSwap, null, createElement(Books)),
        ),
      ),
    );
    expect(books().textContent).toBe("Owned books");
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!;
    await act(async () => remove.click());
    expect(navigation.push).toHaveBeenCalledWith("/library");
    // The old books stay, hidden under the wait, until the new ones arrive
    expect(spinner()).not.toBeNull();
    expect(books().textContent).toBe("Owned books");
    await act(async () => answer("/library").resolve("All books"));
    expect(spinner()).toBeNull();
    expect(books().textContent).toBe("All books");
  });
});
