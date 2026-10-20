// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import path from "path";

// SLN-1184 (empty-library survey, items 4 and 9): an empty catalogue's
// dashboard is one state with a purpose sentence, one Add book and quiet links
// to the other collections, not ten zeros; Statistics says what it counts.

import { EmptyCatalogue } from "@/components/domains/empty-catalogue";
import { NoOwnedBooks } from "@/components/statistics/no-owned-books";
import { NO_OWNED_BOOKS, libraryTile } from "@/lib/statistics/tiles";

const render = (node: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
const source = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

describe("the empty dashboard", () => {
  it("says what the library is for, with one Add book and a link to add each other collection", () => {
    const page = render(createElement(EmptyCatalogue));
    expect(page.querySelector("h2")?.textContent).toBe("Nothing catalogued yet");
    expect(page.body.textContent).toContain("Durtal keeps one record of every book you own, read or want");
    const links = [...page.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Add book", "/library/new"],
      ["perfume", "/perfumes/new"],
      ["film", "/films/new"],
      ["painting", "/paintings/new"],
    ]);
    expect(page.querySelector("p:last-child")?.textContent).toBe("Or add a perfume, a film or a painting.");
  });

  it("replaces the index and the sections, and the header's Add gives way to its own", () => {
    const page = source("app/(catalogue)/page.tsx");
    const content = page.slice(page.indexOf("async function DashboardContent"));
    // Read beside the other reads, not before them
    expect(content).toMatch(/await Promise\.all\(\[\s*catalogueIsEmpty\(\),/);
    expect(content.indexOf("if (empty) return <EmptyCatalogue />;")).toBeLessThan(content.indexOf("<LibraryIndex"));
    expect(page).toContain("(await catalogueIsEmpty()) ? null : <DomainAddLink kind=\"book\" size=\"md\" />");
    expect(page).toMatch(/<Suspense fallback=\{<DomainAddLink kind="book" size="md" \/>\}>\s*<HeaderAdd \/>/);
  });
});

describe("Statistics before a book is owned", () => {
  it("says what it counts on the dashboard and on its page, with Add book where the header has none", () => {
    const block = render(createElement(NoOwnedBooks, { heading: "h3" }));
    expect(block.querySelector("h3")?.textContent).toBe(NO_OWNED_BOOKS.title);
    expect(block.body.textContent).toContain("These numbers count the books you own: those with a copy in one of your locations.");
    // The dashboard's header has Add book already: one Add a page
    expect(block.querySelector("a")).toBeNull();
    const page = render(createElement(NoOwnedBooks, { heading: "h2" }));
    expect(page.querySelector("h2")?.textContent).toBe(NO_OWNED_BOOKS.title);
    expect(page.querySelector("a")?.getAttribute("href")).toBe("/library/new");
    expect(source("components/statistics/dashboard-statistics.tsx")).toContain('<NoOwnedBooks heading="h3" />');
    expect(source("app/(catalogue)/statistics/page.tsx")).toContain('<NoOwnedBooks heading="h2" />');
  });

  it("reads a tile the same way in both", () => {
    const numbers = { books: 1, editions: 1, copies: 1, pages: 1450, authors: 1, publishers: 0, languages: 1, countries: 0 };
    expect(libraryTile("pages", numbers)).toEqual({ label: "Pages", value: "1,450" });
    expect(libraryTile("pages", numbers, "Pages on your shelves")).toEqual({ label: "Pages on your shelves", value: "1,450" });
    expect(libraryTile("pages", { ...numbers, pages: 0 })).toEqual({ label: "No page counts yet", value: "—" });
    expect(libraryTile("countries", numbers)).toEqual({ label: "Authors' countries", value: "0" });
  });
});
