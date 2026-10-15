// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Suspense, act, createElement, use, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ListPendingProvider, ListPendingSwap, useListBusy, useListNavigate } from "@/components/shared/list-pending";

// A search marks its list busy from the first key until the new results are
// in, with the books list's own wait (SLN-753)

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Results that wait on a promise per query, as a server render would */
const answers = new Map<string, { promise: Promise<string>; resolve: (v: string) => void }>();
function answer(q: string) {
  if (!answers.has(q)) {
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    answers.set(q, { promise, resolve });
  }
  return answers.get(q)!;
}
answer("").resolve("all books");

function Results({ q }: { q: string }) {
  return createElement("p", { "data-results": "" }, use(answer(q).promise));
}

let controls: { begin: () => void; search: (q: string) => void } | null = null;
function List() {
  const [q, setQ] = useState("");
  const list = useListBusy()!;
  const navigate = useListNavigate();
  controls = { begin: list.begin, search: (next) => navigate(() => setQ(next)) };
  return createElement(ListPendingSwap, null, createElement(Suspense, { fallback: null }, createElement(Results, { q })));
}

const spinner = () => host.querySelector('svg[role="status"]');
const results = () => host.querySelector("[data-results]")!;

describe("ListPendingSwap", () => {
  it("shows the list's wait from the first key until the results arrive", async () => {
    await act(async () => root.render(createElement(ListPendingProvider, null, createElement(List))));
    expect(results().textContent).toBe("all books");
    expect(spinner()).toBeNull();

    // A key: busy at once, before anything is sent
    await act(async () => controls!.begin());
    expect(spinner()).not.toBeNull();
    // The old results stay mounted underneath, hidden
    expect(results().textContent).toBe("all books");
    expect(results().parentElement!.className).toBe("hidden");

    // Sent: still busy while the answer is on its way
    await act(async () => controls!.search("borges"));
    expect(spinner()).not.toBeNull();

    await act(async () => answer("borges").resolve("Ficciones"));
    expect(spinner()).toBeNull();
    expect(results().textContent).toBe("Ficciones");
    expect(results().parentElement!.className).toBe("contents");
  });

  it("gives focus back to the control inside the results that started the wait", async () => {
    function Sorted() {
      const [q, setQ] = useState("");
      const navigate = useListNavigate();
      return createElement(
        ListPendingSwap,
        null,
        createElement("button", { onClick: () => navigate(() => setQ("dune")) }, "Title"),
        createElement(Suspense, { fallback: null }, createElement(Results, { q })),
      );
    }
    await act(async () => root.render(createElement(ListPendingProvider, null, createElement(Sorted))));
    const header = host.querySelector("button")!;
    header.focus();
    await act(async () => header.click());
    // A browser drops focus from a control that is hidden
    header.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => answer("dune").resolve("Dune"));
    expect(document.activeElement).toBe(header);
  });

  it("navigates plainly outside a provider", () => {
    let ran = false;
    function Plain() {
      useListNavigate()(() => (ran = true));
      return null;
    }
    act(() => root.render(createElement(Plain)));
    expect(ran).toBe(true);
  });
});
