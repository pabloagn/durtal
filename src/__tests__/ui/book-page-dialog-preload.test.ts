// @vitest-environment happy-dom
import { readingPageFixture } from "../fixtures/reading-page";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-1464: once the book page is idle, the dialog its main action opens has
// loaded, so Log progress (or Start reading) opens first time
const loads = vi.hoisted(() => ({ progress: 0, start: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/reading/dialogs/log-progress-dialog", () => {
  loads.progress++;
  return { LogProgressDialog: () => null };
});
vi.mock("@/components/reading/dialogs/start-reading-dialog", () => {
  loads.start++;
  return { StartReadingDialog: () => null };
});
import { ReadingProvider } from "@/components/reading/reading-provider";

let root: Root, host: HTMLElement;
let idle: (() => void)[] = [];
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  idle = [];
  vi.stubGlobal("requestIdleCallback", (run: () => void) => idle.push(run));
  vi.stubGlobal("cancelIdleCallback", () => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const page = (status: string | null) => readingPageFixture({
  workId: "w1", workTitle: "Against Nature", bookRating: null, dayStartHour: 4, editions: [], homes: [], today: "2026-10-19", zone: "UTC",
  rows: status ? [{ reading: { id: "r1", workId: "w1", status, editionId: null, totalMinutes: null }, fingerprint: "a".repeat(32), sessionCount: 0 }] : [],
});

it("loads Log progress when the page is idle, for a book being read", async () => {
  await act(async () => { root.render(h(ReadingProvider, { data: page("reading"), children: null })); });
  expect(loads.progress, "nothing loads before the page is idle").toBe(0);
  expect(idle).toHaveLength(1);
  await act(async () => { idle[0](); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(loads.progress).toBe(1);
  expect(loads.start).toBe(0);
});

it("loads Start reading instead for a book with no open reading", async () => {
  await act(async () => { root.render(h(ReadingProvider, { data: page(null), children: null })); });
  await act(async () => { idle.forEach((run) => run()); await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(loads.start).toBe(1);
});
