"use client";

import { useRef, useEffect, useState } from "react";
import type { Book, Rendition, NavItem } from "epubjs";
import {
  generateReaderCSS,
  type ReaderThemeSettings,
} from "./epub-theme";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EpubReaderHandle {
  prevPage: () => void;
  nextPage: () => void;
  goToChapter: (href: string) => void;
  getCurrentCfi: () => string | null;
}

interface EpubReaderProps {
  bookUrl: string;
  initialCfi?: string | null;
  settings: ReaderThemeSettings;
  onLocationChange?: (cfi: string, progress: number, chapter: string) => void;
  onTocLoaded?: (toc: NavItem[]) => void;
  onReady?: () => void;
  handleRef?: React.MutableRefObject<EpubReaderHandle | null>;
}

// ── Component ────────────────────────────────────────────────────────────────

export function EpubReader({
  bookUrl,
  initialCfi,
  settings,
  onLocationChange,
  onTocLoaded,
  onReady,
  handleRef,
}: EpubReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const currentCfiRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Expose imperative handle
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      prevPage: () => renditionRef.current?.prev(),
      nextPage: () => renditionRef.current?.next(),
      goToChapter: (href: string) => renditionRef.current?.display(href),
      getCurrentCfi: () => currentCfiRef.current,
    };
  }, [handleRef]);

  // Initialize epub.js
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    async function init() {
      const ePub = (await import("epubjs")).default;

      if (destroyed) return;

      const book = ePub(bookUrl);
      bookRef.current = book;

      const rendition = book.renderTo(containerRef.current!, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        manager: "default",
      });

      renditionRef.current = rendition;

      // Apply theme
      rendition.themes.register("durtal", {});
      rendition.themes.select("durtal");
      rendition.themes.override("color", "#c1c6c4");
      rendition.themes.override("background", "#030507");

      // Inject full CSS on each rendered section
      rendition.hooks.content.register((contents: any) => {
        const doc = contents.document;
        if (!doc) return;

        // Inject Durtal reader CSS
        const style = doc.createElement("style");
        style.setAttribute("data-durtal-reader", "true");
        style.textContent = generateReaderCSS(settings);
        doc.head.appendChild(style);

        // Try to inject our fonts (they may not load in the iframe
        // depending on CSP, but we set fallbacks in the font stack)
        const fontLink = doc.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href =
          "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap";
        doc.head.appendChild(fontLink);
      });

      // Track location changes
      rendition.on("relocated", (location: any) => {
        if (destroyed) return;
        const cfi = location.start?.cfi;
        if (cfi) {
          currentCfiRef.current = cfi;
          const progress = book.locations?.percentageFromCfi(cfi) ?? 0;
          const chapter = findChapterForCfi(book, cfi);
          onLocationChange?.(cfi, progress, chapter);
        }
      });

      // Load TOC
      book.loaded.navigation.then((nav) => {
        if (!destroyed) {
          onTocLoaded?.(nav.toc);
        }
      });

      // Display
      if (initialCfi) {
        await rendition.display(initialCfi);
      } else {
        await rendition.display();
      }

      // Generate locations in background for progress tracking
      book.ready.then(() => {
        if (!destroyed) {
          setLoading(false);
          onReady?.();
          // Generate locations asynchronously (this can take a few seconds)
          book.locations.generate(1024).catch(() => {});
        }
      });
    }

    init();

    return () => {
      destroyed = true;
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
      renditionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookUrl]);

  // Update theme when settings change (without reinitializing the book)
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Re-inject CSS into all rendered views
    rendition.views().forEach((view: any) => {
      const doc = view.document;
      if (!doc) return;

      const existing = doc.querySelector("[data-durtal-reader]");
      if (existing) {
        existing.textContent = generateReaderCSS(settings);
      } else {
        const style = doc.createElement("style");
        style.setAttribute("data-durtal-reader", "true");
        style.textContent = generateReaderCSS(settings);
        doc.head.appendChild(style);
      }
    });
  }, [settings]);

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary">
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-pulse rounded-sm bg-accent-plum" />
            <p className="font-mono text-micro text-fg-muted">
              Loading book...
            </p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findChapterForCfi(book: Book, cfi: string): string {
  try {
    const spineItem = book.spine.get(cfi);
    if (!spineItem) return "";

    const nav = (book as any).navigation;
    if (!nav?.toc) return "";

    // Walk the TOC to find the matching chapter
    function search(items: NavItem[]): string {
      for (const item of items) {
        if (item.href && spineItem?.href?.includes(item.href.split("#")[0])) {
          return item.label?.trim() ?? "";
        }
        if (item.subitems?.length) {
          const found = search(item.subitems);
          if (found) return found;
        }
      }
      return "";
    }

    return search(nav.toc);
  } catch {
    return "";
  }
}
