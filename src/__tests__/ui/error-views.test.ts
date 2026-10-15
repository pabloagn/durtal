// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const navigation = vi.hoisted(() => ({ pathname: "/films", refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ refresh: navigation.refresh }),
}));

import { act } from "react";
import { createRoot } from "react-dom/client";
import { DomainError, isRecordPath } from "@/components/domains/domain-states";

// Error views (SLN-700): a record that fails names the record and leads back
// to its list; every error view sets the tab's title and offers a shared
// Button (44px on touch) and a way back.
function render(props: Parameters<typeof DomainError>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(DomainError, props));
  return host;
}
const error = Object.assign(new Error("boom"), { digest: "x" });
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("DomainError", () => {
  it("names one film and leads back to the films", () => {
    quiet();
    const host = render({ kind: "film", error, reset: () => {}, record: true });
    expect(host.textContent).toContain("This film could not be loaded.");
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/films");
    expect(host.querySelector("a")!.textContent).toBe("Back to films");
    expect(host.querySelector("title")!.textContent).toBe("Something went wrong | Durtal");
    expect(host.querySelector("button")!.className).toContain("pointer-coarse:min-h-11");
  });

  it("keeps the collection's wording for a list", () => {
    quiet();
    const host = render({ kind: "painting", error, reset: () => {} });
    expect(host.textContent).toContain("Paintings could not be loaded.");
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/");
  });
});

describe("a record that fails in its layout", () => {
  // The record's layout checks it before the page, outside the record's own
  // error view: with the database unreachable the failure lands on the list's
  // view, which still names the record and leads back to its list
  it("names the record from the list's error view", () => {
    quiet();
    navigation.pathname = "/films/seed-film-1";
    const host = render({ kind: "film", error, reset: () => {} });
    expect(host.textContent).toContain("This film could not be loaded.");
    expect(host.querySelector("a")!.textContent).toBe("Back to films");
    navigation.pathname = "/films";
  });
  it("tells a record's address from a list or a page of its own", () => {
    expect(isRecordPath("/films", "/films/seed-film-1")).toBe(true);
    expect(isRecordPath("/library", "/library/against-nature")).toBe(true);
    for (const page of ["/films", "/films/", "/films/new", "/library/identify", "/library/import", "/films/a/b", "/filmsx/a", null])
      expect(isRecordPath(page?.startsWith("/library") ? "/library" : "/films", page)).toBe(false);
  });
});

describe("Try again", () => {
  // A page that failed on the server holds its error in its page data, so
  // clearing the error view alone draws the same error again
  it("fetches the page anew, then clears the error view", () => {
    quiet();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const reset = vi.fn();
    navigation.refresh.mockClear();
    act(() => root.render(createElement(DomainError, { kind: "film", error, reset })));
    act(() => host.querySelector("button")!.click());
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    host.remove();
  });
});

describe("error files", () => {
  const app = path.resolve(__dirname, "../../app/(catalogue)");
  it.each(["library", "films", "paintings", "perfumes"])("%s/[slug] has a record-level error view", (dir) => {
    const file = path.join(app, dir, "[slug]", "error.tsx");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/<DomainError kind="\w+" record/);
  });
  it.each(["error.tsx", "harmonize/error.tsx"])("%s uses the shared error view", (file) => {
    expect(readFileSync(path.join(app, file), "utf8")).toContain("<SectionError");
  });
});

// A not-found view's way back is its only action: it takes the secondary
// button look, so it never reads as plain text (main audit, 15 Oct)
describe("not-found files", () => {
  const app = path.resolve(__dirname, "../../app/(catalogue)");
  it.each(["", "library", "people", "films", "paintings", "perfumes", "publishers", "organizations"])(
    "%s/not-found.tsx leads back with a secondary button",
    (dir) => {
      const source = readFileSync(path.join(app, dir, "not-found.tsx"), "utf8");
      expect(source).toContain('className={buttonClass("secondary")}');
      expect(source).not.toContain('buttonClass("ghost")');
    },
  );
});
