import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// ── A missing record answers 404 (SLN-546) ──────────────────────────────────
// A `loading.tsx` wraps its segment and everything below it in one Suspense
// boundary: the page streams, the status is sent with the first bytes, and a
// `notFound()` thrown after that shows the not-found view with status 200. A
// segment's `layout.tsx` renders outside its own loading boundary, so a page
// below a loading screen needs its layout to check the record and call
// `notFound()` first (0286, `src/lib/catalogue/record-exists.ts`).

const root = path.resolve(__dirname, "../../..");
const app = "src/app";

/** The page's own directory and every one above it, from the app root down */
function dirsOf(page: string): string[] {
  const parts = path.dirname(path.relative(app, page)).split(path.sep).filter((p) => p !== ".");
  return [app, ...parts.map((_, i) => path.join(app, ...parts.slice(0, i + 1)))];
}

/** The pages under a loading screen whose missing record would answer 200 */
function streamedNotFound(
  pages: string[],
  has: (file: string) => boolean,
  callsNotFound: (file: string) => boolean,
): string[] {
  return pages.filter((page) => {
    if (!callsNotFound(page)) return false;
    const dirs = dirsOf(page);
    const outermost = dirs.findIndex((d) => has(path.join(d, "loading.tsx")));
    if (outermost === -1) return false;
    // A layout at or above the outermost loading screen checks first
    const checked = dirs.slice(0, outermost + 1).some((d) => {
      const layout = path.join(d, "layout.tsx");
      return has(layout) && callsNotFound(layout);
    });
    return !checked;
  });
}

const pages = readdirSync(path.join(root, app), { recursive: true, encoding: "utf8" })
  .filter((f) => path.basename(f) === "page.tsx" && !f.startsWith(`api${path.sep}`))
  .map((f) => path.join(app, f));
const has = (file: string) => existsSync(path.join(root, file));
const callsNotFound = (file: string) => /\bnotFound\(\)/.test(readFileSync(path.join(root, file), "utf8"));

describe("missing records answer 404", () => {
  it("finds the detail pages that sit under a loading screen", () => {
    const streamed = pages.filter(
      (p) => callsNotFound(p) && dirsOf(p).some((d) => has(path.join(d, "loading.tsx"))),
    );
    for (const kind of ["films", "perfumes", "paintings", "organizations", "publishers"]) {
      expect(streamed).toContain(path.join(app, kind, "[slug]", "page.tsx"));
    }
  });

  it("every page under a loading screen has a layout that checks its record first", () => {
    expect(streamedNotFound(pages, has, callsNotFound)).toEqual([]);
  });

  it("flags a detail page whose check sits inside a loading screen", () => {
    const tree = new Map([
      // The perfume detail as it is: layout check, then its own loading screen
      ["src/app/perfumes/[slug]/layout.tsx", true],
      ["src/app/perfumes/[slug]/loading.tsx", false],
      ["src/app/perfumes/[slug]/page.tsx", true],
      // A list loading screen beside the list, outside a route group, covers the detail too
      ["src/app/films/loading.tsx", false],
      ["src/app/films/[slug]/layout.tsx", true],
      ["src/app/films/[slug]/page.tsx", true],
      // A detail loading screen with no layout check
      ["src/app/paintings/[slug]/loading.tsx", false],
      ["src/app/paintings/[slug]/page.tsx", true],
      // No loading screen: the page's own check answers 404
      ["src/app/library/[slug]/page.tsx", true],
    ]);
    const files = [...tree.keys()].filter((f) => f.endsWith("page.tsx"));
    expect(streamedNotFound(files, (f) => tree.has(f), (f) => !!tree.get(f))).toEqual([
      "src/app/films/[slug]/page.tsx",
      "src/app/paintings/[slug]/page.tsx",
    ]);
  });
});
