// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { perPageCookieName } from "@/lib/utils/preference-cookies";

const route = vi.hoisted(() => ({ query: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: route.push }), useSearchParams: () => new URLSearchParams(route.query) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/lib/hooks/use-preference", () => ({ usePreference: () => [4, () => {}], useViewModePreference: () => ["grid", () => {}] }));
vi.mock("@/components/shared/pagination", () => ({ Pagination: () => null }));
vi.mock("@/components/ebooks/ebook-card", () => ({ EbookCard: () => null }));
vi.mock("@/components/ebooks/ebook-row", () => ({ EbookRow: () => null }));
vi.mock("../../app/(catalogue)/ebooks/ebooks-filters", () => ({ EbooksFilters: () => null }));
import { EbooksView } from "../../app/(catalogue)/ebooks/ebooks-view";

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root, host: HTMLElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const counts = { total: 0, active: 5999, excluded: 1, review: 3199, formats: ["epub"], languages: ["en"] };
function request(href: string) {
  const req = new NextRequest(new URL(href, "http://127.0.0.1:3410").href, { method: "GET" });
  req.cookies.set(perPageCookieName("/ebooks"), "48");
  expect(req.method).toBe("GET");
  expect(req.cookies.get(perPageCookieName("/ebooks"))?.value).toBe("48");
  return req;
}

describe("empty eBook search Clear transition", () => {
  it("negative mechanism control: bare Clear target triggers the actual page-size proxy redirect", () => {
    const response = proxy(request("/ebooks")); expect(response?.status).toBe(307);
    const redirected = new URL(response!.headers.get("location")!);
    expect(redirected.pathname).toBe("/ebooks"); expect(redirected.searchParams.get("perPage")).toBe("48"); expect(redirected.searchParams.has("q")).toBe(false);
  });
  it("the proxy preserves a requested query when restoring page size", () => {
    const response = proxy(request("/ebooks?q=Seed+Library+Book"));
    expect(new URL(response!.headers.get("location")!).searchParams.get("q")).toBe("Seed Library Book");
  });
  it.each([["active", 48], ["excluded", 48], ["active", 24]] as const)(
    "clears %s at displayed size %i directly, without a preference redirect",
    (state, size) => {
      route.query = `q=SLN495+absence+sentinel&perPage=${size}&page=3&sort=author&order=desc&linked=linked&format=epub&language=en${state === "excluded" ? "&state=excluded" : ""}`;
      act(() => root.render(createElement(EbooksView, { books: [], counts, page: 1, perPage: size })));
      const link = [...host.querySelectorAll("a")].find(node => node.textContent === "Clear search and filters")!;
      const href = link.getAttribute("href")!;
      const url = new URL(href, "http://127.0.0.1:3410");
      expect(url.pathname).toBe("/ebooks"); expect(url.searchParams.get("perPage")).toBe(String(size));
      expect(url.searchParams.get("state")).toBe(state === "excluded" ? "excluded" : null);
      expect(url.searchParams.get("sort")).toBe("author"); expect(url.searchParams.get("order")).toBe("desc");
      for (const name of ["q", "page", "linked", "format", "language"]) expect(url.searchParams.has(name)).toBe(false);
      expect(proxy(request(href))?.headers.get("location") ?? null).toBeNull();
    },
  );
});
