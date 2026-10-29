// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Review of #408: a blank cover shows the title's first letter or digit, and
// none for a title with neither ("!!!"), which left the cover's link with no
// name. SLN-841: a blank cover's link is named by the title, as hidden text,
// and every cover link keeps its marks in its name (no aria-label).

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/library" }));

import { BookCard } from "@/components/books/book-card";
import { MARKS } from "@/lib/constants/marks";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** What a screen reader names a link by, here: its text and image alts and
 * labels, leaving out what is aria-hidden; `aria-label` replaces it all */
function linkName(link: HTMLElement) {
  if (link.hasAttribute("aria-label")) return link.getAttribute("aria-label")!;
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return void parts.push(node.textContent ?? "");
    if (!(node instanceof HTMLElement) || (node.hasAttribute("aria-hidden") && node.getAttribute("aria-hidden") !== "false")) return;
    if (node.hasAttribute("aria-label")) return void parts.push(` ${node.getAttribute("aria-label")} `);
    if (node instanceof HTMLImageElement) return void parts.push(` ${node.alt} `);
    node.childNodes.forEach(walk);
  };
  link.childNodes.forEach(walk);
  return parts.join("").replace(/\s+/g, " ").trim();
}

const card = (props: Record<string, unknown>) =>
  act(() => root.render(createElement(BookCard, { workId: "w1", slug: "w1", authorName: "A. Writer", instanceCount: 0, catalogueStatus: "tracked", acquisitionPriority: "none", rating: null, ebook: null, title: "", ...props })));
const coverLink = () => host.querySelector<HTMLAnchorElement>('a[href="/library/w1"]:not([tabindex="-1"])')!;

it.each(["!!!", "«Quoted»", "1984"])("names a blank cover's link by its title: %s", (title) => {
  card({ title });
  expect(linkName(coverLink())).toBe(title);
});

// The link has no label, so the cover's marks stay in its name
it("keeps the cover's marks in its link's name, with a cover and without", () => {
  card({ title: "!!!", isRare: true });
  expect(coverLink().hasAttribute("aria-label")).toBe(false);
  expect(linkName(coverLink())).toBe(`!!! ${MARKS.rare.label}`);
  card({ title: "Against Nature", isRare: true, coverUrl: "/api/media?key=c.jpg" });
  expect(coverLink().hasAttribute("aria-label")).toBe(false);
  expect(linkName(coverLink())).toBe(`Against Nature ${MARKS.rare.label}`);
});


it("falls back to the cover letter after at most two failed requests", () => {
  vi.useFakeTimers();
  try {
    card({ title: "Missing cover", coverUrl: "/api/s3/read?key=missing.webp" });
    expect(host.querySelectorAll("img")).toHaveLength(1);
    act(() => { host.querySelector("img")!.dispatchEvent(new Event("error")); vi.advanceTimersByTime(500); });
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(host.querySelector("img")!.getAttribute("src")).toContain("_r=1");
    act(() => { host.querySelector("img")!.dispatchEvent(new Event("error")); vi.advanceTimersByTime(1000); });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".cover-letter")?.textContent).toBe("M");
    act(() => vi.advanceTimersByTime(10000));
    expect(host.querySelector("img")).toBeNull();
  } finally { vi.useRealTimers(); }
});
