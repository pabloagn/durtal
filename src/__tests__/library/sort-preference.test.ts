import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { LIBRARY_SORT_COOKIE, parseLibrarySortPreference } from "@/lib/library/sort-preference";

const saved = encodeURIComponent(JSON.stringify({ sort: "recent", order: "asc" }));
const request = (path: string, cookie = `${LIBRARY_SORT_COOKIE}=${saved}`) =>
  new NextRequest(`http://localhost:3100${path}`, { headers: { cookie } });
const restored = (path: string, cookie?: string) => {
  const location = proxy(request(path, cookie))?.headers.get("location");
  return location ? new URL(location).searchParams : undefined;
};

describe("remembering the books ordering", () => {
  it("restores the field and direction before rendering a bare Books URL", () => {
    const params = restored("/library");
    expect(params?.get("sort")).toBe("recent");
    expect(params?.get("order")).toBe("asc");
  });

  it("preserves search, filters, pagination and an explicit direction", () => {
    const params = restored("/library?q=foo&holding=owned&page=2&perPage=24&order=desc");
    expect(Object.fromEntries(params!)).toEqual({
      q: "foo", holding: "owned", page: "2", perPage: "24", sort: "recent", order: "desc",
    });
  });

  it("restores page size and ordering together, without a redirect loop", () => {
    const cookie = `${LIBRARY_SORT_COOKIE}=${saved}; durtal-per-page_library=96`;
    const params = restored("/library", cookie)!;
    expect(params.get("perPage")).toBe("96");
    expect(params.get("sort")).toBe("recent");
    expect(proxy(request(`/library?${params}`, cookie))).toBeUndefined();
  });

  it("honours explicit sort links without changing the saved selection", () => {
    expect(restored("/library?sort=title")).toBeUndefined();
    expect(restored("/library?sort=year&order=desc")).toBeUndefined();
  });

  it("does not apply the books ordering to other pages or API calls", () => {
    expect(restored("/people")).toBeUndefined();
    expect(restored("/library/new")).toBeUndefined();
    expect(restored("/api/works")).toBeUndefined();
  });

  it.each([undefined, "null", "{}", "garbage", "%", '{"sort":"removed","order":"asc"}', '{"sort":"title","order":"invalid"}'])(
    "ignores an invalid saved selection: %s", (raw) => {
      expect(parseLibrarySortPreference(raw)).toBeUndefined();
    },
  );
});
