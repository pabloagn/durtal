// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/dynamic", () => ({ default: () => (props: { target: { title: string }; onClose(): void; onCommitted(): void }) =>
  h("div", { "data-dialog": props.target.title }, h("button", { onClick: props.onCommitted }, "Commit"), h("button", { onClick: props.onClose }, "Close")) }));
const read = vi.fn();
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => ({ readReviewUnlinkTargetUi: (input: unknown) => read(input) }));

import { UnlinkDialogHost } from "@/components/ebooks/unlink-dialog-host";
import { UnlinkEbookButton } from "@/components/ebooks/unlink-ebook-button";

let root: Root, host: HTMLElement, hideCard: () => void;
const target = { id: "e1", title: "Against Nature", stamp: {}, matching: { operation: {}, automatic: false } };
function Page() {
  const [card, setCard] = useState(true);
  hideCard = () => setCard(false);
  return h("main", null, card && h("section", { "data-card": "" }, h(UnlinkEbookButton, { ebookId: "e1" })), h(UnlinkDialogHost));
}
const button = (text: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === text)!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  read.mockResolvedValue({ ok: true, value: target });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

describe("the layout's Unlink dialog (#247 review)", () => {
  it("stays open when the unlink removes the card that opened it", async () => {
    act(() => root.render(h(Page)));
    await act(async () => button("Unlink…").click());
    expect(host.querySelector('[data-card] [data-dialog]')).toBeNull();
    expect(host.querySelector('[data-dialog="Against Nature"]')).not.toBeNull();
    expect(button("Unlink…").disabled).toBe(true);
    await act(async () => button("Commit").click());
    expect(refresh).toHaveBeenCalledOnce();
    act(() => hideCard());
    expect(host.querySelector('[data-dialog="Against Nature"]')).not.toBeNull();
    act(() => button("Close").click());
    expect(host.querySelector("[data-dialog]")).toBeNull();
  });
});
