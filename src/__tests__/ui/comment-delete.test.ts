// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TimelineItem } from "@/lib/actions/activity";

// SLN-1460: a comment deleted in one press, a failure left only a console line,
// and every comment's buttons were named just "Edit" and "Delete"
const mocks = vi.hoisted(() => ({ read: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/actions/activity", () => ({ getActivityTimeline: mocks.read }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { error: mocks.error } }));
vi.mock("@/components/shared/section-heading", () => ({ SectionHeading: () => null }));
vi.mock("../../components/activity/activity-event-item", () => ({ ActivityEventItem: () => null }));
vi.mock("../../components/activity/comment-editor", () => ({ CommentEditor: () => createElement("button", { type: "button" }, "Leave a comment...") }));
import { ActivityTimeline } from "../../components/activity/activity-timeline";

const work = "00000000-0000-4000-a000-000000000009";
const commentEvent = (n: number, html: string): TimelineItem => ({
  id: `event-${n}`, entityType: "work", entityId: work, eventKey: "comment.added", metadata: null, createdAt: new Date("2026-10-12T00:00:00Z"),
  comment: { id: `00000000-0000-4000-a000-00000000010${n}`, contentHtml: html, contentJson: {}, updatedAt: new Date("2026-10-12T00:00:00Z"), attachments: [] },
});
let root: Root, host: HTMLDivElement;
const wait = (ms = 0) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const named = (name: string) => [...document.querySelectorAll("button")].filter((b) => b.textContent === name);
const dialog = () => document.querySelector("dialog[open]");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // As in a browser, an open modal dialog makes the rest of the page inert:
  // nothing outside it takes the focus (happy-dom has no inert)
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    const modal = document.querySelector("dialog[open]");
    if (modal && !modal.contains(this)) return;
    focus.call(this, options);
  };
});
beforeEach(async () => {
  mocks.read.mockReset(); mocks.error.mockReset();
  mocks.read.mockResolvedValue({ events: [commentEvent(1, "<p>First <b>thought</b></p>"), commentEvent(2, "<p>Second</p>")], hasMore: false, nextCursor: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(createElement(ActivityTimeline, { entityType: "work", entityId: work })); });
  await wait();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("deleting a comment", () => {
  it("names each button for its comment", () => {
    expect(named("Edit comment")).toHaveLength(2);
    expect(named("Delete comment")).toHaveLength(2);
  });

  it("asks first, naming the comment, and deletes nothing on Cancel", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 })); vi.stubGlobal("fetch", fetch);
    act(() => named("Delete comment")[0].click());
    expect(dialog()?.textContent).toContain("Delete comment");
    expect(dialog()?.textContent).toContain("First thought");
    expect(dialog()?.textContent).toContain("The comment is deleted. This cannot be undone.");
    act(() => named("Cancel")[0].click());
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain("First thought");
  });

  // The focus moves as the dialog goes. (A browser can run a timer while the
  // dialog is still open and the page inert; happy-dom commits sooner, so the
  // browser check in the PR covers that order.)
  it("deletes on confirm and moves the focus to the next comment, then to the comment box", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    act(() => named("Delete comment")[0].click());
    await act(async () => { [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Delete")!.click(); });
    expect(host.textContent).not.toContain("First thought");
    expect(document.activeElement).toBe(named("Delete comment")[0]);
    act(() => named("Delete comment")[0].click());
    await act(async () => { [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Delete")!.click(); });
    expect(host.textContent).not.toContain("Second");
    expect(document.activeElement?.textContent).toBe("Leave a comment...");
  });

  it("says so when the delete fails, and keeps the comment and the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    act(() => named("Delete comment")[1].click());
    await act(async () => { [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Delete")!.click(); });
    await wait();
    expect(mocks.error).toHaveBeenCalledWith("Could not delete the comment");
    expect(host.textContent).toContain("Second");
    expect(dialog()).not.toBeNull();
  });
});
