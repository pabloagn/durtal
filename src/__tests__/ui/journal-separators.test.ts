// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

// The wording survey, section 6: a journal row's line wrapped at 390px so a
// line started with "·". Each separator stays with the item before it.

vi.mock("@/components/reading/hub-actions", () => ({ JournalRowMenu: () => null, LogButton: () => null }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) }));

import { JournalRows } from "@/components/reading/reading-tiles";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));

describe("a journal row's line", () => {
  it("keeps each \"·\" with the item before it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const row = {
      reading: { readingId: "r1" },
      title: "Stats",
      href: "/library/stats",
      cover: null,
      line: "Author 117 · Nov 2024 to 27 Nov 2024 · Finished",
      format: "print",
      translated: null,
      rating: null,
    };
    act(() => root!.render(h(JournalRows, { rows: [row] as never })));
    const line = host.querySelector("li p")!.textContent!;
    expect(line).toBe("Author 117 · Nov 2024 to 27 Nov 2024 · Finished");
  });

  it("links the first author to their page, the dot kept with the name (SLN-1075)", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const row = {
      reading: { readingId: "r1" },
      title: "Stats",
      href: "/library/stats",
      cover: null,
      author: { name: "Author 117", href: "/people/author-117" },
      line: "Nov 2024 to 27 Nov 2024 · Finished",
      format: "print",
      translated: null,
      rating: null,
    };
    act(() => root!.render(h(JournalRows, { rows: [row] as never })));
    const line = host.querySelector("li p")!;
    expect(line.textContent).toBe("Author 117 · Nov 2024 to 27 Nov 2024 · Finished");
    expect(line.querySelector("a")!.getAttribute("href")).toBe("/people/author-117");
    expect(host.querySelector("li")!.hasAttribute("data-focus-row")).toBe(true);
  });
});
