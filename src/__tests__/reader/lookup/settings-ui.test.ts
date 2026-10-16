// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";

// Settings › Reader › Lookup: Translate into first, sources as rows with Edit (SLN-687).
const actions = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/actions/reader-lookup", () => ({ getLookupSettings: actions.get, updateLookupSettings: actions.update }));
const { LookupSettingsGroup } = await import("@/app/(catalogue)/settings/reader/lookup-settings");

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  actions.get.mockReset().mockResolvedValue(defaultLookupSettings());
  actions.update.mockReset().mockImplementation(async (value) => ({ ok: true, settings: value ?? defaultLookupSettings() }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const wait = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));
const button = (name: string) => [...host.querySelectorAll("button")].find((item) =>
  item.textContent === name || item.getAttribute("aria-label") === name) as HTMLButtonElement;
const click = async (name: string) => { await act(async () => button(name).click()); await wait(); };
const type = async (label: string, value: string) => {
  const input = [...host.querySelectorAll("input")].find((item) =>
    host.querySelector(`label[for="${item.id}"]`)?.textContent === label) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const render = async () => { await act(async () => root.render(createElement(LookupSettingsGroup))); await wait(); };

it("puts Translate into first and lists the sources as rows, English included", async () => {
  await render();
  const text = host.textContent!;
  expect(text.indexOf("Translate into")).toBeLessThan(text.indexOf("Sites that open a word"));
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(text).toContain("Merriam-Webster");
  expect(text).toContain("English · merriam-webster.com");
  expect(host.querySelectorAll('button[data-tooltip="Edit"]')).toHaveLength(10);
});

it("edits one source in place and saves it on Done", async () => {
  await render();
  await click("Edit source Merriam-Webster");
  expect(host.querySelectorAll("input")).toHaveLength(2);
  await type("Name", "Webster");
  await click("Done");
  expect(actions.update).toHaveBeenCalledTimes(1);
  expect(actions.update.mock.calls[0][0].sources[0]).toMatchObject({ language: "en", name: "Webster" });
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(host.textContent).toContain("Webster");
});

it("keeps a new source open until it is valid, and Cancel takes it away unsaved", async () => {
  await render();
  await click("Add a source");
  await click("Done");
  expect(actions.update).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Give the source a name");
  expect(host.querySelectorAll("input")).toHaveLength(2);
  await click("Cancel");
  expect(actions.update).not.toHaveBeenCalled();
  expect(host.querySelectorAll("input")).toHaveLength(0);
  expect(host.querySelectorAll('button[data-tooltip="Edit"]')).toHaveLength(10);
  expect(host.textContent).not.toContain("Give the source a name");
});

// Main audit 2026-10-15: at 320px "logeion.uchicago.edu" broke as "uchicago.e / du"
it("lets a source's site wrap only after a dot", async () => {
  const { hostBreaks } = await import("@/app/(catalogue)/settings/reader/lookup-settings");
  const { renderToStaticMarkup } = await import("react-dom/server");
  expect(renderToStaticMarkup(createElement("p", null, hostBreaks("logeion.uchicago.edu"))))
    .toBe("<p>logeion.<wbr/>uchicago.<wbr/>edu</p>");
  expect(renderToStaticMarkup(createElement("p", null, hostBreaks("No address yet")))).toBe("<p>No address yet</p>");
});

it("renders the sources the page came with on the server, and keeps the rows when the server has the same (SLN-875)", async () => {
  const { renderToString } = await import("react-dom/server");
  const html = renderToString(createElement(LookupSettingsGroup, { initial: defaultLookupSettings() }));
  expect(html).not.toContain("Loading lookup settings");
  expect(html).toContain("Merriam-Webster");
  await act(async () => root.render(createElement(LookupSettingsGroup, { initial: defaultLookupSettings() }))); await wait();
  const first = host.querySelector('button[data-tooltip="Edit"]');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(actions.get).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll('button[data-tooltip="Edit"]')).toHaveLength(10);
  expect(host.querySelector('button[data-tooltip="Edit"]')).toBe(first);
  await click("Edit source Merriam-Webster");
  await type("Name", "Webster");
  await click("Done");
  expect(actions.update.mock.calls[0][0].sources[0]).toMatchObject({ language: "en", name: "Webster" });
});

it("shows the server's sources when the page came back by Back with an older copy (SLN-875)", async () => {
  const older = { ...defaultLookupSettings(), translateTo: "fr" };
  await act(async () => root.render(createElement(LookupSettingsGroup, { initial: older })));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(actions.get).toHaveBeenCalledTimes(1);
  expect(host.querySelector("button#lookup-translate-to")!.textContent).toContain("English");
});
