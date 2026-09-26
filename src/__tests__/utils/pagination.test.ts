import { describe, expect, it } from "vitest";
import {
  getPageRange,
  lastPage,
  paginateItems,
  pageHref,
  parsePagination,
  toSearchParams,
} from "@/lib/utils/pagination";
import {
  clearedListHref,
  firstPageHref,
  hasListQuery,
} from "@/lib/utils/list-params";

describe("pagination input safety", () => {
  it.each([
    "0",
    "-2",
    "abc",
    "1.5",
    "Infinity",
    "99999999999999999999",
    "1000000000",
    "",
    "2oops",
  ])("rejects unsafe page %s before calculating SQL offset", (page) => {
    expect(parsePagination({ page })).toEqual({
      page: 1,
      perPage: 48,
      offset: 0,
    });
  });
  it.each(["7", "0", "-24", "24.5", "abc"])(
    "uses the default for bad perPage %s",
    (perPage) => {
      expect(parsePagination({ page: "2", perPage })).toEqual({
        page: 2,
        perPage: 48,
        offset: 48,
      });
    },
  );
  it.each([24, 48, 96, 192])("supports page size %s", (perPage) => {
    expect(
      parsePagination({ page: "3", perPage: String(perPage) }).offset,
    ).toBe(perPage * 2);
  });
  it("supports caller defaults and allowed values", () => {
    expect(parsePagination({}, { defaultPerPage: 24 }).perPage).toBe(24);
    expect(
      parsePagination(
        { perPage: "10" },
        { defaultPerPage: 10, allowedPerPage: [10, 20] },
      ).perPage,
    ).toBe(10);
  });
  it("handles framework search-param proxies with bound Object methods", () => {
    const params = new Proxy(
      { page: "3", perPage: "24" },
      {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      },
    );
    expect(parsePagination(params)).toEqual({
      page: 3,
      perPage: 24,
      offset: 48,
    });
  });
  it("accepts URLSearchParams and record arrays", () => {
    expect(parsePagination(new URLSearchParams("page=3&perPage=24"))).toEqual({
      page: 3,
      perPage: 24,
      offset: 48,
    });
    expect(
      toSearchParams({ filter: ["a", "b"], missing: undefined }).getAll(
        "filter",
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("page links and filtering", () => {
  it("retains every parameter, including new filters, repeated parameters and accents", () => {
    const original = new URLSearchParams(
      "q=Borgès&publisher=pub&rare=true&sort=year&order=desc&new=a&new=b&page=2&perPage=96",
    );
    const result = new URL(
      pageHref("/library", original, 3),
      "https://durtal.test",
    );
    expect(result.searchParams.get("page")).toBe("3");
    for (const key of original.keys())
      if (key !== "page")
        expect(result.searchParams.getAll(key)).toEqual(original.getAll(key));
    expect(original.get("page")).toBe("2");
  });
  it("resets to page one without losing filters when changing size", () => {
    expect(pageHref("/authors", { nationality: "HU", page: "8" }, 1, 192)).toBe(
      "/authors?nationality=HU&perPage=192",
    );
    expect(
      firstPageHref("/authors", new URLSearchParams("q=Lem&page=9&perPage=96")),
    ).toBe("/authors?q=Lem&perPage=96");
  });
  it("does not mistake page size for a filter and retains it on clearing", () => {
    expect(hasListQuery(new URLSearchParams("perPage=96&page=2"))).toBe(false);
    expect(
      clearedListHref(
        "/authors",
        new URLSearchParams("q=Lem&page=9&perPage=96"),
      ),
    ).toBe("/authors?perPage=96");
  });
});

describe("page ranges", () => {
  it.each([
    [1, 1, [1]],
    [1, 2, [1, 2]],
    [1, 44, [1, 2, 3, "ellipsis", 44]],
    [6, 44, [1, "ellipsis", 4, 5, 6, 7, 8, "ellipsis", 44]],
    [44, 44, [1, "ellipsis", 42, 43, 44]],
    [4, 7, [1, 2, 3, 4, 5, 6, 7]],
    [500, 1000, [1, "ellipsis", 498, 499, 500, 501, 502, "ellipsis", 1000]],
  ])("builds current %s of %s", (page, total, expected) =>
    expect(getPageRange(page, total)).toEqual(expected),
  );
  it("clamps collection pages including empty lists", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(paginateItems(items, { page: "999", perPage: "24" })).toEqual({
      page: 3,
      perPage: 24,
      total: 50,
      items: [48, 49],
    });
    expect(paginateItems([], { page: "999" })).toEqual({
      page: 1,
      perPage: 48,
      total: 0,
      items: [],
    });
    expect(lastPage(0, 48)).toBe(1);
  });
});
