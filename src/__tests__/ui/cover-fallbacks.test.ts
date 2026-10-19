import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverThumb } from "@/components/books/cover-thumb";
import { CoverFan, Monogram } from "@/components/shared/no-photo";

// SLN-1066: rows, pickers and queues showed a "No cover" box, no box at all,
// the browser's broken-image mark or a hand-made `title[0]` where every card
// shows the title's letter in the 2:3 box, and people got one letter where
// their cards show initials.

const root = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.resolve(root, file), "utf8");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("cover fallbacks", () => {
  it("leave no hand-made letter in rendering code", () => {
    const found = [...tsxFiles(path.join(root, "app")), ...tsxFiles(path.join(root, "components"))].flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (/\b(title|name)\??\.?\[0\]/.test(line) ? [`${path.relative(root, file)}:${i + 1}`] : [])),
    );
    expect(found).toEqual([]);
  });

  it("show the title's letter in the box when there is no cover, and when it fails", () => {
    const none = renderToStaticMarkup(createElement(CoverThumb, { src: null, title: "« à rebours »" }));
    expect(none).toContain("aspect-[2/3]");
    expect(none).toContain(">À</span>");
    expect(none).not.toContain("<img");
    const cover = renderToStaticMarkup(createElement(CoverThumb, { src: "/cover.jpg", title: "Là-bas", className: "h-10 w-7" }));
    expect(cover).toContain('src="/cover.jpg"');
    expect(cover).toContain("h-10 w-7");
  });

  it.each([
    "components/books/identify-queue.tsx",
    "components/books/match-again-dialog.tsx",
    "components/collections/add-books-dialog.tsx",
    "components/ebooks/review-row.tsx",
    "components/ebooks/differences-section.tsx",
    "components/reading/book-picker.tsx",
    "app/(catalogue)/library/new/steps/search-step.tsx",
    "app/(catalogue)/library/new/steps/confirm-step.tsx",
    "app/(catalogue)/provenance/order-create-steps.tsx",
    "app/(catalogue)/provenance/order-detail-panel.tsx",
    "app/(catalogue)/provenance/pipeline.tsx",
    "app/(catalogue)/provenance/provenance-shell.tsx",
    "app/(catalogue)/harmonize/workspace.tsx",
    "app/(catalogue)/people/[slug]/page.tsx",
  ])("%s keeps a cover's box", (file) => {
    const code = source(file);
    expect(code).toContain("<CoverThumb");
    expect(code).not.toMatch(/<img\b|<Image\b|No cover/);
  });

  it("give a failed image the same fallback as none", () => {
    expect(source("app/(catalogue)/library/new/steps/duplicate-step.tsx")).toMatch(/fallback=\{<span className=\{`\$\{COVER_BLANK\} h-full w-full`\}><CoverLetter/);
    expect(source("components/ebooks/ebook-link-panel.tsx")).toContain("fallback={blank}");
    for (const file of ["components/timeline/author-timeline.tsx", "components/timeline/author-timeline-row.tsx", "components/authors/authors-map.tsx"]) {
      expect(source(file), file).toContain("fallback={<Monogram name=");
      expect(source(file), file).not.toContain("<img");
    }
  });

  it("drop a failed cover from a fan, and show the initials or letter when none is left", () => {
    expect(renderToStaticMarkup(createElement(CoverFan, { covers: [], fallback: createElement(Monogram, { name: "Rachilde" }) }))).toContain(">R</span>");
    expect(source("components/shared/cover-fan.tsx")).toContain("onError={() => setFailed(");
    for (const file of ["components/authors/author-card.tsx", "components/people/recent-people-grid.tsx", "app/(catalogue)/people/authors-shell.tsx"]) {
      expect(source(file), file).toMatch(/<CoverFan covers=\{[^}]+\} fallback=\{<Monogram name=/);
    }
    expect(source("components/collections/collections-view.tsx")).toMatch(/<CoverFan covers=\{.*\} fallback=\{<span className=\{`absolute inset-0 \$\{COVER_BLANK\}`\}><CoverLetter/);
  });

  it.each([
    "components/authors/author-list-item.tsx",
    "app/(catalogue)/people/authors-shell.tsx",
    "components/recommenders/recommender-card.tsx",
    "components/timeline/author-timeline.tsx",
    "components/timeline/author-timeline-row.tsx",
  ])("%s gives a person initials", (file) => {
    expect(source(file)).toContain("<Monogram name=");
  });

  it("sizes the initials to their frame: 12px in a row, 21px from 40px, 46px on a card", () => {
    const html = renderToStaticMarkup(createElement(Monogram, { name: "Joris-Karl Huysmans" }));
    expect(html).toContain(">JH</span>");
    expect(html).toContain("@container/monogram");
    expect(html).toMatch(/text-micro[^"]*text-fg-primary[^"]*@\[40px\]\/monogram:text-lg @\[120px\]\/monogram:text-4xl @\[120px\]\/monogram:text-fg-secondary/);
  });
});
