// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const navigation = vi.hoisted(() => ({ pathname: "/publishers", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("@/lib/hooks/use-preference", () => ({ usePreference: () => [4, () => {}], useViewModePreference: () => ["grid", () => {}] }));
vi.mock("@/components/shared/pagination", () => ({ Pagination: () => null }));
vi.mock("@/components/layout/minimal-root", () => ({ MinimalRoot: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/ebooks/ebook-card", () => ({ EbookCard: () => null }));
vi.mock("@/components/ebooks/ebook-row", () => ({ EbookRow: () => null }));
vi.mock("../../app/(catalogue)/ebooks/ebooks-filters", () => ({ EbooksFilters: () => null }));
vi.mock("@/lib/actions/harmonization", () => ({
  scanLibrary: vi.fn(), applyFindingFixes: vi.fn(), dismissFinding: vi.fn(), getHarmonizationOperation: vi.fn(),
  getMergePreview: vi.fn(), mergeRecords: vi.fn(), restoreFinding: vi.fn(),
}));

import PersonLoading from "../../app/(catalogue)/people/[slug]/loading";
import EbookLoading from "../../app/(catalogue)/ebooks/[ebookId]/loading";
import HarmonizeLoading from "../../app/(catalogue)/harmonize/loading";
import PublishersError from "../../app/(catalogue)/publishers/error";
import EbooksError from "../../app/(catalogue)/ebooks/error";
import CollectionsError from "../../app/(catalogue)/collections/error";
import ReadingError from "../../app/(catalogue)/reading/error";
import SeriesError from "../../app/(catalogue)/series/error";
import SettingsError from "../../app/(catalogue)/settings/error";
import ReaderError from "../../app/reader/error";
import GlobalError from "../../app/global-error";
import PlacesError from "../../app/(catalogue)/places/error";
import OrganizationsError from "../../app/(catalogue)/organizations/error";
import RecommendersError from "../../app/(catalogue)/recommenders/error";
import TaxonomyError from "../../app/(catalogue)/taxonomy/error";
import LocationsError from "../../app/(catalogue)/locations/error";
import { EbooksView } from "../../app/(catalogue)/ebooks/ebooks-view";
import { HarmonizeWorkspace } from "../../app/(catalogue)/harmonize/workspace";
import { NoResults, PageOutOfRange } from "@/components/shared/no-results";
import { SectionError } from "@/components/shared/section-error";
import PersonNotFound from "../../app/(catalogue)/people/not-found";
import { buttonClass } from "@/components/ui/button";

// Loading, empty and error states audit, 15 Oct (tasks 0610 to 0612, 0614 to 0616)
function html(element: React.ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe("loading screens", () => {
  // A click on a person or an eBook kept the last page with no sign
  it.each([
    ["a person", PersonLoading, "Loading the person", "/people"],
    ["an eBook", EbookLoading, "Loading the eBook", "/ebooks"],
  ] as const)("%s says it is loading and keeps the way back", (_, Loading, label, back) => {
    const status = html(createElement(Loading)).querySelector("[role=status]")!;
    expect(status.getAttribute("aria-label")).toBe(label);
    expect(status.querySelector("a")!.getAttribute("href")).toBe(back);
  });

  it("draws Harmonize's own header, cards and toolbar", () => {
    const host = html(createElement(HarmonizeLoading));
    const status = host.querySelector(".harmonize[role=status]")!;
    expect(status.querySelector(".h-header h1")!.textContent).toBe("Harmonize");
    expect(status.querySelector(".h-eyebrow")!.textContent).toContain("Catalogue quality");
    expect(status.querySelector(".h-scan-control button")!.getAttribute("aria-busy")).toBe("true");
    expect([...status.querySelectorAll(".h-stat .h-stat-number")].map((n) => n.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(status.querySelector(".h-toolbar input")!.hasAttribute("disabled")).toBe(true);
    // One line at 320, as the page's own line is
    expect(status.querySelector(".h-scan-control p")!.textContent).toBe("Scanning the catalogue");
  });
});

describe("Harmonize with no findings to show", () => {
  // A failed scan offered "Clear filters", which does nothing for it
  it("offers to scan again when the scan failed", () => {
    const empty = html(createElement(HarmonizeWorkspace, { initialScan: null, initialError: "The database could not complete this action." })).querySelector(".h-empty")!;
    expect(empty.querySelector("h2")!.textContent).toBe("Scan unavailable");
    expect([...empty.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Scan library"]);
  });
});

describe("no results", () => {
  // The only way out of an empty search: a ghost link read as plain text
  it("leads out with a secondary button", () => {
    const clear = html(createElement(NoResults, { noun: "books", search: "zz", hasFilters: false, clearHref: "/library" })).querySelector("a")!;
    expect(clear.textContent).toBe("Clear search");
    expect(clear.className).toBe(buttonClass("secondary"));
    const first = html(createElement(PageOutOfRange, { firstPageHref: "/library" })).querySelector("a")!;
    expect(first.className).toBe(buttonClass("secondary"));
  });
});

describe("the eBook library when it shows nothing", () => {
  const counts = (n: number) => ({ total: 0, active: n, excluded: 0, review: 0, formats: [], languages: [] });
  const view = (query: string, active: number) => {
    navigation.query = query;
    return html(createElement(EbooksView, { books: [], counts: counts(active), page: 1, perPage: 48 }));
  };

  it("has the shared empty view, with Upload eBooks, when there are none", () => {
    const host = view("", 0);
    expect(host.querySelector("h3")!.textContent).toBe("No eBooks yet");
    expect(host.querySelector("svg")).not.toBeNull();
    const upload = host.querySelector("a")!;
    expect([upload.textContent, upload.getAttribute("href"), upload.className]).toEqual(["Upload eBooks", "/ebooks/upload", buttonClass("secondary")]);
  });

  it("has the shared no-results view for a search", () => {
    const host = view("q=zz", 40);
    expect(host.querySelector("h3")!.textContent).toBe("No eBooks found");
    expect(host.textContent).toContain('No eBooks match "zz".');
    expect(host.querySelector("a")!.textContent).toBe("Clear search");
  });
});

describe("error views that lead back to their own list", () => {
  const error = Object.assign(new Error("boom"), { digest: "x" });
  const back = (Error: (props: { error: Error; reset: () => void }) => React.ReactElement, pathname: string) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    navigation.pathname = pathname;
    const host = html(createElement(Error, { error, reset: () => {} }));
    const link = host.querySelector("a")!;
    return [link.getAttribute("href"), link.textContent, host.querySelector("p")!.textContent];
  };

  it.each([
    [PublishersError, "/publishers", ["/", "Go to the dashboard", "Publishers could not be loaded."]],
    [PublishersError, "/publishers/gallimard", ["/publishers", "Back to publishers", "This publisher could not be loaded."]],
    [PublishersError, "/publishers/review", ["/publishers", "Back to publishers", "An error occurred while loading this page."]],
    [EbooksError, "/ebooks/00000000-0000-4000-a000-000000000019", ["/ebooks", "Back to eBooks", "This eBook could not be loaded."]],
    [EbooksError, "/ebooks/review", ["/ebooks", "Back to eBooks", "An error occurred while loading this page."]],
    [EbooksError, "/ebooks", ["/", "Go to the dashboard", "eBooks could not be loaded."]],
    [CollectionsError, "/collections/7", ["/collections", "Back to collections", "This collection could not be loaded."]],
    [ReadingError, "/reading/journal", ["/reading", "Back to reading", "An error occurred while loading this page."]],
    [ReadingError, "/reading", ["/", "Go to the dashboard", "Reading could not be loaded."]],
    // A series and Series suggestions led to the dashboard; a settings page
    // lost the settings list (SLN-754)
    [SeriesError, "/series", ["/", "Go to the dashboard", "Series could not be loaded."]],
    [SeriesError, "/series/00000000-0000-4000-a000-000000000001", ["/series", "Back to series", "This series could not be loaded."]],
    [SeriesError, "/series/suggestions", ["/series", "Back to series", "An error occurred while loading this page."]],
    [SettingsError, "/settings/data", ["/settings", "Back to settings", "An error occurred while loading this page."]],
    [SettingsError, "/settings", ["/", "Go to the dashboard", "Settings could not be loaded."]],
    // SLN-813: these fell through to the catalogue's view, which led to the dashboard
    [PlacesError, "/places/cafe-de-flore", ["/places", "Back to places", "This place could not be loaded."]],
    [PlacesError, "/places", ["/", "Go to the dashboard", "Places could not be loaded."]],
    [OrganizationsError, "/organizations/gallimard", ["/organizations", "Back to organizations", "This organization could not be loaded."]],
    [RecommendersError, "/recommenders/7", ["/recommenders", "Back to recommenders", "This recommender could not be loaded."]],
    [TaxonomyError, "/taxonomy/genres", ["/taxonomy", "Back to taxonomy", "This family could not be loaded."]],
    [TaxonomyError, "/taxonomy/genres/gothic", ["/taxonomy", "Back to taxonomy", "An error occurred while loading this page."]],
    [LocationsError, "/locations", ["/", "Go to the dashboard", "Locations could not be loaded."]],
  ] as const)("%o on %s", (Error, pathname, expected) => {
    expect(back(Error, pathname)).toEqual(expected);
  });
});

describe("a page that is only an error or not-found view", () => {
  // Its heading was an h3, so the page had no main heading (finding 11)
  it("has its heading as the page's h1, and leads back with a secondary button", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = html(createElement(SectionError, { error: new Error("boom"), reset: () => {}, backHref: "/people", backLabel: "Back to people" }));
    expect(failed.querySelector("h1")!.textContent).toBe("Something went wrong");
    expect(failed.querySelector("h3")).toBeNull();
    expect(failed.querySelector("a")!.className).toBe(buttonClass("secondary"));
    // Try again is the action to take; the way out stays secondary (SLN-754)
    expect(failed.querySelector("button")!.className).toContain(buttonClass("primary"));
    expect(html(createElement(PersonNotFound)).querySelector("h1")!.textContent).toBe("Person not found");
  });

  it("is an h2 under the settings page's own title", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    navigation.pathname = "/settings/integrations";
    const failed = html(createElement(SettingsError, { error: new Error("boom"), reset: () => {} }));
    expect([failed.querySelector("h1"), failed.querySelector("h2")!.textContent]).toEqual([null, "Something went wrong"]);
  });

  it("leads with Try again on the reader's and the root's own error views too", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const view of [ReaderError, GlobalError]) {
      const failed = html(createElement(view, { error: new Error("boom"), reset: () => {} }));
      expect([failed.querySelector("button")!.className, failed.querySelector("a")!.className])
        .toEqual([buttonClass("primary"), buttonClass("secondary")]);
    }
  });

  it("leads a failed reader back to the eBook's page, or to the library when the address names none (SLN-818)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const back = (pathname: string) => {
      navigation.pathname = pathname;
      const link = html(createElement(ReaderError, { error: new Error("boom"), reset: () => {} })).querySelector("a")!;
      return [link.getAttribute("href"), link.textContent];
    };
    const id = "00000000-0000-4000-a000-000000000001";
    expect(back(`/reader/${id}`)).toEqual([`/ebooks/${id}`, "Back to the eBook"]);
    expect(back("/reader/offline")).toEqual(["/library", "Back to library"]);
    expect(back("/reader/not-an-id")).toEqual(["/library", "Back to library"]);
  });

  it("keeps the shared empty view's h3 everywhere else", () => {
    const host = html(createElement(NoResults, { noun: "books", search: "zz", hasFilters: false, clearHref: "/library" }));
    expect([host.querySelector("h1"), host.querySelector("h3")!.textContent]).toEqual([null, "No books found"]);
  });
});

describe("the dashboard's loading view", () => {
  // A held figure of the index is a block, as tall as the number it holds
  it("holds each count with a block", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(catalogue)/page.tsx"), "utf8");
    expect(source).toContain('<SkeletonBlock className="type-stat h-[1lh] w-12" />');
    expect(source).not.toContain("<SkeletonLine");
  });
});
