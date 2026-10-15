// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderDefaults } from "@/app/(catalogue)/settings/reader/reader-defaults";
const actions = vi.hoisted(() => ({ list: vi.fn(), reset: vi.fn() }));
vi.mock("@/lib/actions/reader-preferences", () => ({ listReaderBookOverrides: actions.list, resetReaderPreferences: actions.reset }));
vi.mock("@/hooks/use-reader-preferences", () => ({ useReaderPreferences: () => ({ rows: [], ready: true, saving: false, pending: 0, error: null, recoveryError: null, update: vi.fn(), reset: vi.fn(), flush: vi.fn() }) }));
vi.mock("@/components/reader/presentation-settings-dialog", () => ({ PresentationSettingsDialog: () => null }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const list = (deviceClass: "desktop" | "phone", title: string) => ({ ok: true as const, deviceClass, page: 1, pageSize: 50, total: 1, rows: [{ ebookId: "11111111-1111-4111-8111-111111111111", title, presentation: {} }] });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); actions.list.mockReset(); actions.reset.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const click = async (text: string) => { const button = [...host.querySelectorAll("button")].find(item => item.textContent === text)!; await act(async () => button.click()); };
it("does not adopt a late override list from a device size that was left", async () => {
  let resolve!: (value: ReturnType<typeof list>) => void;
  actions.list.mockImplementation(({ deviceClass }) => deviceClass === "desktop" ? new Promise(done => { resolve = done; }) : Promise.resolve(list("phone","Phone book")));
  await act(async () => root.render(createElement(ReaderDefaults,{ initial: { ok: true, ebookId: null, rows: [] }, initialOverrides: list("desktop","Initial desktop") })));
  await click("Phone");
  await act(async () => resolve(list("desktop","Late desktop")));
  expect(host.textContent).toContain("Phone book"); expect(host.textContent).not.toContain("Late desktop");
});
it("clears exactly the displayed book and device, and retains server failure", async () => {
  actions.list.mockResolvedValue(list("desktop","Named book")); actions.reset.mockResolvedValue({ ok: false, error: "Preferences migration is unavailable." });
  await act(async () => root.render(createElement(ReaderDefaults,{ initial: { ok: true, ebookId: null, rows: [] }, initialOverrides: list("desktop","Named book") })));
  await click("Clear override");
  expect(actions.reset).toHaveBeenCalledWith({ deviceClass: "desktop", ebookId: "11111111-1111-4111-8111-111111111111" });
  expect(host.textContent).toContain("Preferences migration is unavailable."); expect(host.textContent).toContain("Named book");
});
// Design polish 2: the panels' text sat on their borders and the switch on the first title
it("pads every row of the defaults and overrides panels, and spaces the device switch", async () => {
  actions.list.mockResolvedValue(list("desktop","Named book"));
  await act(async () => root.render(createElement(ReaderDefaults,{ initial: { ok: true, ebookId: null, rows: [] }, initialOverrides: list("desktop","Named book") })));
  const panels = [...host.querySelectorAll("section > div.divide-y")];
  expect(panels).toHaveLength(2);
  for (const panel of panels) for (const row of panel.children) expect(row.className, row.textContent ?? "").toMatch(/\bpx-5\b/);
  expect(host.textContent).toContain("1 book with a desktop override");
  expect(host.querySelector('[role="radiogroup"]')?.parentElement?.className).toContain("mb-8");
});
