// @vitest-environment happy-dom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CatalogueReadButton } from "@/components/ebooks/catalogue-read-button";
import {
  EbookReadMenuItem,
  PaletteEbookReadAction,
} from "@/components/ebooks/catalogue-read-action";
import { EbookMark } from "@/components/books/ebook-mark";
import { catalogueContinueDTO, workEbookDTO } from "@/lib/ebooks/catalogue-dto";
import {
  continueTarget,
  type ContinueAnchor,
  type ContinueFile,
} from "@/lib/ebooks/continue-target";
import type { EbookAvailability } from "@/lib/ebooks/read-target";
import { publicationFixture } from "@/__tests__/ebooks/publication-fixture";

const ebookId = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const oldId = "33333333-3333-3333-3333-333333333333";
const targetFile: ContinueFile = {
  ...publicationFixture(),
  id: fileId,
  ebookId,
  createdAt: "2026-10-09T09:00:00Z",
};
const place: ContinueAnchor = {
  deviceId: "local",
  deviceLabel: "Mac · Chrome",
  fileId,
  clientUpdatedAt: "2026-10-09T10:00:00Z",
  chapter: "Chapter 7",
  locator: {
    v: 1,
    fileHash: targetFile.sha256,
    href: "chapter7.xhtml",
    sectionIndex: 6,
    progression: 0.4,
    totalProgression: 0.44,
  },
};
function availability(
  files: ContinueFile[] = [targetFile],
  positions: ContinueAnchor[] = [],
): EbookAvailability {
  return {
    ebookId,
    title: "Nadja",
    editionId: "edition",
    editionLanguage: "fr",
    editionYear: 1964,
    formats: ["epub"],
    continue: catalogueContinueDTO(
      continueTarget({
        ebookId,
        files,
        positions,
        excluded: false,
        preferredFileId: null,
        deviceId: "local",
      }),
    ),
  };
}

let host: HTMLElement;
let root: Root;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("descriptor-driven catalogue eBook controls", () => {
  it("opens the actual file by document link and carries a validated series return destination", () => {
    act(() =>
      root.render(
        createElement(CatalogueReadButton, {
          availability: [availability()],
          originalLanguage: "fr",
          returnTo: "/series/surrealism?view=list",
        }),
      ),
    );
    const link = host.querySelector<HTMLAnchorElement>("[data-read-button]")!;
    const url = new URL(link.href);
    expect(url.pathname).toBe(`/reader/${ebookId}`);
    expect(url.searchParams.get("file")).toBe(fileId);
    expect(url.searchParams.get("returnTo")).toBe(
      "/series/surrealism?view=list",
    );
    expect(link.textContent).toBe("Read");
    expect(link.getAttribute("data-tooltip")).toContain("EPUB");
    expect(link.hasAttribute("data-reader-entry")).toBe(true);
  });

  it("labels a resolved local landing, and keeps the book's percent for a replaced-file anchor", () => {
    act(() =>
      root.render(
        createElement(CatalogueReadButton, {
          availability: [availability([targetFile], [place])],
          originalLanguage: "fr",
        }),
      ),
    );
    expect(host.querySelector("[data-read-button]")?.textContent).toBe(
      "Continue · 44%",
    );
    const old: ContinueFile = {
      ...targetFile,
      id: oldId,
      sha256: "ef".repeat(32),
      status: "replaced",
    };
    const oldPlace = {
      ...place,
      fileId: oldId,
      locator: { ...place.locator, fileHash: old.sha256 },
    };
    const replacement = availability([old, targetFile], [oldPlace]);
    expect(replacement.continue?.anchor?.fileId).toBe(oldId);
    act(() =>
      root.render(
        createElement(CatalogueReadButton, {
          availability: [replacement],
          originalLanguage: "fr",
        }),
      ),
    );
    // One number per book (SLN-683): the place still says how far the book is read
    expect(host.querySelector("[data-read-button]")?.textContent).toBe(
      "Continue · 44%",
    );
    expect(
      new URL(
        host.querySelector<HTMLAnchorElement>("[data-read-button]")!.href,
      ).searchParams.get("file"),
    ).toBe(fileId);
  });

  it.each(["missing", "quarantined", "replaced"])(
    "does not show Read or a mark for %s-only files",
    (status) => {
      const row = availability([{ ...targetFile, status }]);
      act(() =>
        root.render(
          createElement(
            "div",
            null,
            createElement(CatalogueReadButton, {
              availability: [row],
              originalLanguage: "fr",
            }),
            createElement(EbookMark, { ebook: workEbookDTO(row) }),
            createElement(EbookReadMenuItem, { ebook: workEbookDTO(row) }),
            createElement(PaletteEbookReadAction, { ebook: workEbookDTO(row) }),
          ),
        ),
      );
      expect(host.textContent).toBe("");
    },
  );

  it("does not show controls for a protected file or invalid medallion evidence", () => {
    for (const file of [
      { ...targetFile, drm: "kindle" },
      { ...targetFile, metadata: { medallion: {} } },
    ]) {
      const row = availability([file]);
      act(() =>
        root.render(
          createElement(CatalogueReadButton, {
            availability: [row],
            originalLanguage: "fr",
          }),
        ),
      );
      expect(host.querySelector("[data-read-button]")).toBeNull();
    }
  });

  it("shows edition choices with the original-language target and safe metadata links", async () => {
    const otherId = "44444444-4444-4444-4444-444444444444";
    const other = {
      ...availability(),
      ebookId: otherId,
      editionLanguage: "es",
      editionYear: 1998,
      continue: {
        ...availability().continue!,
        target: { ...availability().continue!.target, ebookId: otherId },
        href: `/reader/${otherId}?file=${fileId}`,
      },
    };
    act(() =>
      root.render(
        createElement(CatalogueReadButton, {
          availability: [other, availability()],
          originalLanguage: "fr",
        }),
      ),
    );
    expect(
      new URL(host.querySelector<HTMLAnchorElement>("[data-read-button]")!.href)
        .pathname,
    ).toBe(`/reader/${ebookId}`);
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose an eBook edition"]',
    )!;
    await act(async () => {
      trigger.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(host.querySelector('[role="menu"]')?.className).toContain("glass");
    expect(host.textContent).toContain("Spanish edition, 1998 · EPUB");
    expect(
      host.querySelector<HTMLAnchorElement>(`a[href="/ebooks/${ebookId}"]`)
        ?.textContent,
    ).toBe("Open the eBook page");
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          keyCode: 27,
          bubbles: true,
        }),
      ),
    );
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("renders the existing cover-chip geometry and an isolated palette secondary action", () => {
    const ebook = workEbookDTO(availability());
    const parent = vi.fn();
    const onRead = vi.fn();
    act(() =>
      root.render(
        createElement(
          "div",
          { onClick: parent },
          createElement(EbookMark, { ebook }),
          createElement(PaletteEbookReadAction, {
            ebook,
            onRead,
            returnTo: "//evil.example",
          }),
        ),
      ),
    );
    const mark = host.querySelector('[aria-label="eBook available"]')!;
    expect(mark.className).toContain("glass-chip");
    expect(mark.getAttribute("data-tooltip")).toBe("eBook available");
    const read = host.querySelector<HTMLAnchorElement>(
      `a[aria-label="Read Nadja"]`,
    )!;
    expect(new URL(read.href).searchParams.has("returnTo")).toBe(false);
    act(() =>
      read.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    expect(onRead).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    expect(read.getAttribute("data-tooltip-keys")).toBe("mod enter");
    // On a phone the keys go, so the title beside it keeps whole words
    // (review of #319: at 320px "Again / st / Natur / e")
    expect(read.querySelector("kbd")!.closest(".max-sm\\:hidden")).not.toBeNull();
    expect(read.textContent).toMatch(/^Read/);
  });
});
