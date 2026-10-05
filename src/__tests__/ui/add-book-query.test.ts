// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The add-a-book page opened from the reading book picker (SLN-448): the
// query or ISBN fills the search and runs it.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }));
const none = vi.hoisted(() => async () => []);
vi.mock("@/lib/actions/works", () => ({ findDuplicateWork: vi.fn(async () => null) }));
vi.mock("@/lib/actions/wizard", () => ({ createBookFromWizard: vi.fn(), isIsbnInUse: vi.fn(async () => ({ inUse: false })) }));
vi.mock("@/lib/actions/fast-track", () => ({ fastTrackBook: vi.fn() }));
vi.mock("@/lib/actions/recommenders", () => ({ getRecommenders: vi.fn(none) }));
vi.mock("@/lib/actions/locations", () => ({ getLocations: vi.fn(none) }));
vi.mock("@/lib/actions/collections", () => ({ getCollections: vi.fn(none) }));
vi.mock("@/lib/actions/taxonomy", () => new Proxy({}, { get: (_, key) => (key === "then" ? undefined : vi.fn(none)) }));

import { AddBookWizard } from "@/app/library/new/wizard";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ results: [], notices: [] }) }));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = (ms = 400) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const searchField = () => host.querySelector('input[placeholder^="Search by title"]') as HTMLInputElement;

describe("AddBookWizard from the book picker", () => {
  it("fills its search with the query and runs it", async () => {
    act(() => root.render(createElement(AddBookWizard, { initialQuery: "Le Temps retrouvé", then: "start" })));
    expect(searchField().value).toBe("Le Temps retrouvé");
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(`/api/search?q=${encodeURIComponent("Le Temps retrouvé")}`, expect.anything());
  });

  it("searches an ISBN by ISBN", async () => {
    act(() => root.render(createElement(AddBookWizard, { initialIsbn: "9780141187761", then: "past" })));
    expect(searchField().value).toBe("9780141187761");
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/api/search?isbn=9780141187761", expect.anything());
  });

  it("searches nothing without a query", async () => {
    act(() => root.render(createElement(AddBookWizard)));
    expect(searchField().value).toBe("");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
