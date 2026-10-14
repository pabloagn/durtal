// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The recovery page uses the app's controls (SLN-692): its Status is the
// app's menu, not a native select, which Safari draws as a grey system box.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));
vi.mock("@/lib/actions/reader-history", () => ({
  beginReaderHistory: vi.fn(), commitReaderHistory: vi.fn(), finishReaderHistory: vi.fn(), undoReaderHistory: vi.fn(),
}));
import { ReaderHistoryRecovery } from "@/app/(catalogue)/settings/reading/ebooks/reader-history-recovery";
import { beginReaderHistory } from "@/lib/actions/reader-history";

type Rows = Parameters<typeof ReaderHistoryRecovery>[0]["rows"];
const rows = [{
  ebookId: "00000000-0000-4000-a000-000000000001", title: "Ubik", fingerprint: "0".repeat(32), imported: false,
  selected: true, reason: null, reading: { status: "paused", startedOn: "2025-06-01", finishedOn: null, position: { percent: 40 } },
}] as unknown as Rows;

let root: Root, host: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("reading history recovery", () => {
  it("chooses a row's status with the app's menu, and a finished status opens the finish date", () => {
    act(() => root.render(createElement(ReaderHistoryRecovery, { rows, operations: [] })));
    expect(host.querySelector("select")).toBeNull();
    const status = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(status.textContent).toContain("Paused");
    expect(host.querySelector(`label[for="${status.id}"]`)?.textContent).toBe("Status");
    const finished = () => [...host.querySelectorAll<HTMLInputElement>('input[type="date"]')][1];
    expect(finished().disabled).toBe(true);
    act(() => status.click());
    act(() => [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes("Finished"))!.click());
    expect(host.querySelector('[role="combobox"]')!.textContent).toContain("Finished");
    expect(finished().disabled).toBe(false);
  });

  it("keeps its button's label while the recovery runs (SLN-699)", async () => {
    vi.mocked(beginReaderHistory).mockReturnValue(new Promise(() => {}));
    act(() => root.render(createElement(ReaderHistoryRecovery, { rows, operations: [] })));
    const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toBe("Add selected history");
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe("Add selected history");
  });
});
