// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

// Up Next's list and page (SLN-452), with the server actions mocked.

const actions = vi.hoisted(() => ({
  moveQueueItem: vi.fn(async (input: { workId: string }) => ({ workId: input.workId, place: 1, total: 3 })),
  removeFromQueue: vi.fn(async () => ({ id: "q1" })),
  restoreQueueItem: vi.fn(async () => ({})),
  getQueue: vi.fn(async () => [] as unknown[]),
}));
const opened = vi.hoisted(() => ({ list: [] as unknown[] }));
const toasts = vi.hoisted(() => ({ list: [] as { message: string; undo?: () => void }[] }));
vi.mock("@/lib/actions/reading-queue", () => actions);
vi.mock("@/lib/actions/reading", () => ({ getPaceContext: async () => ({ readings: {}, priors: { byLanguageFormat: {}, byFormat: {}, overall: null } }) }));
vi.mock("@/lib/reading/day", () => ({ readingToday: async () => "2026-10-05" }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: async () => [] }) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/reading/next" }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: () => {} }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: (r: unknown) => opened.list.push(r) }) }));
vi.mock("@/components/reading/hub-actions", () => ({ HubActions: () => null }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: ({ tabs }: { tabs?: ReactNode }) => createElement("header", null, tabs) }));
vi.mock("sonner", () => {
  const push = (message: string, opts?: { action?: { onClick: () => void } }) => toasts.list.push({ message, undo: opts?.action?.onClick });
  return { toast: Object.assign(push, { success: push, error: push, message: push }) };
});

import { QueueList, type QueueRow } from "@/components/reading/queue-list";
import UpNextPage from "@/app/reading/next/page";

let coarse = false;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("coarse") ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  coarse = false;
  toasts.list = [];
  opened.list = [];
  Object.values(actions).forEach((fn) => fn.mockClear());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const row = (workId: string, title: string, place = 1): QueueRow => ({
  workId,
  place,
  title,
  href: `/library/${workId}`,
  author: "Someone",
  cover: null,
  editionId: `${workId}-e`,
  line: "320 p. · On your shelf in Amsterdam · About 9 h",
  note: null,
  added: "Added 3 Oct",
});
const rows = [row("a", "Nadja", 1), row("b", "Watt", 2), row("c", "La Curée", 3)];
const order = () => [...host.querySelectorAll("[data-queue-row]")].map((r) => r.getAttribute("data-queue-row"));
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
async function menu(workId: string, item: string) {
  act(() => (host.querySelector(`[data-queue-menu="${workId}"]`) as HTMLButtonElement).click());
  const found = [...host.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.trim() === item) as HTMLElement | undefined;
  expect(found, item).toBeTruthy();
  await act(async () => found!.click());
  await flush();
}

describe("the Up Next list", () => {
  it("moves a book up, down and to the top from its menu, saves each move, and says where it went", async () => {
    act(() => root.render(createElement(QueueList, { rows })));
    expect(order()).toEqual(["a", "b", "c"]);
    await menu("c", "Move up");
    expect(order()).toEqual(["a", "c", "b"]);
    expect(actions.moveQueueItem).toHaveBeenLastCalledWith({ workId: "c", afterWorkId: "a", beforeWorkId: "b" });
    expect(host.querySelector("[data-queue-said]")!.textContent).toBe("La Curée moved to position 2 of 3");
    expect(host.querySelector("[data-queue-said]")!.getAttribute("aria-live")).toBe("polite");
    await menu("a", "Move down");
    expect(order()).toEqual(["c", "a", "b"]);
    expect(actions.moveQueueItem).toHaveBeenLastCalledWith({ workId: "a", afterWorkId: "c", beforeWorkId: "b" });
    await menu("b", "Move to top");
    expect(order()).toEqual(["b", "c", "a"]);
    // The top of all of Up Next: no neighbours
    expect(actions.moveQueueItem).toHaveBeenLastCalledWith({ workId: "b", afterWorkId: null, beforeWorkId: null });
    expect(host.querySelector("[data-queue-said]")!.textContent).toBe("Watt moved to position 1 of 3");
  });

  it("under a filter, shows each book's place in all of Up Next and sends Move to top with no neighbours", async () => {
    const some = [row("a", "Nadja", 2), row("b", "Watt", 5), row("c", "La Curée", 9)];
    act(() => root.render(createElement(QueueList, { rows: some, filtered: true })));
    expect([...host.querySelectorAll("[data-queue-place]")].map((p) => p.textContent)).toEqual(["2", "5", "9"]);
    await menu("c", "Move up");
    expect(actions.moveQueueItem).toHaveBeenLastCalledWith({ workId: "c", afterWorkId: "a", beforeWorkId: "b" });
    // The first row shown is 2nd in Up Next: it can still go to the top
    await menu("a", "Move to top");
    expect(actions.moveQueueItem).toHaveBeenLastCalledWith({ workId: "a", afterWorkId: null, beforeWorkId: null });
  });

  it("puts a row back when the server refuses the move", async () => {
    actions.moveQueueItem.mockRejectedValueOnce(new Error("Up Next changed elsewhere; reload"));
    act(() => root.render(createElement(QueueList, { rows })));
    await menu("c", "Move to top");
    expect(order()).toEqual(["a", "b", "c"]);
    expect(toasts.list.map((t) => t.message)).toContain("Up Next changed elsewhere; reload");
  });

  it("lifts a row with the keyboard: its handle is a named button with the instructions", () => {
    act(() => root.render(createElement(QueueList, { rows })));
    const handle = host.querySelector('[data-queue-row="b"] [data-queue-handle]') as HTMLElement;
    expect(handle.getAttribute("aria-label")).toBe("Move Watt");
    expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    const described = document.getElementById(handle.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe("Press Space to lift a book, the arrow keys to move it, Space to drop it, Escape to cancel.");
    expect(handle.getAttribute("data-tooltip")).toBeTruthy();
  });

  it("offers Move up and Move down where they apply, and Remove with Undo", async () => {
    coarse = true;
    act(() => root.render(createElement(QueueList, { rows })));
    act(() => (host.querySelector('[data-queue-menu="a"]') as HTMLButtonElement).click());
    expect([...host.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent?.trim())).toEqual(["Move down", "Remove from Up Next"]);
    await act(async () => ([...host.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.includes("Remove")) as HTMLElement).click());
    await flush();
    expect(order()).toEqual(["b", "c"]);
    const undo = toasts.list.find((t) => t.message === "Removed Nadja from Up Next")!.undo!;
    await act(async () => undo());
    expect(actions.restoreQueueItem).toHaveBeenCalledWith({ id: "q1" });
  });

  it("starts a book with its queued edition", () => {
    act(() => root.render(createElement(QueueList, { rows })));
    act(() => (host.querySelector('[data-queue-start="b"]') as HTMLButtonElement).click());
    expect(opened.list).toEqual([{ kind: "start", workId: "b", editionId: "b-e" }]);
  });
});

describe("the Up Next page", () => {
  const queued = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      workId: `w${i}`,
      title: `Book ${i + 1}`,
      slug: null,
      author: null,
      workCover: null,
      editionId: null,
      editions: [],
      note: null,
      addedAt: "2026-10-01T10:00:00Z",
      atHandCopyId: null,
      readCount: 0,
      lastFinishedOn: null,
      owned: false,
    }));

  it("shows 50 books at a time, counts them all, and offers the rest", async () => {
    actions.getQueue.mockResolvedValueOnce(queued(60));
    const html = renderToStaticMarkup(await UpNextPage({ searchParams: Promise.resolve({}) }));
    expect(html.match(/data-queue-row=/g)).toHaveLength(50);
    expect(html).toContain("60 books");
    const more = html.match(/<a[^>]*data-queue-more[^>]*>.*?<\/a>/)?.[0] ?? "";
    expect(more).toContain('href="/reading/next?show=100"');
    expect(more.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "")).toBe("Show 10 more");
  });

  it("shows every book when asked for more", async () => {
    actions.getQueue.mockResolvedValueOnce(queued(60));
    const html = renderToStaticMarkup(await UpNextPage({ searchParams: Promise.resolve({ show: "100" }) }));
    expect(html.match(/data-queue-row=/g)).toHaveLength(60);
    expect(html).not.toContain("data-queue-more");
  });

  it("shows an empty state that adds from the unread books he owns", async () => {
    const html = renderToStaticMarkup(await UpNextPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Nothing in Up Next");
    expect(html).toContain('href="/library?reading=unread&amp;holding=owned"');
    expect(html).toContain("Add from your library");
  });
});
