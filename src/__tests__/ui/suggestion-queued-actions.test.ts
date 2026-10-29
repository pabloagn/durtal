// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/lib/actions/catalogue-client", () => ({ addToQueue: api.add }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/reading/reading-dialogs-provider", () => ({ useReadingDialogs: () => ({ open: vi.fn() }) }));
vi.mock("@/components/reading/suggestions/use-feedback", () => ({ useSuggestionFeedback: () => vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const { createElement } = await import("react");
  return {
    DropdownMenu: ({ children }: { children: never }) => createElement("div", null, children),
    DropdownMenuItem: ({ children, onClick }: { children: never; onClick: () => void }) => createElement("button", { onClick }, children),
    DropdownMenuSeparator: () => null,
  };
});
import { SuggestionActions } from "@/components/reading/suggestions/suggestion-list";
import type { SuggestionRow } from "@/lib/reading/suggest/view";
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); api.add.mockReset(); host=document.createElement("div");document.body.append(host);root=createRoot(host); });
afterEach(async () => { await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals(); });
const row = (queued: boolean): SuggestionRow => ({ workId: "test", title: "A book", href: "/library/test", author: null, cover: null, editionId: null,
  isPoison: false, queued, line: "", reasons: [], prediction: null, predictionSource: null, why: [], score: 1 });
it.each([false,true])("does not offer another add for an already queued book (compact %s)", async compact => {
  await act(async()=>root.render(createElement(SuggestionActions,{row:row(true),compact})));
  expect(host.textContent).not.toContain("Add to Up next");
  expect(api.add).not.toHaveBeenCalled();
});
it("still offers an add for a book outside the queue", async()=>{
  await act(async()=>root.render(createElement(SuggestionActions,{row:row(false),compact:false})));
  expect(host.textContent).toContain("Add to Up next");
});
