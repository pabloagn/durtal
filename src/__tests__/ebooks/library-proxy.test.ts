import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
describe("ebook detail addresses", () => {
  // The page's own not-found view answers them, with Back to eBooks (SLN-864)
  it.each(["bad", "bad.id", "123", "not-a-uuid", "offline-copy"])(
    "leaves the mistyped address %s to the page",
    (id) => {
      const response = proxy(new NextRequest(`http://localhost/ebooks/${id}`));
      expect(response?.status).not.toBe(400);
      expect(response?.headers.get("content-type") ?? "").not.toContain("text/plain");
    },
  );
  it.each(["runs", "review", "highlights", "upload", "offline"])(
    "preserves the static %s route",
    (name) => {
      expect(
        proxy(new NextRequest(`http://localhost/ebooks/${name}`))?.status,
      ).not.toBe(400);
    },
  );
  it("lets valid detail ids and the library pass through", () => {
    expect(
      proxy(
        new NextRequest(
          "http://localhost/ebooks/5fbb1291-cccb-4e84-b5ca-3f27634bc580",
        ),
      )?.status,
    ).not.toBe(400);
    expect(proxy(new NextRequest("http://localhost/ebooks"))?.status).not.toBe(
      400,
    );
  });
});
