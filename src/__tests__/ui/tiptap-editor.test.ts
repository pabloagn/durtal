// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TiptapEditor } from "@/components/shared/tiptap-editor";
import { CommentEditor } from "@/components/activity/comment-editor";

// The shared rich text field (SLN-447) and the comment editor built on it.

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

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const labels = () => [...host.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label"));

describe("TiptapEditor", () => {
  it("opens from HTML when there is no JSON, offers only its tools, and reports HTML and JSON", async () => {
    const changes: { html: string; json: unknown }[] = [];
    let editor: import("@tiptap/react").Editor | null = null;
    act(() =>
      root.render(
        createElement(TiptapEditor, {
          label: "Review",
          value: { html: "<p>Imported <strong>review</strong></p>", json: null },
          onChange: (v) => changes.push(v),
          onReady: (e) => (editor = e),
        }),
      ),
    );
    await settle();
    const area = host.querySelector('[aria-label="Review"][contenteditable]') as HTMLElement;
    expect(area.innerHTML).toContain("<strong>review</strong>");
    expect(host.querySelector("label")?.textContent).toBe("Review");
    expect(labels()).toEqual(["Bold", "Italic", "Bullet List", "Numbered List", "Blockquote", "Link"]);
    await act(async () => {
      editor!.commands.selectAll();
      editor!.commands.toggleItalic();
    });
    await settle();
    expect(changes.at(-1)!.html).toContain("<em>");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.at(-1)!.html).toContain("<p>");
    expect(changes.at(-1)!.json).toMatchObject({ type: "doc" });
  });
});

describe("CommentEditor", () => {
  it("keeps its own tools and posts contentHtml and contentJson", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "c1", eventId: "e1" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const added = vi.fn();
    act(() => root.render(createElement(CommentEditor, { entityType: "work", entityId: "w1", onCommentAdded: added, initialContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] }, commentId: undefined })));
    // Collapsed: one button opens the editor
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(labels()).toEqual(
      expect.arrayContaining(["Bold", "Italic", "Underline", "Strikethrough", "Code", "Code Block", "Bullet List", "Numbered List", "Blockquote", "Link", "Attach file", "Post comment"]),
    );
    await settle();
    await act(async () => (host.querySelector('button[aria-label="Post comment"]') as HTMLButtonElement).click());
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/api/comments", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ entityType: "work", entityId: "w1", contentHtml: expect.stringContaining("Hello"), contentJson: { type: "doc" } });
    vi.unstubAllGlobals();
  });

  it("posts twice in a row: the collapse after a post destroys the editor without breaking the section", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: "c1", eventId: "e1" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };
    // The activity section renders again with the new comment, with new callbacks
    const render = () =>
      root.render(createElement(CommentEditor, { entityType: "work", entityId: "w1", initialContent: content, commentId: undefined, onCommentAdded: () => undefined }));
    act(render);
    for (let n = 1; n <= 2; n++) {
      await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
      await settle();
      await act(async () => (host.querySelector('button[aria-label="Post comment"]') as HTMLButtonElement).click());
      await settle();
      await act(async () => render());
      await settle();
      // Collapsed again, with the button that opens it
      expect(host.querySelector('button[aria-label="Post comment"]')).toBeNull();
      expect(host.textContent).toContain("Leave a comment");
      expect(fetchMock).toHaveBeenCalledTimes(n);
    }
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    vi.unstubAllGlobals();
  });
});
