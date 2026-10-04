"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CapAligned } from "./cap-aligned";
import { SectionHeading, headingRole } from "./section-heading";

interface HorizontalCarouselProps {
  title: string;
  titleHref?: string;
  /** Shown after the title, such as the full count when the row holds fewer */
  count?: number;
  /** h3 for a row inside a titled section */
  as?: "h2" | "h3";
  children: React.ReactNode;
}

export function HorizontalCarousel({
  title,
  titleHref,
  count,
  as,
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
    <div>
      <SectionHeading
        as={as}
        count={count}
        title={
          titleHref ? (
            <a
              href={titleHref}
              className="transition-colors hover:text-accent-rose-text"
            >
              {title}
            </a>
          ) : (
            title
          )
        }
        action={
          (canScrollLeft || canScrollRight) && (
            // Carries the title's type: the arrows sit on the title's
            // cap-height center
            <CapAligned height={24} className={headingRole(as)}>
              <div className="flex gap-1">
                <button
                  onClick={() => scroll("left")}
                  disabled={!canScrollLeft}
                  aria-label="Scroll left"
                  data-tooltip="Scroll left"
                  className="block rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => scroll("right")}
                  disabled={!canScrollRight}
                  aria-label="Scroll right"
                  data-tooltip="Scroll right"
                  className="block rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </CapAligned>
          )
        }
      />

      <div
        ref={scrollRef}
        className="scrollbar-hide -m-1 flex gap-4 overflow-x-auto scroll-smooth scroll-px-1 snap-x snap-mandatory p-1"
      >
        {children}
      </div>
    </div>
  );
}
