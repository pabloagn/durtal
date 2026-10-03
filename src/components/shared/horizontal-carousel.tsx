"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CapAligned } from "./cap-aligned";

interface HorizontalCarouselProps {
  title: string;
  titleHref?: string;
  children: React.ReactNode;
}

export function HorizontalCarousel({
  title,
  titleHref,
  children,
}: HorizontalCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState);
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, []);

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.8;
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }

  return (
    <div className="space-y-3">
      {/* The row carries the title's type: the arrows sit on the title's
          cap-height center */}
      <div className="flex items-start justify-between font-serif text-lg">
        <h3 className="font-serif text-lg text-fg-primary">
          {titleHref ? (
            <a
              href={titleHref}
              className="transition-colors hover:text-accent-rose-text"
            >
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
        {(canScrollLeft || canScrollRight) && (
          <CapAligned height={24}>
            <div className="flex gap-1">
              <button
                onClick={() => scroll("left")}
                disabled={!canScrollLeft}
                aria-label="Scroll left"
                className="block rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => scroll("right")}
                disabled={!canScrollRight}
                aria-label="Scroll right"
                className="block rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </CapAligned>
        )}
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-hide -m-1 flex gap-4 overflow-x-auto scroll-smooth scroll-px-1 snap-x snap-mandatory p-1"
      >
        {children}
      </div>
    </div>
  );
}
