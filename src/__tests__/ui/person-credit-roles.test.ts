import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonWorkCredit } from "@/lib/actions/authors";

// A person's page, rendered with its data mocked. Design polish 2: each role
// is a line that names its count ("Author · 2 books"). SLN-793: the roles
// keep one order, Author first, whatever the titles.
const { data, card, stub } = vi.hoisted(() => ({
  data: { credits: [] as PersonWorkCredit[] },
  card: (kind: string) => async (ids: string[]) => ids.map((id) => ({ id, kind })),
  stub: (name: string) => ({ [name]: () => null }),
}));

vi.mock("@/lib/actions/authors", () => ({
  getAuthorBySlug: async (slug: string) => ({
    id: "00000000-0000-4000-8000-000000000001", slug, name: "Ana Example", workAuthors: [], editionContributors: [], media: [],
    isFavourite: false, country: null,
  }),
  getPersonWorkCredits: async () => data.credits,
}));
vi.mock("@/lib/actions/reading-notes", () => ({ getPersonNoteCounts: async () => ({ quotes: 0, notes: 0, translatedQuotes: 0, translatedNotes: 0 }) }));
vi.mock("@/lib/ebooks/review-queue/suggestions", () => ({ getAuthorEbookSuggestionCount: async () => 0 }));
vi.mock("@/lib/ebooks/catalogue-availability", () => ({ catalogueAvailability: async () => new Map() }));
vi.mock("@/lib/catalogue/film-store", () => ({ loadFilmCards: card("film") }));
vi.mock("@/lib/catalogue/perfume-store", () => ({ loadPerfumeCards: card("perfume") }));
vi.mock("@/lib/catalogue/painting-store", () => ({ loadPaintingCards: card("painting") }));
vi.mock("@/components/films/film-card", () => ({ FilmCard: ({ film }: { film: { id: string } }) => createElement("div", { "data-card": film.id }) }));
vi.mock("@/components/perfumes/perfume-card", () => stub("PerfumeCard"));
vi.mock("@/components/paintings/painting-card", () => stub("PaintingCard"));
vi.mock("@/components/books/book-card", () => stub("BookCard"));
vi.mock("../../app/(catalogue)/people/[slug]/author-detail-header", () => stub("AuthorDetailHeader"));
vi.mock("@/components/activity/activity-timeline", () => stub("ActivityTimeline"));
// The page starts the gallery's reads early (#393)
vi.mock("@/components/shared/gallery-section", () => ({ ...stub("GallerySection"), preloadGallery: () => {} }));
vi.mock("@/components/shortcuts/copy-shortcuts", () => stub("CopyShortcuts"));
vi.mock("@/components/ebooks/ebook-suggestion-line", () => stub("EbookSuggestionLine"));
vi.mock("@/components/reading/reading-tab-switch", () => stub("ReadingTabSwitch"));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/shared/prose", () => stub("Prose"));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));

import AuthorDetailPage from "@/app/(catalogue)/people/[slug]/page";

const credit = (kind: PersonWorkCredit["kind"], roleId: string, role: string, workId: string, title: string): PersonWorkCredit =>
  ({ kind, roleId, role, workId, title, slug: null });

async function render(credits: PersonWorkCredit[]) {
  data.credits = credits;
  const page = await AuthorDetailPage({ params: Promise.resolve({ slug: "ana-example" }), searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(page);
  const lines = [...html.matchAll(/<span[^>]*data-person-credit=""[^>]*>([^<]*)<\/span>/g)].map((m) => m[1].replaceAll("&#x27;", "'"));
  return { html, lines };
}

describe("a person's credits", () => {
  it("lists Author first when the first title is a translation", async () => {
    // Credits arrive in title order: "A Season in Hell" (translated) before "Zone" (written)
    const { lines } = await render([
      credit("book", "book.edition.translator", "Translator", "w1", "A Season in Hell"),
      credit("book", "book.edition.editor", "Editor", "w2", "Barnabooth"),
      credit("book", "book.author", "Author", "w3", "Zone"),
      credit("book", "book.author", "Author", "w4", "Zuleika"),
    ]);
    expect(lines).toEqual(["Author · 2 books", "Translator · 1 book", "Editor · 1 book"]);
  });

  it("keeps one fixed order for films, in the summary and under each card", async () => {
    const { lines, html } = await render([
      credit("film", "film.cast", "Cast", "f1", "Alphaville"),
      credit("film", "film.screenwriter", "Screenwriter", "f1", "Alphaville"),
      credit("film", "film.director", "Director", "f1", "Alphaville"),
      credit("film", "film.director", "Director", "f2", "Weekend"),
    ]);
    expect(lines).toEqual(["Director · 2 films", "Screenwriter · 1 film", "Cast · 1 film"]);
    expect(html).toMatch(/data-card="f1"><\/div><p[^>]*>Director, Screenwriter, Cast<\/p>/);
  });

  it("puts a role added later after the seeded ones, by its label", async () => {
    const { lines } = await render([
      credit("book", "book.custom.blurb", "Blurb", "w1", "Aurora"),
      credit("book", "book.edition.other", "Other", "w2", "Bruges"),
      credit("book", "book.author", "Author", "w3", "Cities"),
    ]);
    expect(lines).toEqual(["Author · 1 book", "Other · 1 book", "Blurb · 1 book"]);
  });
});
