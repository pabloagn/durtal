// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TimelineItem } from "@/lib/actions/activity";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

const action = vi.hoisted(() => ({
  read: vi.fn(),
  added: [] as Array<(comment: { id: string; eventId: string; contentHtml: string; contentJson: unknown }) => void>,
  updated: [] as Array<() => void>,
}));
vi.mock("@/lib/actions/activity", () => ({ getActivityTimeline: action.read }));
vi.mock("@/components/shared/section-heading", () => ({ SectionHeading: () => null }));
vi.mock("../../components/activity/activity-event-item", () => ({ ActivityEventItem: ({ eventKey }: { eventKey: string }) => createElement("p", { "data-event": eventKey }, eventKey) }));
vi.mock("../../components/activity/comment-item", () => ({ CommentItem: ({ comment, onUpdated, onDeleted }: { comment: { id: string; contentHtml: string }; onUpdated: () => void; onDeleted: (id: string) => void }) => {
  action.updated.push(onUpdated);
  return createElement("div", null, comment.contentHtml,
    createElement("button", { onClick: onUpdated }, "Update comment"),
    createElement("button", { onClick: () => onDeleted(comment.id) }, "Delete comment"));
} }));
vi.mock("../../components/activity/comment-editor", () => ({ CommentEditor: ({ onCommentAdded }: { onCommentAdded: (comment: { id: string; eventId: string; contentHtml: string; contentJson: unknown }) => void }) => {
  action.added.push(onCommentAdded);
  return createElement("button", { onClick: () => onCommentAdded({ id: "comment", eventId: "optimistic", contentHtml: "Kept comment", contentJson: {} }) }, "Add comment");
} }));
import { ActivityTimeline } from "../../components/activity/activity-timeline";

type Result = { events: TimelineItem[]; hasMore: boolean; nextCursor: string | null };
const workA = "00000000-0000-4000-a000-000000000009", workB = "00000000-0000-4000-a000-000000000021";
function deferred() {
  let resolve!: (value: Result) => void, reject!: (error: Error) => void;
  const promise = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function result(label: string | null, hasMore = false): Result {
  return { events: label ? [{ id: label, entityType: "work", entityId: workA, eventKey: label, metadata: null, createdAt: new Date("2026-10-12T00:00:00Z") }] : [], hasMore, nextCursor: hasMore ? "next-page" : null };
}
let root: Root, host: HTMLDivElement, mounted = false;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { action.read.mockReset(); action.added.length = 0; action.updated.length = 0; host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounted = true; });
afterEach(() => { if (mounted) act(() => root.unmount()); host.remove(); });
const render = (entityId = workA) => act(() => root.render(createElement(ActivityTimeline, { entityType: "work", entityId })));
const button = (name: string) => [...host.querySelectorAll("button")].find(node => node.textContent === name)!;
const click = (name: string) => act(() => button(name).click());
const resolve = (read: ReturnType<typeof deferred>, value: Result) => act(async () => { read.resolve(value); await read.promise; });
const reject = (read: ReturnType<typeof deferred>) => act(async () => { read.reject(new TypeError("Load failed")); await Promise.resolve(); });

describe("activity timeline read lifecycle", () => {
  it("settles an initial failure honestly and retries the actual read", async () => {
    const first = deferred(), retry = deferred(); action.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(); expect(host.textContent).toContain("Loading activity..."); await reject(first);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Activity could not be loaded.");
    expect(host.textContent).not.toContain("Loading activity..."); expect(host.textContent).not.toContain("No activity yet");
    click("Retry activity"); await resolve(retry, result("recovered"));
    expect(host.textContent).toContain("recovered"); expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(action.read).toHaveBeenLastCalledWith("work", workA, 20, undefined);
  });
  it("shows an empty timeline only after a successful empty read", async () => {
    const read = deferred(); action.read.mockReturnValue(read.promise); render(); await resolve(read, result(null));
    expect(host.textContent).toContain("No activity yet"); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("catches a read rejected after unmount and removes the refresh listener", async () => {
    const read = deferred(); action.read.mockReturnValue(read.promise); render(); act(() => root.unmount()); mounted = false;
    await reject(read); act(() => triggerActivityRefresh()); expect(action.read).toHaveBeenCalledTimes(1); expect(host.textContent).toBe("");
    // Vitest also fails this case on the original component's unhandled rejection.
  });
  it("does not let an older completion overwrite the latest refresh or stop its loader", async () => {
    const older = deferred(), latest = deferred(); action.read.mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    render(); act(() => triggerActivityRefresh()); await resolve(older, result("stale"));
    expect(host.textContent).toContain("Loading activity..."); expect(host.textContent).not.toContain("stale");
    await resolve(latest, result("latest")); expect(host.textContent).toContain("latest"); expect(host.textContent).not.toContain("Loading activity...");
  });
  it("preserves visible rows when a background refresh fails", async () => {
    const first = deferred(), refresh = deferred(); action.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(refresh.promise);
    render(); await resolve(first, result("retained")); act(() => triggerActivityRefresh()); await reject(refresh);
    expect(host.textContent).toContain("retained"); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain("No activity yet");
  });
  it("settles failed pagination, keeps rows and cursor, and permits another native Show more", async () => {
    const first = deferred(), failed = deferred(), retry = deferred(); action.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
    render(); await resolve(first, result("first", true)); click("Show more"); await reject(failed);
    expect(host.textContent).toContain("first"); expect(button("Show more").disabled).toBe(false); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    click("Show more"); expect(action.read).toHaveBeenLastCalledWith("work", workA, 20, "next-page"); await resolve(retry, result("second"));
    expect(host.textContent).toContain("first"); expect(host.textContent).toContain("second"); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("ignores a departed entity's late read and does not show its rows on a failed new entity", async () => {
    const oldRead = deferred(), newRead = deferred(); action.read.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    render(); render(workB); await resolve(oldRead, result("other-work")); await reject(newRead);
    expect(host.textContent).not.toContain("other-work"); expect(host.textContent).not.toContain("No activity yet"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(action.read).toHaveBeenLastCalledWith("work", workB, 20, undefined);
  });
  it("rejects callbacks captured under a departed owner before they start a read or insert a comment", async () => {
    const first = deferred(), second = deferred(), stale = deferred();
    action.read.mockReturnValue(stale.promise).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render();
    const initial = result("old-owner");
    initial.events[0].comment = { id: "old-comment", contentHtml: "Old owner comment", contentJson: {}, updatedAt: new Date(), attachments: [] };
    await resolve(first, initial);
    const oldAdded = action.added.at(-1)!, oldUpdated = action.updated.at(-1)!;
    render(workB);
    const current = result("current-owner"); current.events[0].entityId = workB;
    await resolve(second, current);
    act(() => {
      oldUpdated();
      oldAdded({ id: "late-comment", eventId: "late-event", contentHtml: "Late old owner comment", contentJson: {} });
    });
    await resolve(stale, result("stale-owner-read"));
    expect(action.read).toHaveBeenCalledTimes(2);
    expect(action.read).toHaveBeenLastCalledWith("work", workB, 20, undefined);
    expect(host.textContent).toContain("current-owner");
    expect(host.textContent).not.toContain("Late old owner comment");
    expect(host.textContent).not.toContain("stale-owner-read");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not resurrect a confirmed deletion from a pending page and settles its loader", async () => {
    const first = deferred(), pendingPage = deferred();
    action.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(pendingPage.promise);
    const initial = result("retained", true);
    const deleted = { ...initial.events[0], id: "deleted-event", eventKey: "work.comment_added",
      comment: { id: "deleted-comment", contentHtml: "Delete this comment", contentJson: {}, updatedAt: new Date(), attachments: [] } };
    initial.events.push(deleted);
    render(); await resolve(first, initial); click("Show more"); click("Delete comment");
    expect(host.textContent).not.toContain("Delete this comment");
    expect(button("Show more").disabled).toBe(false);
    const stale = result("old-page"); stale.events.push(deleted);
    await resolve(pendingPage, stale);
    expect(host.textContent).toContain("retained");
    expect(host.textContent).not.toContain("Delete this comment");
    expect(host.textContent).not.toContain("old-page");
    expect(button("Show more").disabled).toBe(false);
  });
  it("keeps the refreshed snapshot and cursor when an older pagination read finishes later", async () => {
    const first = deferred(), olderPage = deferred(), refresh = deferred(), next = deferred();
    action.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(olderPage.promise).mockReturnValueOnce(refresh.promise).mockReturnValueOnce(next.promise);
    render(); await resolve(first, result("first", true)); click("Show more"); act(() => triggerActivityRefresh());
    const latest = result("refreshed", true); latest.nextCursor = "fresh-cursor";
    await resolve(refresh, latest); await resolve(olderPage, result("stale-more"));
    expect(host.textContent).toContain("refreshed"); expect(host.textContent).not.toContain("first"); expect(host.textContent).not.toContain("stale-more");
    expect(button("Show more").disabled).toBe(false); click("Show more");
    expect(action.read).toHaveBeenLastCalledWith("work", workA, 20, "fresh-cursor");
    await resolve(next, result("fresh-page")); expect(host.textContent).toContain("refreshed"); expect(host.textContent).toContain("fresh-page");
  });
  it("keeps the optimistic comment when reconciliation fails and catches an update refresh too", async () => {
    const first = deferred(), reconciliation = deferred(), updated = deferred(); action.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(reconciliation.promise).mockReturnValueOnce(updated.promise);
    render(); await resolve(first, result(null)); click("Add comment"); await reject(reconciliation);
    expect(host.textContent).toContain("Kept comment"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    click("Update comment"); await reject(updated); expect(host.textContent).toContain("Kept comment"); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});
