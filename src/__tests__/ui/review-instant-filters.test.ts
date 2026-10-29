// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ replace: vi.fn(), search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace }), useSearchParams: () => nav.search }));
vi.mock("@/components/ui/select", async () => {
  const { createElement } = await import("react");
  return { Select: ({ name, value, options, onChange, label }: {
    name: string; value: string; options: { value: string; label: string }[];
    onChange: (event: unknown) => void; label: string;
  }) => createElement("label", null, label, createElement("select", { name, value, onChange },
    options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)))) };
});
import { InstantReviewFilters } from "@/app/(catalogue)/ebooks/review/instant-review-filters";
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); nav.replace.mockReset();
  nav.search = new URLSearchParams("q=Nadja&language=fr&page=5000&section=likely&work=abc&run=xyz");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(InstantReviewFilters, { languages: ["fr", "en"] })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const latest = () => new URL(nav.replace.mock.calls.at(-1)![0], "https://durtal.test").searchParams;
async function select(name: string, value: string) {
  const field = host.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
  await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function type(value: string) {
  const field = host.querySelector("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true })); });
}
describe("instant review filters", () => {
  it("offers queue languages and readable formats with no Apply button", () => {
    expect([...host.querySelectorAll('select[name=language] option')].map((n) => n.textContent)).toEqual(["All languages", "English", "French"]);
    const labels = [...host.querySelectorAll('select[name=format] option')].map((n) => n.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Kobo EPUB", "DjVu", "Text", "Word", "Other"]));
    expect([...host.querySelectorAll("button")].some((n) => n.textContent?.includes("Apply"))).toBe(false);
  });
  it("applies rapid choices without losing the earlier choice or queue scope", async () => {
    await select("language", "en"); await select("format", "txt");
    expect(Object.fromEntries(latest())).toEqual({ q: "Nadja", language: "en", section: "likely", work: "abc", run: "xyz", format: "txt" });
  });
  it("debounces search and preserves the other filters", async () => {
    await type("Pale Fire"); expect(nav.replace).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(151); });
    expect(latest().get("q")).toBe("Pale Fire"); expect(latest().get("language")).toBe("fr"); expect(latest().has("page")).toBe(false);
  });
  it("clears choices while retaining a just-typed search and the scope", async () => {
    await type("Watt");
    const clear = [...host.querySelectorAll("button")].find((n) => n.textContent === "Clear all")!;
    await act(async () => clear.click());
    expect(Object.fromEntries(latest())).toEqual({ q: "Watt", section: "likely", work: "abc", run: "xyz" });
    await act(async () => { vi.advanceTimersByTime(200); }); expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});
